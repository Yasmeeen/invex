import mongoose from 'mongoose';
import Product from '../DB/models/product.model.js';
import PurchasingRequest from '../DB/models/purchasingRequest.model.js';
import StockMovement from '../DB/models/stockMovement.model.js';
import {
  cashAmountFromTreasurySplits,
  deferredTreasuryAmount,
  deskPurchaseLineTotal,
  normalizeTreasurySplitsInput,
  purchaseHasDeferredTreasury,
  resolvePurchaseTreasurySplits,
} from './purchase-treasury-splits.js';
import {
  getEffectivePurchaseTreasuryMethodsFromDb,
  isDeferredPurchaseTreasury,
  treasuryMethodMap,
} from '../modules/settings_module/treasuryMethods.js';
import { syncVendorPurchaseLedger } from './vendor-purchase-ledger.js';
import {
  removeDeferredSupplierDeskPurchase,
  syncDeferredSupplierDeskPurchase,
} from './desk-purchase-deferred.js';
import {
  buildPurchaseNonDeferredRefundSplits,
  finalizePurchaseRefundSplits,
} from './return-refund-mirror.js';

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

export function purchaseRemainingQty(purchase) {
  const q = Math.max(1, Math.floor(Number(purchase?.quantity) || 1));
  const fromField = Math.max(0, Math.floor(Number(purchase?.returnedQuantity) || 0));
  const fromHistory = (purchase?.returns || []).reduce(
    (acc, ret) => acc + Math.max(0, Math.floor(Number(ret?.quantity) || 0)),
    0
  );
  const returned = Math.max(fromField, fromHistory);
  return Math.max(0, q - returned);
}

export function purchaseIsFullyReturned(purchase) {
  return purchaseRemainingQty(purchase) <= 0;
}

function defaultRefundTreasurySplits(purchase, refundTotal) {
  const total = round2(refundTotal);
  const original = resolvePurchaseTreasurySplits(purchase);
  const origTotal = round2(original.reduce((a, s) => a + s.amount, 0));
  if (origTotal <= 0 || !original.length) {
    return [{ key: 'cash', label: 'Cash', amount: total }];
  }
  const keys = original.map((s) => s.key);
  const splits = [];
  let allocated = 0;
  for (let i = 0; i < original.length; i++) {
    const row = original[i];
    const share = row.amount / origTotal;
    const amt =
      i === original.length - 1 ? round2(total - allocated) : round2(total * share);
    if (amt > 0) {
      splits.push({ key: row.key, label: row.label || row.key, amount: amt });
    }
    allocated = round2(allocated + amt);
  }
  return splits.length ? splits : [{ key: 'cash', label: 'Cash', amount: total }];
}

async function reducePurchaseStock(purchase, qty, returnedProductIds) {
  const pp = purchase.productPayload || {};
  const ids =
    Array.isArray(returnedProductIds) && returnedProductIds.length
      ? returnedProductIds
      : purchase.createdProductIds?.length
        ? purchase.createdProductIds.slice(-qty)
        : purchase.createdProductId
          ? [purchase.createdProductId]
          : [];

  if (!ids.length) {
    throw new Error('Purchase has no linked products to return');
  }

  if (purchase.createdProductIds?.length && ids.length !== qty) {
    throw new Error('Select one product unit per returned quantity');
  }

  const removed = [];
  for (const id of ids) {
    const product = await Product.findById(id);
    if (!product) continue;

    if (purchase.createdProductIds?.length) {
      await Product.findByIdAndDelete(id);
      removed.push(id);
    } else {
      const stock = Math.max(0, (Number(product.stock) || 0) - qty);
      product.stock = stock;
      if (stock <= 0) {
        await Product.findByIdAndDelete(id);
      } else {
        await product.save();
      }
      removed.push(id);
      break;
    }

    try {
      await StockMovement.create({
        movementType: 'return',
        productId: product._id,
        productName: product.name,
        branchId: purchase.branch || null,
        fromBranchId: purchase.branch || null,
        toBranchId: null,
        quantity: purchase.createdProductIds?.length ? 1 : qty,
        unitPrice: Number(pp.netPrice) || 0,
        totalValue: round2(
          (Number(pp.netPrice) || 0) * (purchase.createdProductIds?.length ? 1 : qty)
        ),
        referenceType: 'productPurchaseRequest',
        referenceId: purchase._id,
        notes: `Purchase return ${String(pp.code || '').trim()}`,
      });
    } catch (e) {
      console.warn('⚠️ purchase return stock movement:', e?.message || e);
    }
  }

  if (purchase.createdProductIds?.length) {
    const removedSet = new Set(removed.map(String));
    purchase.createdProductIds = purchase.createdProductIds.filter(
      (id) => !removedSet.has(String(id))
    );
    purchase.createdProductId = purchase.createdProductIds[0] || undefined;
  }

  return removed;
}

