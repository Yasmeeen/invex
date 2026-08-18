import mongoose from 'mongoose';
import Product from '../DB/models/product.model.js';
import StockMovement from '../DB/models/stockMovement.model.js';
import AuditLog from '../DB/models/auditLog.model.js';
import ProductPurchaseRequest from '../DB/models/productPurchaseRequest.model.js';
import { isClientCreditOrder } from './client-order-utils.js';
import {
  buildSalesRefundPaymentSplits,
  finalizeSalesRefundSplits,
  salesCreditAdjustment,
  salesRefundCashDue,
} from './return-refund-mirror.js';
import { getEffectivePurchaseTreasuryMethodsFromDb, treasuryMethodMap } from '../modules/settings_module/treasuryMethods.js';
import { netSettlementFeesOnPaymentSplits } from './treasury-ledger.js';

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function normalizePayMethod(raw) {
  const s = String(raw || '')
    .trim()
    .toLowerCase();
  return s || 'cash';
}

function lineProductId(raw) {
  if (raw == null || raw === '') return '';
  if (typeof raw === 'object' && raw._id != null) {
    return String(raw._id).trim();
  }
  return String(raw).trim();
}

function returnedQtyFromHistory(order, productId) {
  const pid = lineProductId(productId);
  if (!pid) return 0;
  let sum = 0;
  for (const ret of order?.returns || []) {
    for (const item of ret.items || []) {
      if (lineProductId(item.productId) === pid) {
        sum += Math.max(0, Math.floor(Number(item.quantity) || 0));
      }
    }
  }
  return sum;
}

export function orderLineRemainingQty(line, order = null) {
  const sold = Math.max(0, Math.floor(Number(line?.quantity) || 0));
  const fromLine = Math.max(0, Math.floor(Number(line?.returnedQuantity) || 0));
  const fromHistory = order ? returnedQtyFromHistory(order, line?.productId) : 0;
  const returned = Math.max(fromLine, fromHistory);
  return Math.max(0, sold - returned);
}

export function orderIsFullyReturned(order) {
  const lines = order?.products || [];
  if (!lines.length) return false;
  return lines.every((line) => orderLineRemainingQty(line, order) <= 0);
}

/** Proportional refund split mirroring original checkout payments. */
export function defaultRefundPaymentSplitsFromOrder(order, refundTotal) {
  return buildSalesRefundPaymentSplits(order, refundTotal);
}

function findOrderLine(order, productId) {
  const pid = lineProductId(productId);
  return (order.products || []).find((line) => lineProductId(line.productId) === pid);
}

function attrsToPlain(attributes) {
  if (!attributes) return {};
  if (attributes instanceof Map) return Object.fromEntries(attributes.entries());
  if (typeof attributes === 'object') return { ...attributes };
  return {};
}

function toObjectId(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'object' && raw._id != null) {
    return mongoose.Types.ObjectId.isValid(String(raw._id))
      ? new mongoose.Types.ObjectId(String(raw._id))
      : null;
  }
  return mongoose.Types.ObjectId.isValid(String(raw))
    ? new mongoose.Types.ObjectId(String(raw))
    : null;
}

/**
 * Rebuild product fields for a hard-deleted row (legacy deleteProductWhenOutOfStock).
 */
