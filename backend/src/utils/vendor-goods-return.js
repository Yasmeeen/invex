import mongoose from 'mongoose';
import Category from '../DB/models/category.model.js';
import Product from '../DB/models/product.model.js';
import PurchasingRequest from '../DB/models/purchasingRequest.model.js';
import StockMovement from '../DB/models/stockMovement.model.js';
import Vendor from '../DB/models/vendor.model.js';
import { syncDeskPurchasePaidFromLinkedRequest } from './desk-purchase-deferred.js';
import { computeSupplierOwesUs } from './vendor-balance-utils.js';
import {
  buildNetBalanceMessage,
  buildSettlementPreview,
  computeTotalCreditOwed,
} from './vendor-balance-summary.js';
import {
  applyGoodsReturnAgainstPayables,
  computePurchasePayableBreakdown,
} from './vendor-purchase-ledger.js';

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function httpError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function isWeightProduct(product, category) {
  if (product?.sellByWeightOverride === true) return true;
  if (product?.sellByWeightOverride === false) return false;
  return !!category?.sellByWeight;
}

function availableQty(product) {
  const stock = Number(product?.stock) || 0;
  const reserved =
    (Number(product?.transferReservedQuantity) || 0) +
    (Number(product?.bookedQuantity) || 0) +
    (Number(product?.ecommerceReservedQuantity) || 0);
  return Math.max(0, stock - reserved);
}

function productLabel(product) {
  const name = String(product?.name || '').trim();
  const code = String(product?.code || '').trim();
  if (name && code) return `«${name}» (${code})`;
  if (name) return `«${name}»`;
  if (code) return `(${code})`;
  return 'المنتج';
}

function buildLedgerNote(lines, appliedToPayable, addedToDebit, userNote) {
  const items = lines
    .map((line) => `${line.name}${line.code ? ` (${line.code})` : ''} × ${line.quantity}`)
    .join('، ');
  const parts = [`مرتجع بضاعة للمورد — ${items}`];
  if (appliedToPayable > 0) {
    parts.push(`خُصم من المستحق ${appliedToPayable.toFixed(2)}`);
  }
  if (addedToDebit > 0) {
    parts.push(`الباقي على المورد ${addedToDebit.toFixed(2)}`);
  }
  const extra = String(userNote || '').trim();
  if (extra) parts.push(extra);
  return parts.join(' — ').slice(0, 800);
}

/**
 * Return in-stock goods to a supplier on account (no cash).
 * Credit hits unpaid purchase payables first; the remainder increases what the supplier owes us.
 */
export async function processVendorGoodsReturn(vendorId, body = {}) {
  if (!vendorId || !mongoose.Types.ObjectId.isValid(String(vendorId))) {
    throw httpError('المورد غير موجود', 404);
  }

  const branchRaw = String(body.branchId || '').trim();
  if (!branchRaw || !mongoose.Types.ObjectId.isValid(branchRaw)) {
    throw httpError('اختر الفرع الذي ستخرج منه البضاعة');
  }
  const branchId = new mongoose.Types.ObjectId(branchRaw);

  const rawLines = Array.isArray(body.lines) ? body.lines : [];
  if (!rawLines.length) {
    throw httpError('أضف منتجاً واحداً على الأقل');
  }
  if (rawLines.length > 40) {
    throw httpError('الحد الأقصى ٤٠ منتجاً في المرتجع الواحد');
  }

  const seen = new Set();
  const normalized = [];
  for (const row of rawLines) {
    const productId = String(row?.productId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      throw httpError('منتج غير صالح');
    }
    if (seen.has(productId)) {
      throw httpError('المنتج مكرر في نفس المرتجع');
    }
    seen.add(productId);
    const quantity = Number(row?.quantity);
    const unitPrice = round2(row?.unitPrice);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw httpError('الكمية غير صالحة');
    }
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
      throw httpError('سعر الوحدة غير صالح');
    }
    normalized.push({ productId, quantity, unitPrice });
  }

  const session = await mongoose.startSession();
  let result;
  try {
    session.startTransaction();
    result = await applyReturnInSession(vendorId, branchId, normalized, body, session);
    await session.commitTransaction();
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    throw error;
  } finally {
    session.endSession();
  }

  for (const id of result.deferredRequestIds || []) {
    try {
      const pr = await PurchasingRequest.findById(id);
      if (pr) await syncDeskPurchasePaidFromLinkedRequest(pr);
    } catch (syncErr) {
      console.warn('⚠️ sync desk purchase after supplier goods return:', syncErr?.message || syncErr);
    }
  }

  const supplierOwesUs = await computeSupplierOwesUs(vendorId);
  const purchasePayableBreakdown = await computePurchasePayableBreakdown(vendorId);
  const vendor = await Vendor.findById(vendorId)
    .select('creditBalance buyerPrepaidBalance goodsReturnDebitBalance')
    .lean();
  const weOweSupplier = computeTotalCreditOwed(
    vendor?.creditBalance,
    purchasePayableBreakdown.total,
    vendor?.buyerPrepaidBalance
  );

  return {
    message: 'Supplier goods return recorded',
    total: result.total,
    appliedToPayable: result.appliedToPayable,
    addedToDebit: result.addedToDebit,
    supplierOwesUs,
    weOweSupplier,
    owesFromGoodsReturns: round2(vendor?.goodsReturnDebitBalance),
    purchasePayable: purchasePayableBreakdown.total,
    netBalanceMessage: buildNetBalanceMessage(supplierOwesUs, weOweSupplier),
    settlementPreview: buildSettlementPreview(supplierOwesUs, weOweSupplier),
    lines: result.lines,
  };
}

