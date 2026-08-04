import mongoose from 'mongoose';
import PurchasingRequest from '../DB/models/purchasingRequest.model.js';
import ProductPurchaseRequest from '../DB/models/productPurchaseRequest.model.js';
import DailyExpense from '../DB/models/dailyExpense.model.js';
import {
  getEffectivePurchaseTreasuryMethodsFromDb,
  isDeferredPurchaseTreasury,
  PURCHASE_TREASURY_DEFERRED_LABEL,
  treasuryMethodMap,
} from '../modules/settings_module/treasuryMethods.js';
import {
  cashAmountFromTreasurySplits,
  deferredTreasuryAmount,
  derivePurchaseTreasuryKey,
  derivePurchaseTreasuryLabel,
  deskPurchaseLineTotal,
  normalizeTreasurySplitsInput,
  paidNowTreasuryAmount,
  purchaseHasDeferredTreasury,
} from './purchase-treasury-splits.js';
import {
  recordVendorDeferredPayment,
  removeVendorPurchaseLedger,
  syncVendorPurchaseLedger,
} from './vendor-purchase-ledger.js';
import { resolveBranchForCashDrawer } from './vendor-cash-drawer.js';
import { postTreasurySplitOutflows, safeTreasuryPost } from './treasury-ledger.js';

export function deferredDeskPurchaseRemaining(purchase) {
  if (!purchase || !purchaseHasDeferredTreasury(purchase)) return 0;
  const deferredTotal = deferredTreasuryAmount(purchase) || deskPurchaseLineTotal(purchase);
  const paidNow = paidNowTreasuryAmount(purchase);
  const totalPaid = Number(purchase.amountPaid) || 0;
  const deferredPaid = Math.max(0, Math.round((totalPaid - paidNow) * 100) / 100);
  return Math.max(0, Math.round((deferredTotal - deferredPaid) * 100) / 100);
}

/**
 * After vendor deferred payment on linked PurchasingRequest, mirror amountPaid
 * onto the desk ProductPurchaseRequest so purchase invoices show settlement.
 * amountPaid = non-deferred splits paid at create + deferred payments on the PR.
 */
export async function syncDeskPurchasePaidFromLinkedRequest(purchasingRequest) {
  if (!purchasingRequest?._id) return null;
  const purchase = await ProductPurchaseRequest.findOne({
    linkedPurchasingRequestId: purchasingRequest._id,
  });
  if (!purchase || !purchaseHasDeferredTreasury(purchase)) return null;

  const paidNow = paidNowTreasuryAmount(purchase);
  const deferredPaid = Math.round((Number(purchasingRequest.amountPaid) || 0) * 100) / 100;
  const lineTotal = deskPurchaseLineTotal(purchase);
  const nextPaid = Math.max(
    0,
    Math.min(Math.round((paidNow + deferredPaid) * 100) / 100, lineTotal)
  );
  if (Math.abs((Number(purchase.amountPaid) || 0) - nextPaid) < 0.005) {
    return purchase;
  }
  purchase.amountPaid = nextPaid;
  await purchase.save();
  return purchase;
}

function deskPurchasingRequestNote(purchase) {
  const pp = purchase?.productPayload || {};
  const name = String(pp.name || '').trim();
  const code = String(pp.code || '').trim();
  const parts = ['شراء منتج (مكتب)'];
  if (name) parts.push(name);
  if (code) parts.push(`(${code})`);
  return parts.join(' — ');
}

/**
 * Create or update PurchasingRequest + vendor ledger for approved deferred supplier desk purchase.
 */