async function snapshotForDeletedProduct(order, line) {
  const code = String(line?.code || '').trim();
  const productOid = line?.productId;
  const branchId = order?.branch ? toObjectId(order.branch) : null;

  const snapshot = {
    name: String(line?.name || code || 'Product').trim(),
    code: code || String(productOid || ''),
    price: Math.max(0, Number(line?.price) || 0),
    netPrice: Math.max(0, Number(line?.cost) || 0),
    category: null,
    branch: branchId,
    inWarehouse: !branchId,
    addedBy: '',
    attributes: {},
    imageUrl: '',
    discount: 0,
  };

  const [audits, purchases] = await Promise.all([
    productOid
      ? AuditLog.find({
          entityType: 'Product',
          entityId: String(productOid),
        })
          .sort({ createdAt: -1 })
          .limit(30)
          .lean()
      : Promise.resolve([]),
    code
      ? ProductPurchaseRequest.find({
          $or: [
            { 'productPayload.code': code },
            { 'productPayload.unitCodes': code },
            ...(productOid
              ? [
                  { createdProductId: productOid },
                  { createdProductIds: productOid },
                ]
              : []),
          ],
        })
          .sort({ createdAt: -1 })
          .limit(10)
          .lean()
      : Promise.resolve([]),
  ]);

  for (const log of audits || []) {
    const src = log.before || log.after || {};
    if (!snapshot.category && src.category) {
      snapshot.category = toObjectId(src.category);
    }
    // Keep invoice line price/cost — audits/purchases often hold stale catalog values
    if (src.addedBy) snapshot.addedBy = String(src.addedBy);
    if (src.inWarehouse != null) snapshot.inWarehouse = !!src.inWarehouse;
    if (src.branch != null) snapshot.branch = toObjectId(src.branch);
    if (src.attributes && !Object.keys(snapshot.attributes).length) {
      snapshot.attributes = attrsToPlain(src.attributes);
    }
    if (src.imageUrl && !snapshot.imageUrl) snapshot.imageUrl = String(src.imageUrl);
    if (src.discount != null && !snapshot.discount) {
      snapshot.discount = Math.max(0, Number(src.discount) || 0);
    }
    if (!snapshot.name && src.name) snapshot.name = String(src.name);
    if (src.code) snapshot.code = String(src.code);
  }

  for (const pr of purchases || []) {
    const payload = pr.productPayload || {};
    if (!snapshot.category && payload.category) {
      snapshot.category = toObjectId(payload.category);
    }
    // Do not overwrite price/netPrice from purchase — invoice line is source of truth on return
    if (payload.addedBy && !snapshot.addedBy) snapshot.addedBy = String(payload.addedBy);
    if (payload.attributes && !Object.keys(snapshot.attributes).length) {
      snapshot.attributes = attrsToPlain(payload.attributes);
    }
    if (payload.imageUrl && !snapshot.imageUrl) snapshot.imageUrl = String(payload.imageUrl);
    if (payload.discount != null && !snapshot.discount) {
      snapshot.discount = Math.max(0, Number(payload.discount) || 0);
    }
    if (!snapshot.name && payload.name) snapshot.name = String(payload.name);
    if (!snapshot.branch && pr.branch) snapshot.branch = toObjectId(pr.branch);
  }

  if (snapshot.branch) snapshot.inWarehouse = false;
  return snapshot;
}

/**
 * Restore stock for a return line. Soft-unhides removedWhenOutOfStock rows.
 * Recreates hard-deleted legacy products when enough snapshot data exists.
 */
export async function restoreProductStockForReturn(order, line, quantity) {
  const qty = Math.max(0, Math.floor(Number(quantity) || 0));
  if (qty <= 0) return null;

  let product = await Product.findById(line.productId);
  if (product) {
    product.stock = Math.max(0, (Number(product.stock) || 0) + qty);
    product.removedWhenOutOfStock = false;
    await product.save();
    return product;
  }

  // Same code may still exist (recreated / soft-hidden under another id)
  const code = String(line?.code || '').trim();
  const orderBranch = order?.branch ? toObjectId(order.branch) : null;
  if (code) {
    const byCode = await Product.findOne({
      code,
      ...(orderBranch
        ? { branch: orderBranch }
        : { $or: [{ branch: null }, { branch: { $exists: false } }] }),
    });
    if (byCode) {
      byCode.stock = Math.max(0, (Number(byCode.stock) || 0) + qty);
      byCode.removedWhenOutOfStock = false;
      await byCode.save();
      return byCode;
    }
  }

  const snapshot = await snapshotForDeletedProduct(order, line);
  if (!snapshot.category) {
    throw new Error(
      `Cannot restore product ${code || line.productId}: it was deleted and category data is missing. Re-add it manually, then retry the return.`
    );
  }

  const createPayload = {
    name: snapshot.name,
    code: snapshot.code,
    price: snapshot.price,
    netPrice: snapshot.netPrice,
    stock: qty,
    discount: snapshot.discount || 0,
    category: snapshot.category,
    branch: snapshot.branch,
    inWarehouse: !!snapshot.inWarehouse && !snapshot.branch,
    imageUrl: snapshot.imageUrl || '',
    attributes: snapshot.attributes || {},
    addedBy: snapshot.addedBy || '',
    removedWhenOutOfStock: false,
  };

  if (line.productId && mongoose.Types.ObjectId.isValid(String(line.productId))) {
    createPayload._id = new mongoose.Types.ObjectId(String(line.productId));
  }

  try {
    product = await Product.create(createPayload);
  } catch (err) {
    if (err?.code === 11000 && code) {
      const conflict = await Product.findOne({
        code,
        ...(snapshot.branch
          ? { branch: snapshot.branch }
          : { $or: [{ branch: null }, { branch: { $exists: false } }] }),
      });
      if (conflict) {
        conflict.stock = Math.max(0, (Number(conflict.stock) || 0) + qty);
        conflict.removedWhenOutOfStock = false;
        await conflict.save();
        return conflict;
      }
    }
    throw err;
  }

  return product;
}