async function adjustPurchaseTreasuryAfterReturn(purchase, refundTotal, { userId } = {}) {
  const lineTotal = deskPurchaseLineTotal(purchase);
  if (lineTotal <= 0) return 0;

  const ratio = Math.max(0, (lineTotal - refundTotal) / lineTotal);
  const splits = resolvePurchaseTreasurySplits(purchase);
  const origDeferred = deferredTreasuryAmount(purchase);
  const deferredReduction = round2(origDeferred * (refundTotal / lineTotal));

  if (ratio <= 0.001) {
    purchase.purchaseTreasurySplits = undefined;
    purchase.purchaseTreasuryKey = 'cash';
    purchase.purchaseTreasuryLabel = '';
  } else {
    const scaled = splits
      .map((s) => ({
        key: s.key,
        label: s.label || s.key,
        amount: round2(s.amount * ratio),
      }))
      .filter((s) => s.amount > 0.001);
    purchase.purchaseTreasurySplits = scaled.length ? scaled : undefined;
    purchase.markModified('purchaseTreasurySplits');
  }

  if (purchaseHasDeferredTreasury(purchase) || deferredReduction > 0) {
    if (purchase.linkedPurchasingRequestId) {
      const pr = await PurchasingRequest.findById(purchase.linkedPurchasingRequestId);
      if (pr) {
        pr.totalAmount = round2(Math.max(0, (Number(pr.totalAmount) || 0) - deferredReduction));
        const paid = Number(pr.amountPaid) || 0;
        if (paid > pr.totalAmount) {
          pr.amountPaid = pr.totalAmount;
        }
        if (pr.totalAmount <= 0.001) {
          await PurchasingRequest.findByIdAndDelete(pr._id);
          purchase.linkedPurchasingRequestId = undefined;
        } else {
          await pr.save();
          await syncVendorPurchaseLedger(pr, { userId });
        }
      }
    } else if (purchaseRemainingQty(purchase) <= 0 && deferredReduction > 0) {
      await removeDeferredSupplierDeskPurchase(purchase);
    } else if (deferredReduction > 0) {
      await syncDeferredSupplierDeskPurchase(purchase, { userId });
    }
  }

  return deferredReduction;
}

/**
 * Process partial or full desk purchase return.
 */