export async function syncDeferredSupplierDeskPurchase(purchase, { userId, actorName, session } = {}) {
  if (!purchase || !purchaseHasDeferredTreasury(purchase)) {
    return null;
  }

  const af = purchase.productPayload?.acquiredFrom;
  if (!af || af.partyType !== 'supplier' || !af.vendorId) {
    return null;
  }

  const totalAmount = deferredTreasuryAmount(purchase) || deskPurchaseLineTotal(purchase);
  const productIds = [];
  if (purchase.createdProductIds?.length) {
    for (const id of purchase.createdProductIds) {
      if (id) productIds.push(id);
    }
  } else if (purchase.createdProductId) {
    productIds.push(purchase.createdProductId);
  }

  const note = deskPurchasingRequestNote(purchase);
  const requestedBy = String(actorName || '').trim();

  let pr;
  if (purchase.linkedPurchasingRequestId) {
    const findQ = PurchasingRequest.findById(purchase.linkedPurchasingRequestId);
    pr = session ? await findQ.session(session) : await findQ;
    if (pr) {
      pr.totalAmount = totalAmount;
      pr.paymentStatus = 'Deferred';
      pr.status = 'Received';
      pr.notes = note;
      if (productIds.length) pr.products = productIds;
      if (session) await pr.save({ session });
      else await pr.save();
    }
  }

  if (!pr) {
    const payload = {
      supplier: af.vendorId,
      paymentStatus: 'Deferred',
      amountPaid: 0,
      totalAmount,
      status: 'Received',
      requestDate: purchase.resolvedAt || purchase.createdAt || new Date(),
      requestedBy,
      notes: note,
      products: productIds,
    };
    if (session) {
      const created = await PurchasingRequest.create([payload], { session });
      pr = created[0];
      purchase.linkedPurchasingRequestId = pr._id;
      await purchase.save({ session });
    } else {
      pr = await PurchasingRequest.create(payload);
      purchase.linkedPurchasingRequestId = pr._id;
      await purchase.save();
    }
  }

  await syncVendorPurchaseLedger(pr, { userId });
  return pr;
}

export async function removeDeferredSupplierDeskPurchase(purchase, { session } = {}) {
  const prId = purchase?.linkedPurchasingRequestId;
  const vendorId = purchase?.productPayload?.acquiredFrom?.vendorId;
  if (!prId) return;

  if (session) {
    await PurchasingRequest.findByIdAndDelete(prId).session(session);
  } else {
    await PurchasingRequest.findByIdAndDelete(prId);
  }
  purchase.linkedPurchasingRequestId = undefined;
  if (session) await purchase.save({ session });
  else await purchase.save();

  try {
    await removeVendorPurchaseLedger(prId, vendorId);
  } catch (e) {
    console.warn('⚠️ remove deferred desk purchase ledger:', e?.message || e);
  }
}

export function deferredPurchaseTreasuryLabel() {
  return PURCHASE_TREASURY_DEFERRED_LABEL;
}

/**
 * Store pays client/supplier on approved desk purchase with deferred treasury.
 * Supplier + linked PurchasingRequest → vendor deferred ledger; client → amountPaid + cash expense.
 */