function normalizeReturnItems(order, { returnAll, items }) {
  if (returnAll) {
    return (order.products || [])
      .map((line) => {
        const qty = orderLineRemainingQty(line, order);
        if (qty <= 0) return null;
        return {
          productId: line.productId,
          quantity: qty,
          unitRefundPrice: round2(Number(line.price) || 0),
        };
      })
      .filter(Boolean);
  }

  if (!Array.isArray(items) || !items.length) {
    throw new Error('Return items are required');
  }

  const out = [];
  for (const row of items) {
    const productId = row?.productId;
    if (!productId || !mongoose.Types.ObjectId.isValid(String(productId))) {
      throw new Error('Invalid product id in return items');
    }
    const line = findOrderLine(order, productId);
    if (!line) {
      throw new Error('Product not found on this invoice');
    }
    const qty = Math.floor(Number(row?.quantity) || 0);
    if (qty <= 0) {
      throw new Error('Return quantity must be at least 1');
    }
    const remaining = orderLineRemainingQty(line, order);
    if (qty > remaining) {
      throw new Error(`Return quantity exceeds remaining for ${line.code}`);
    }
    const unitRefundPrice = round2(row?.unitRefundPrice ?? line.price);
    if (!Number.isFinite(unitRefundPrice) || unitRefundPrice < 0) {
      throw new Error('Valid unit refund price is required');
    }
    out.push({ productId: line.productId, quantity: qty, unitRefundPrice });
  }
  return out;
}

function normalizeRefundSplits(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => ({
      method: normalizePayMethod(row?.method),
      amount: round2(row?.amount),
    }))
    .filter((r) => r.method && r.amount > 0);
}

function recalcPaymentStatus(order) {
  const total = round2(Number(order.totalPrice) || 0);
  const paid = round2(Number(order.amountPaid) || 0);
  if (paid >= total - 0.001) {
    order.paymentStatus = 'paid';
  } else if (paid > 0) {
    order.paymentStatus = 'partial';
  } else {
    order.paymentStatus = 'unpaid';
  }
}

/**
 * Process a partial or full sales invoice return.
 * @returns {{ order, returnRecord, cashRefundTotal, creditAdjustmentAmount }}
 */