export async function processPurchaseReturn(purchase, body = {}) {
  if (!purchase) {
    throw new Error('Purchase not found');
  }
  if (purchase.status === 'returned') {
    throw new Error('Purchase is already fully returned');
  }
  if (purchase.status !== 'approved' && purchase.status !== 'partially_returned') {
    throw new Error('Only approved purchases can be returned');
  }
  if (purchase.isExchangeTradeIn) {
    throw new Error('Exchange trade-in purchases cannot be returned here');
  }

  const remaining = purchaseRemainingQty(purchase);
  if (remaining <= 0) {
    throw new Error('Nothing left to return');
  }

  const returnAll = body.returnAll === true || body.returnAll === 'true';
  const qty = returnAll
    ? remaining
    : Math.floor(Number(body.quantity) || 0);
  if (qty <= 0 || qty > remaining) {
    throw new Error('Invalid return quantity');
  }

  const pp = purchase.productPayload || {};
  const unitRefundPrice = round2(
    body.unitRefundPrice != null ? body.unitRefundPrice : Number(pp.netPrice) || 0
  );
  if (!Number.isFinite(unitRefundPrice) || unitRefundPrice < 0) {
    throw new Error('Valid unit refund price is required');
  }

  const refundTotal = round2(qty * unitRefundPrice);
  if (refundTotal <= 0) {
    throw new Error('Refund total must be greater than zero');
  }

  const treasuryMethods = await getEffectivePurchaseTreasuryMethodsFromDb();
  const tMap = treasuryMethodMap(treasuryMethods);
  const cashViaRaw = String(body.cashRefundVia || 'drawer').toLowerCase();
  const cashTreasuryKey = String(body.cashTreasuryKey || '').trim().toLowerCase();

  const { refundTreasurySplits: baseTreasurySplits } = buildPurchaseNonDeferredRefundSplits(
    purchase,
    refundTotal,
    tMap
  );

  const finalized = finalizePurchaseRefundSplits(baseTreasurySplits, {
    cashRefundVia: cashViaRaw,
    cashTreasuryKey,
    cashTreasuryLabel: body.cashTreasuryLabel,
    tMap,
  });
  let refundTreasurySplits = finalized.refundTreasurySplits;
  const cashRefundVia = finalized.cashRefundVia;

  if (refundTreasurySplits.some((s) => isDeferredPurchaseTreasury(s.key))) {
    throw new Error('Deferred treasury cannot be used for purchase returns');
  }

  const splitSum = round2(refundTreasurySplits.reduce((a, s) => a + s.amount, 0));
  const { deferredAdjustmentAmount: mirroredDeferred } = buildPurchaseNonDeferredRefundSplits(
    purchase,
    refundTotal,
    tMap
  );
  const expectedTreasury = round2(refundTotal - mirroredDeferred);
  if (Math.abs(splitSum - expectedTreasury) > 0.02) {
    throw new Error('Refund treasury splits must equal the refundable treasury total');
  }

  const returnedProductIds = Array.isArray(body.returnedProductIds)
    ? body.returnedProductIds.filter((id) => mongoose.Types.ObjectId.isValid(String(id)))
    : undefined;

  const removedIds = await reducePurchaseStock(purchase, qty, returnedProductIds);

  const deferredAdjustmentAmount = await adjustPurchaseTreasuryAfterReturn(purchase, refundTotal, {
    userId: body.userId,
  });

  purchase.returnedQuantity = Math.max(
    Math.floor(Number(purchase.returnedQuantity) || 0),
    (purchase.returns || []).reduce(
      (acc, ret) => acc + Math.max(0, Math.floor(Number(ret?.quantity) || 0)),
      0
    )
  ) + qty;
  const now = new Date();

  const returnRecord = {
    returnedAt: now,
    returnedByUserId:
      body.userId && mongoose.Types.ObjectId.isValid(String(body.userId))
        ? new mongoose.Types.ObjectId(String(body.userId))
        : undefined,
    quantity: qty,
    unitRefundPrice,
    refundTotal,
    refundTreasurySplits: refundTreasurySplits.length ? refundTreasurySplits : undefined,
    cashRefundVia,
    deferredAdjustmentAmount,
    returnedProductIds: removedIds.length ? removedIds : undefined,
    note: String(body.note || '').trim().slice(0, 500),
  };

  purchase.returns = purchase.returns || [];
  purchase.returns.push(returnRecord);

  if (purchaseIsFullyReturned(purchase)) {
    purchase.status = 'returned';
    purchase.returnedAt = now;
  } else {
    purchase.status = 'partially_returned';
  }

  purchase.markModified('returns');
  if (purchase.purchaseTreasurySplits) {
    purchase.markModified('purchaseTreasurySplits');
  }

  await purchase.save();

  const cashRefundTotal =
    cashRefundVia === 'drawer' ? cashAmountFromTreasurySplits(refundTreasurySplits) : 0;

  return { purchase, returnRecord, cashRefundTotal, deferredAdjustmentAmount };
}

export function refundTreasuryCashFromReturnRecord(returnRecord) {
  if (String(returnRecord?.cashRefundVia || 'drawer').toLowerCase() === 'treasury') {
    return 0;
  }
  return cashAmountFromTreasurySplits(returnRecord?.refundTreasurySplits || []);
}