export async function recordDeskPurchaseDeferredPayment(
  purchaseId,
  { paymentTreasurySplits: splitsRaw, amount: amountRaw, userId, branchId, note } = {}
) {
  if (!purchaseId) {
    throw new Error('Purchase id is required');
  }

  const purchase = await ProductPurchaseRequest.findById(purchaseId);
  if (!purchase) {
    throw new Error('Purchase not found');
  }
  if (purchase.status !== 'approved') {
    throw new Error('Purchase is not approved');
  }
  if (!purchaseHasDeferredTreasury(purchase)) {
    throw new Error('Not a deferred desk purchase');
  }

  const remaining = deferredDeskPurchaseRemaining(purchase);
  if (remaining <= 0) {
    throw new Error('Nothing remaining to pay');
  }

  const af = purchase.productPayload?.acquiredFrom || {};
  const partyType = String(af.partyType || '').toLowerCase();

  if (partyType === 'supplier' && purchase.linkedPurchasingRequestId) {
    const pr = await PurchasingRequest.findById(purchase.linkedPurchasingRequestId);
    if (!pr) {
      throw new Error('Linked purchasing request not found');
    }
    // Self-heal: PR already fully paid but desk invoice amountPaid was out of sync.
    const prRemaining =
      Math.max(
        0,
        Math.round(((Number(pr.totalAmount) || 0) - (Number(pr.amountPaid) || 0)) * 100) / 100
      );
    if (prRemaining <= 0) {
      await syncDeskPurchasePaidFromLinkedRequest(pr);
      throw new Error('Nothing remaining to pay');
    }
    const result = await recordVendorDeferredPayment(pr, amountRaw, {
      userId,
      branchId,
      note,
      paymentTreasurySplits: splitsRaw,
    });
    // recordVendorDeferredPayment syncs purchase.amountPaid; reload for accurate remaining.
    const fresh = await ProductPurchaseRequest.findById(purchaseId);
    return {
      ...result,
      amountPaid: Number(fresh?.amountPaid) || result.amountPaid,
      remaining: deferredDeskPurchaseRemaining(fresh || purchase),
    };
  }

  let lineTotal = Math.round(Number(amountRaw) * 100) / 100;
  if (Array.isArray(splitsRaw) && splitsRaw.length) {
    lineTotal = Math.round(
      splitsRaw.reduce((acc, row) => acc + (Number(row?.amount) || 0), 0) * 100
    ) / 100;
  }
  if (!Number.isFinite(lineTotal) || lineTotal <= 0) {
    throw new Error('Valid payment amount is required');
  }
  if (lineTotal > remaining + 0.01) {
    throw new Error('Payment exceeds remaining balance');
  }

  const treasuryMethods = await getEffectivePurchaseTreasuryMethodsFromDb();
  const tMap = treasuryMethodMap(treasuryMethods);
  const treasuryNorm = normalizeTreasurySplitsInput({
    purchaseTreasurySplits: splitsRaw,
    purchaseTreasuryKey: undefined,
    lineTotal,
    treasuryMethods,
    tMap,
  });
  if (treasuryNorm.error) {
    throw new Error(treasuryNorm.error);
  }

  const splits = treasuryNorm.splits;
  const applied = lineTotal;
  const cashDrawerAmount = cashAmountFromTreasurySplits(splits);

  purchase.amountPaid = Math.round(((Number(purchase.amountPaid) || 0) + applied) * 100) / 100;
  await purchase.save();

  if (cashDrawerAmount > 0) {
    const resolvedBranch = await resolveBranchForCashDrawer({
      userId,
      branchId: branchId || purchase.branch,
    });
    const uid =
      userId && mongoose.Types.ObjectId.isValid(String(userId))
        ? new mongoose.Types.ObjectId(String(userId))
        : null;
    if (resolvedBranch && uid) {
      const treasuryKey = derivePurchaseTreasuryKey(splits);
      const treasuryLabel = derivePurchaseTreasuryLabel(splits, tMap);
      const pp = purchase.productPayload || {};
      const partyLabel = String(af.displayName || af.name || af.phone || 'client').trim();
      await DailyExpense.create({
        branch: resolvedBranch,
        amount: cashDrawerAmount,
        expenseType: 'desk_purchase_deferred_paid',
        notes:
          String(note || '').trim() ||
          `سداد شراء بالآجل — ${partyLabel}${pp.name ? ` · ${pp.name}` : ''}`,
        recordedBy: uid,
        expenseTreasuryKey: treasuryKey,
        expenseTreasuryLabel: treasuryLabel,
        expenseTreasurySplits: splits,
      });
    }
  }

  await safeTreasuryPost('desk_deferred_paid', async () => {
    const resolvedBranch = await resolveBranchForCashDrawer({
      userId,
      branchId: branchId || purchase.branch,
    });
    if (!resolvedBranch) return;
    await postTreasurySplitOutflows({
      branchId: resolvedBranch,
      splits,
      sourceType: 'desk_purchase',
      sourceId: purchase._id,
      note: String(note || '').trim() || 'Desk purchase deferred payment',
      createdBy: userId,
    });
  });

  return {
    applied,
    cashDrawerAmount,
    amountPaid: purchase.amountPaid,
    remaining: deferredDeskPurchaseRemaining(purchase),
    paymentTreasurySplits: splits,
  };
}

export { deskPurchaseLineTotal } from './purchase-treasury-splits.js';