export async function processOrderReturn(order, body = {}) {
  if (!order) {
    throw new Error('Order not found');
  }
  if (order.status === 'restored') {
    throw new Error('Order is already fully returned');
  }

  const returnAll = body.returnAll === true || body.returnAll === 'true';
  const returnItems = normalizeReturnItems(order, {
    returnAll,
    items: body.items,
  });
  if (!returnItems.length) {
    throw new Error('Nothing left to return on this invoice');
  }

  const refundTotal = round2(
    returnItems.reduce((acc, row) => acc + row.quantity * row.unitRefundPrice, 0)
  );
  if (refundTotal <= 0) {
    throw new Error('Refund total must be greater than zero');
  }

  const creditOrder = isClientCreditOrder(order);
  let creditAdjustmentAmount = salesCreditAdjustment(order, refundTotal);
  let cashRefundDue = salesRefundCashDue(order, refundTotal);
  let refundPaymentSplits = [];
  let refundTreasurySplits;
  let cashRefundVia = 'drawer';

  const treasuryMethods = await getEffectivePurchaseTreasuryMethodsFromDb();
  const tMap = treasuryMethodMap(treasuryMethods);
  const cashViaRaw = String(body.cashRefundVia || 'drawer').toLowerCase();
  const cashTreasuryKey = String(body.cashTreasuryKey || '').trim().toLowerCase();

  if (creditOrder) {
    const currentTotal = round2(Number(order.totalPrice) || 0);
    const newTotal = round2(Math.max(0, currentTotal - refundTotal));
    const alreadyPaid = round2(Number(order.amountPaid) || 0);

    if (cashRefundDue > 0.001) {
      const baseSplits = await netSettlementFeesOnPaymentSplits(
        buildSalesRefundPaymentSplits(order, cashRefundDue),
        order.payments
      );
      const finalized = finalizeSalesRefundSplits(baseSplits, {
        cashRefundVia: cashViaRaw,
        cashTreasuryKey,
        cashTreasuryLabel: body.cashTreasuryLabel,
        tMap,
      });
      refundPaymentSplits = finalized.refundPaymentSplits || [];
      refundTreasurySplits = finalized.refundTreasurySplits;
      cashRefundVia = finalized.cashRefundVia;
      order.amountPaid = round2(alreadyPaid - cashRefundDue);
    }

    order.totalPrice = newTotal;
    if (order.subtotalPrice != null) {
      order.subtotalPrice = round2(Math.max(0, Number(order.subtotalPrice) - refundTotal));
    }
    recalcPaymentStatus(order);
  } else {
    const baseSplits = await netSettlementFeesOnPaymentSplits(
      buildSalesRefundPaymentSplits(order, refundTotal),
      order.payments
    );
    const finalized = finalizeSalesRefundSplits(baseSplits, {
      cashRefundVia: cashViaRaw,
      cashTreasuryKey,
      cashTreasuryLabel: body.cashTreasuryLabel,
      tMap,
    });
    refundPaymentSplits = finalized.refundPaymentSplits || [];
    refundTreasurySplits = finalized.refundTreasurySplits;
    cashRefundVia = finalized.cashRefundVia;

    const splitSum = round2(
      (refundPaymentSplits || []).reduce((a, s) => a + s.amount, 0) +
        (refundTreasurySplits || []).reduce((a, s) => a + s.amount, 0)
    );
    if (Math.abs(splitSum - refundTotal) > 0.02) {
      throw new Error('Refund allocation must equal the refund total');
    }

    order.totalPrice = round2(Math.max(0, (Number(order.totalPrice) || 0) - refundTotal));
    if (order.subtotalPrice != null) {
      order.subtotalPrice = round2(Math.max(0, Number(order.subtotalPrice) - refundTotal));
    }
  }

  for (const row of returnItems) {
    const line = findOrderLine(order, row.productId);
    if (!line) continue;
    const alreadyReturned = Math.max(
      Math.floor(Number(line.returnedQuantity) || 0),
      returnedQtyFromHistory(order, line.productId)
    );
    line.returnedQuantity = alreadyReturned + row.quantity;

    const product = await restoreProductStockForReturn(order, line, row.quantity);
    if (product) {
      try {
        await StockMovement.create({
          movementType: 'return',
          productId: product._id,
          productName: product.name,
          branchId: order.branch || null,
          fromBranchId: null,
          toBranchId: order.branch || null,
          quantity: row.quantity,
          unitPrice: row.unitRefundPrice,
          totalValue: round2(row.quantity * row.unitRefundPrice),
          referenceType: 'order',
          referenceId: order._id,
          notes: `Return order #${order.orderNumber}`,
        });
      } catch (movementError) {
        console.error('⚠️ Failed to log return stock movement:', movementError.message);
      }
    }
  }

  order.numberOfProducts = Math.max(
    0,
    (order.products || []).reduce((acc, line) => acc + orderLineRemainingQty(line, order), 0)
  );
  order.markModified('products');

  const now = new Date();
  const returnRecord = {
    returnedAt: now,
    returnedByUserId:
      body.userId && mongoose.Types.ObjectId.isValid(String(body.userId))
        ? new mongoose.Types.ObjectId(String(body.userId))
        : undefined,
    returnAll,
    items: returnItems.map((row) => ({
      productId: row.productId,
      quantity: row.quantity,
      unitRefundPrice: row.unitRefundPrice,
      lineTotal: round2(row.quantity * row.unitRefundPrice),
    })),
    refundTotal,
    refundPaymentSplits: refundPaymentSplits?.length ? refundPaymentSplits : undefined,
    refundTreasurySplits,
    cashRefundVia,
    creditAdjustmentAmount,
    note: String(body.note || '').trim().slice(0, 500),
  };

  order.returns = order.returns || [];
  order.returns.push(returnRecord);
  order.markModified('returns');

  const fullyReturned = orderIsFullyReturned(order);
  if (fullyReturned) {
    order.status = 'restored';
    order.restoredAt = now;
  } else {
    order.status = 'partially_restored';
  }

  await order.save();

  const cashRefundTotal =
    cashRefundVia === 'drawer'
      ? round2(
          (returnRecord.refundPaymentSplits || []).reduce(
            (acc, s) =>
              acc + (normalizePayMethod(s.method) === 'cash' ? Number(s.amount) || 0 : 0),
            0
          )
        )
      : 0;

  return { order, returnRecord, cashRefundTotal, creditAdjustmentAmount };
}

export function refundAllocationFromReturnRecord(returnRecord) {
  const map = {};
  for (const s of returnRecord?.refundPaymentSplits || []) {
    const m = normalizePayMethod(s.method);
    map[m] = round2((map[m] || 0) + Number(s.amount || 0));
  }
  return map;
}

/** Treasury lines for sales returns where cash portion was refunded via purchase treasury (not drawer). */
export function salesReturnTreasuryRefundLines(returnRecord) {
  if (String(returnRecord?.cashRefundVia || 'drawer').toLowerCase() !== 'treasury') {
    return [];
  }
  const lines = [];
  for (const s of returnRecord?.refundTreasurySplits || []) {
    const key = String(s?.key || '')
      .trim()
      .toLowerCase();
    if (!key || key === 'cash' || key === 'deferred') continue;
    const amount = round2(Number(s.amount || 0));
    if (amount <= 0) continue;
    lines.push({
      key,
      label: String(s.label || key).trim() || key,
      amount,
    });
  }
  return lines;
}

/** Legacy full restore — all remaining items at line price, proportional refund split. */
export async function processFullOrderRestore(order, { userId, note } = {}) {
  return processOrderReturn(order, {
    returnAll: true,
    userId,
    note: note || 'Full invoice return',
  });
}
