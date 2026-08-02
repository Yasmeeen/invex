import mongoose from 'mongoose';
import Product from '../../DB/models/product.model.js';
import Order from '../../DB/models/order.model.js';
import ProductBooking from '../../DB/models/productBooking.model.js';
import User from '../../DB/models/user.model.js';

const toObjectIdOrNull = (v) => {
  const s = String(v || '').trim();
  if (!s) return null;
  return mongoose.Types.ObjectId.isValid(s) ? new mongoose.Types.ObjectId(s) : null;
};

const pickStr = (...vals) => {
  for (const v of vals) {
    if (v == null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return '';
};

/** Build a human-readable entity label from already-stored audit fields (no DB). */
export function buildEntityLabelFromDoc(row) {
  if (!row) return '';
  if (pickStr(row.entityLabel)) return pickStr(row.entityLabel);

  const type = pickStr(row.entityType);
  const module = pickStr(row.module);
  const meta = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
  const after = row.after && typeof row.after === 'object' ? row.after : {};
  const before = row.before && typeof row.before === 'object' ? row.before : {};

  const orderNumber =
    meta.orderNumber ?? after.orderNumber ?? before.orderNumber ?? null;
  if (
    (type === 'Order' || module === 'orders') &&
    orderNumber != null &&
    String(orderNumber).trim() !== ''
  ) {
    return `#${orderNumber}`;
  }

  const codesArr = Array.isArray(after.codes)
    ? after.codes.map((c) => String(c || '').trim()).filter(Boolean)
    : Array.isArray(meta.productCodes)
      ? meta.productCodes.map((c) => String(c || '').trim()).filter(Boolean)
      : [];

  const code = pickStr(
    after.code,
    before.code,
    meta.productCode,
    meta.code,
    codesArr.length ? codesArr.join(', ') : ''
  );
  const name = pickStr(after.name, before.name, meta.productName, meta.name);

  if (type === 'Product' || module === 'products' || type === 'ProductBranchTransfer') {
    if (code && name) return `${code} — ${name}`;
    if (code) return code;
    if (name) return name;
  }

  if (type === 'ProductBooking' || module === 'bookings') {
    const bCode = pickStr(meta.productCode, after.productCode, before.productCode, code);
    const bName = pickStr(meta.productName, after.productName, before.productName, name);
    const qty = meta.quantity ?? after.quantity;
    const base = bCode && bName ? `${bCode} — ${bName}` : bCode || bName;
    if (base && qty != null) return `${base} ×${qty}`;
    if (base) return base;
    if (meta.customerName) return pickStr(meta.customerName);
  }

  if (type === 'ProductPurchaseRequest' || module === 'product_purchase_requests') {
    if (code && name) return `${code} — ${name}`;
    if (code) return code;
    if (name) return name;
  }

  if (type === 'User' || module === 'auth') {
    return pickStr(meta.email, row.actorName, row.entityId);
  }

  return pickStr(row.message);
}

/** Prefer business status; fall back to HTTP outcome label key. */
export function pickBusinessStatus(row) {
  const meta = row?.metadata && typeof row.metadata === 'object' ? row.metadata : {};
  const after = row?.after && typeof row.after === 'object' ? row.after : {};
  const before = row?.before && typeof row.before === 'object' ? row.before : {};
  return pickStr(meta.status, after.status, before.status, meta.paymentStatus, after.paymentStatus);
}

export function httpStatusLabelKey(statusCode) {
  const n = Number(statusCode);
  if (!Number.isFinite(n)) return '';
  if (n >= 200 && n < 300) return 'success';
  if (n === 401 || n === 403) return 'unauthorized';
  if (n === 404) return 'not_found';
  if (n >= 400 && n < 500) return 'client_error';
  if (n >= 500) return 'server_error';
  return String(n);
}

/**
 * Enrich lean audit rows for API response: actor names, entity labels, status keys.
 * Batches lookups for missing product/order/user data.
 */
export async function enrichAuditRows(rows) {
  if (!Array.isArray(rows) || !rows.length) return [];

  const missingActorIds = new Set();
  const productIds = new Set();
  const orderIds = new Set();
  const bookingIds = new Set();

  for (const row of rows) {
    if (row.actorUserId && !pickStr(row.actorName)) {
      const id = toObjectIdOrNull(row.actorUserId);
      if (id) missingActorIds.add(String(id));
    }

    const label = buildEntityLabelFromDoc(row);
    const type = pickStr(row.entityType);
    const module = pickStr(row.module);
    const meta = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};

    if (!label) {
      if ((type === 'Product' || module === 'products') && row.entityId) {
        const id = toObjectIdOrNull(row.entityId);
        if (id) productIds.add(String(id));
      }
      if ((type === 'Order' || module === 'orders') && row.entityId) {
        const id = toObjectIdOrNull(row.entityId);
        if (id) orderIds.add(String(id));
      }
      if ((type === 'ProductBooking' || module === 'bookings') && row.entityId) {
        const id = toObjectIdOrNull(row.entityId);
        if (id) bookingIds.add(String(id));
      }
    }

    // Bookings often only store productId in metadata
    if ((type === 'ProductBooking' || module === 'bookings') && !pickStr(meta.productCode, meta.productName)) {
      const pid = toObjectIdOrNull(meta.productId || meta.product);
      if (pid) productIds.add(String(pid));
    }

    // Purchase approve often stores productId only
    if (
      (type === 'ProductPurchaseRequest' || module === 'product_purchase_requests') &&
      !pickStr(meta.productCode, meta.productName) &&
      (meta.productId || meta.createdProductId)
    ) {
      const pid = toObjectIdOrNull(meta.productId || meta.createdProductId);
      if (pid) productIds.add(String(pid));
    }

    // Branch transfers
    if (type === 'ProductBranchTransfer' && meta.productId) {
      const pid = toObjectIdOrNull(meta.productId);
      if (pid) productIds.add(String(pid));
    }
  }

  const [users, products, orders, bookings] = await Promise.all([
    missingActorIds.size
      ? User.find({ _id: { $in: [...missingActorIds] } })
          .select('name role')
          .lean()
      : [],
    productIds.size
      ? Product.find({ _id: { $in: [...productIds] } })
          .select('name code')
          .lean()
      : [],
    orderIds.size
      ? Order.find({ _id: { $in: [...orderIds] } })
          .select('orderNumber')
          .lean()
      : [],
    bookingIds.size
      ? ProductBooking.find({ _id: { $in: [...bookingIds] } })
          .select('productNameSnapshot productCodeSnapshot quantity customerName product status')
          .lean()
      : [],
  ]);

  const userMap = new Map(users.map((u) => [String(u._id), u]));
  const productMap = new Map(products.map((p) => [String(p._id), p]));
  const orderMap = new Map(orders.map((o) => [String(o._id), o]));
  const bookingMap = new Map(bookings.map((b) => [String(b._id), b]));

  // Resolve booking product refs not already loaded
  const extraProductIds = new Set();
  for (const b of bookings) {
    if (!pickStr(b.productCodeSnapshot, b.productNameSnapshot) && b.product) {
      const pid = toObjectIdOrNull(b.product);
      if (pid && !productMap.has(String(pid))) extraProductIds.add(String(pid));
    }
  }
  if (extraProductIds.size) {
    const extra = await Product.find({ _id: { $in: [...extraProductIds] } })
      .select('name code')
      .lean();
    for (const p of extra) productMap.set(String(p._id), p);
  }

  return rows.map((row) => {
    const out = { ...row };
    const meta = out.metadata && typeof out.metadata === 'object' ? { ...out.metadata } : {};

    if (out.actorUserId && !pickStr(out.actorName)) {
      const u = userMap.get(String(out.actorUserId));
      if (u) {
        out.actorName = u.name;
        if (!pickStr(out.actorRole)) out.actorRole = u.role;
      }
    }

    let entityLabel = buildEntityLabelFromDoc(out);
    const type = pickStr(out.entityType);
    const module = pickStr(out.module);

    if (!entityLabel && (type === 'Order' || module === 'orders') && out.entityId) {
      const o = orderMap.get(String(out.entityId));
      if (o?.orderNumber != null) {
        entityLabel = `#${o.orderNumber}`;
        meta.orderNumber = o.orderNumber;
      }
    }

    if (!entityLabel && (type === 'Product' || module === 'products') && out.entityId) {
      const p = productMap.get(String(out.entityId));
      if (p) {
        entityLabel = p.code && p.name ? `${p.code} — ${p.name}` : pickStr(p.code, p.name);
        if (p.code) meta.productCode = meta.productCode || p.code;
        if (p.name) meta.productName = meta.productName || p.name;
      }
    }

    if (type === 'ProductBooking' || module === 'bookings') {
      const booking = out.entityId ? bookingMap.get(String(out.entityId)) : null;
      const pid = toObjectIdOrNull(meta.productId || meta.product || booking?.product);
      const p = pid ? productMap.get(String(pid)) : null;
      const bCode = pickStr(
        meta.productCode,
        booking?.productCodeSnapshot,
        p?.code
      );
      const bName = pickStr(
        meta.productName,
        booking?.productNameSnapshot,
        p?.name
      );
      const qty = meta.quantity ?? booking?.quantity;
      let base = '';
      if (bCode && bName) base = `${bCode} — ${bName}`;
      else base = pickStr(bCode, bName, booking?.customerName);
      if (!entityLabel) {
        entityLabel = base && qty != null ? `${base} ×${qty}` : base;
      }
      if (bCode) meta.productCode = meta.productCode || bCode;
      if (bName) meta.productName = meta.productName || bName;
    }

    if (
      (type === 'ProductPurchaseRequest' ||
        module === 'product_purchase_requests' ||
        type === 'ProductBranchTransfer') &&
      !entityLabel
    ) {
      const pid = toObjectIdOrNull(meta.productId || meta.createdProductId);
      const p = pid ? productMap.get(String(pid)) : null;
      if (p) {
        entityLabel = p.code && p.name ? `${p.code} — ${p.name}` : pickStr(p.code, p.name);
        if (p.code) meta.productCode = meta.productCode || p.code;
        if (p.name) meta.productName = meta.productName || p.name;
      }
    }

    if (!entityLabel) {
      entityLabel = pickStr(out.message) || (type ? type : '');
    }

    const businessStatus = pickBusinessStatus(out);
    const httpKey = httpStatusLabelKey(out.statusCode);

    out.entityLabel = entityLabel || undefined;
    out.businessStatus = businessStatus || undefined;
    out.httpStatusKey = httpKey || undefined;
    out.metadata = Object.keys(meta).length ? meta : out.metadata;
    // Keep entityId for filters/debug but UI should prefer entityLabel
    return out;
  });
}