async function applyReturnInSession(vendorId, branchId, normalized, body, session) {
  const vendor = await Vendor.findById(vendorId).session(session);
  if (!vendor) throw httpError('المورد غير موجود', 404);

  const uid = mongoose.Types.ObjectId.isValid(String(body.userId || ''))
    ? new mongoose.Types.ObjectId(String(body.userId))
    : undefined;

  const prepared = [];
  for (const row of normalized) {
    const product = await Product.findById(row.productId).session(session);
    if (!product || product.removedWhenOutOfStock) {
      throw httpError('المنتج غير موجود في المخزون');
    }
    if (String(product.branch || '') !== String(branchId)) {
      throw httpError(`المنتج ${productLabel(product)} ليس في مخزن الفرع المختار`);
    }

    const category = product.category
      ? await Category.findById(product.category)
          .select('sellByWeight deleteProductWhenOutOfStock')
          .session(session)
      : null;
    const weight = isWeightProduct(product, category);
    const quantity = weight
      ? Math.round(row.quantity * 1000) / 1000
      : Math.floor(row.quantity);
    if (!weight && Math.abs(row.quantity - quantity) > 0.0001) {
      throw httpError(`الكمية غير صالحة للمنتج ${productLabel(product)}`);
    }
    if (quantity <= 0) {
      throw httpError(`الكمية غير صالحة للمنتج ${productLabel(product)}`);
    }

    const available = availableQty(product);
    const cap = weight ? Math.round(available * 1000) / 1000 : Math.floor(available + 1e-9);
    if (quantity > cap + (weight ? 0.0001 : 0)) {
      throw httpError(
        `الكمية أكبر من المتاح للمنتج ${productLabel(product)}. المتاح: ${cap}`
      );
    }

    const lineTotal = round2(quantity * row.unitPrice);
    if (lineTotal <= 0) {
      throw httpError(`قيمة المرتجع غير صالحة للمنتج ${productLabel(product)}`);
    }

    prepared.push({
      product,
      category,
      quantity,
      unitPrice: row.unitPrice,
      lineTotal,
      name: String(product.name || '').trim(),
      code: String(product.code || '').trim(),
    });
  }

  const total = round2(prepared.reduce((sum, line) => sum + line.lineTotal, 0));
  if (total <= 0) throw httpError('قيمة المرتجع يجب أن تكون أكبر من صفر');

  const { applied, deferredRequestIds } = await applyGoodsReturnAgainstPayables(
    vendor._id,
    total,
    { session }
  );
  const appliedToPayable = round2(applied);
  const addedToDebit = round2(Math.max(0, total - appliedToPayable));

  for (const line of prepared) {
    const nextStock = isWeightProduct(line.product, line.category)
      ? Math.round((Number(line.product.stock) - line.quantity) * 1000) / 1000
      : Number(line.product.stock) - line.quantity;
    line.product.stock = Math.max(0, nextStock);
    if (
      Number(line.product.stock) <= 0.0001 &&
      line.category?.deleteProductWhenOutOfStock
    ) {
      line.product.stock = 0;
      line.product.removedWhenOutOfStock = true;
    }
    await line.product.save({ session });
  }

  const movementDocs = prepared.map((line) => ({
    movementType: 'supplier_return',
    productId: line.product._id,
    productName: line.name,
    branchId,
    fromBranchId: branchId,
    toBranchId: null,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    totalValue: line.lineTotal,
    referenceType: 'vendor_goods_return',
    referenceId: vendor._id,
    notes: `مرتجع للمورد ${vendor.nameOfcompany || vendor.name} — ${line.name}`,
  }));
  await StockMovement.create(movementDocs, { session });

  vendor.goodsReturnDebitBalance = round2(
    (Number(vendor.goodsReturnDebitBalance) || 0) + addedToDebit
  );
  vendor.ledgerEntries = vendor.ledgerEntries || [];
  vendor.ledgerEntries.push({
    type: 'goods_return',
    amount: total,
    note: buildLedgerNote(prepared, appliedToPayable, addedToDebit, body.note),
    branch: branchId,
    createdAt: new Date(),
    createdByUserId: uid,
  });
  await vendor.save({ session });

  return {
    deferredRequestIds,
    total,
    appliedToPayable,
    addedToDebit,
    lines: prepared.map((line) => ({
      productId: String(line.product._id),
      name: line.name,
      code: line.code,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      lineTotal: line.lineTotal,
    })),
  };
}
