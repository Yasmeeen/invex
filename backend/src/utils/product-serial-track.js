import mongoose from 'mongoose';
import AuditLog from '../DB/models/auditLog.model.js';
import Order from '../DB/models/order.model.js';
import Product from '../DB/models/product.model.js';
import ProductPurchaseRequest from '../DB/models/productPurchaseRequest.model.js';
import { buildProductHistoryEvents } from './product-history.js';

function normalizeCode(code) {
  return String(code || '').trim().toUpperCase();
}

function escapeRegex(s) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function productCodeSuffix(code) {
  const normalized = normalizeCode(code);
  if (!normalized) return '';
  const parts = normalized.split('-');
  return parts[parts.length - 1] || normalized;
}

function suffixMatches(productSuffix, scanned) {
  if (!productSuffix || !scanned) return false;
  if (productSuffix === scanned) return true;
  if (/^\d+$/.test(productSuffix) && /^\d+$/.test(scanned)) {
    return Number(productSuffix) === Number(scanned);
  }
  return false;
}

function codeMatchesStored(storedCode, input) {
  const stored = normalizeCode(storedCode);
  const scanned = normalizeCode(input);
  if (!stored || !scanned) return false;
  if (stored === scanned) return true;
  const scannedSuffix = scanned.replace(/^-/, '');
  if (!scannedSuffix) return false;
  if (stored.endsWith('-' + scannedSuffix)) return true;
  return suffixMatches(productCodeSuffix(stored), scannedSuffix);
}

function pickBestCodeMatch(candidates, input) {
  const scanned = normalizeCode(input);
  if (!candidates?.length) return null;
  const exact = candidates.filter((c) => normalizeCode(c.code) === scanned);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return exact[0];

  const scannedSuffix = scanned.replace(/^-/, '');
  const suffixHits = candidates.filter((c) => codeMatchesStored(c.code, scanned));
  if (!suffixHits.length) return null;
  if (suffixHits.length === 1) return suffixHits[0];

  const exactSuffix = suffixHits.filter(
    (c) => productCodeSuffix(c.code) === scannedSuffix
  );
  return exactSuffix[0] || suffixHits[0];
}

function attrsToObject(attributes) {
  if (!attributes) return {};
  if (attributes instanceof Map) {
    return Object.fromEntries(attributes.entries());
  }
  if (typeof attributes === 'object') {
    return { ...attributes };
  }
  return {};
}

function formatProductPayload(product, extras = {}) {
  return {
    _id: product._id,
    name: product.name || '',
    code: product.code || '',
    stock: Number(product.stock) || 0,
    inWarehouse: !!product.inWarehouse,
    branch: product.branch || null,
    category: product.category || null,
    addedBy: product.addedBy || '',
    price: product.price,
    netPrice: product.netPrice,
    attributes: attrsToObject(product.attributes),
    acquiredFrom: product.acquiredFrom || null,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
    ...extras,
  };
}

function stockStatus(product, exists) {
  if (!exists) return 'removed_from_stock';
  if (product?.removedWhenOutOfStock) return 'removed_from_stock';
  if (Number(product.stock) > 0) return 'in_stock';
  return 'out_of_stock';
}

/**
 * Resolve a unit/serial code to product details + history.
 * Works even when the product row was hard-deleted (sold / returned / manual delete).
 */
export async function trackProductByCode(rawCode) {
  const code = String(rawCode || '').trim();
  if (!code) {
    return { ok: false, statusCode: 400, error: 'code is required' };
  }

  const normalized = normalizeCode(code);
  const scannedSuffix = normalized.replace(/^-/, '');
  const exactRe = new RegExp(`^${escapeRegex(normalized)}$`, 'i');
  const suffixRe = scannedSuffix
    ? new RegExp(`-${escapeRegex(scannedSuffix)}$`, 'i')
    : null;

  const liveFilter = suffixRe
    ? { $or: [{ code: exactRe }, { code: suffixRe }] }
    : { code: exactRe };

  const liveProducts = await Product.find(liveFilter)
    .populate('category', 'name code')
    .populate('branch', 'name')
    .lean();

  const liveMatches = (liveProducts || []).filter((p) => codeMatchesStored(p.code, code));
  const live = pickBestCodeMatch(liveMatches, code);

  if (live) {
    const { events } = await buildProductHistoryEvents(live);
    return {
      ok: true,
      exists: true,
      status: stockStatus(live, true),
      product: formatProductPayload(live),
      events,
    };
  }

  // Product row gone — reconstruct from orders / audits / purchases
  const [orders, audits, purchases] = await Promise.all([
    Order.find({
      $or: [
        { 'products.code': exactRe },
        ...(suffixRe ? [{ 'products.code': suffixRe }] : []),
      ],
    })
      .select(
        'orderNumber products status createdAt branch clientName sellerName'
      )
      .populate('branch', 'name')
      .sort({ createdAt: -1 })
      .limit(50)
      .lean(),

    AuditLog.find({
      entityType: 'Product',
      $or: [
        { 'before.code': exactRe },
        { 'after.code': exactRe },
        { message: exactRe },
        ...(suffixRe
          ? [
              { 'before.code': suffixRe },
              { 'after.code': suffixRe },
              { message: suffixRe },
            ]
          : []),
      ],
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean(),

    ProductPurchaseRequest.find({
      $or: [
        { 'productPayload.code': exactRe },
        { 'productPayload.unitCodes': exactRe },
        ...(suffixRe
          ? [
              { 'productPayload.code': suffixRe },
              { 'productPayload.unitCodes': suffixRe },
            ]
          : []),
      ],
    })
      .populate('branch', 'name')
      .populate('productPayload.category', 'name code')
      .sort({ createdAt: -1 })
      .limit(20)
      .lean(),
  ]);

  let productId = null;
  let snapshot = {
    name: '',
    code: normalized,
    stock: 0,
    inWarehouse: false,
    branch: null,
    category: null,
    addedBy: '',
    price: undefined,
    netPrice: undefined,
    attributes: {},
    acquiredFrom: null,
    createdAt: null,
    updatedAt: null,
  };

  for (const order of orders) {
    const line = (order.products || []).find((p) => codeMatchesStored(p.code, code));
    if (!line) continue;
    if (!productId && line.productId) {
      productId = String(line.productId);
    }
    if (!snapshot.name && line.name) snapshot.name = line.name;
    if (line.code) snapshot.code = line.code;
    if (snapshot.price == null && line.price != null) snapshot.price = line.price;
    if (snapshot.netPrice == null && line.cost != null) snapshot.netPrice = line.cost;
    if (!snapshot.branch && order.branch) snapshot.branch = order.branch;
    if (!snapshot.updatedAt || new Date(order.createdAt) > new Date(snapshot.updatedAt)) {
      snapshot.updatedAt = order.createdAt;
    }
  }

  for (const log of audits) {
    const beforeCode = log.before?.code;
    const afterCode = log.after?.code;
    const matched =
      codeMatchesStored(beforeCode, code) ||
      codeMatchesStored(afterCode, code) ||
      (log.message && normalizeCode(log.message).includes(normalized));
    if (!matched) continue;

    if (!productId && log.entityId) productId = String(log.entityId);

    const src = log.before || log.after || {};
    if (!snapshot.name && src.name) snapshot.name = src.name;
    if (src.code && codeMatchesStored(src.code, code)) snapshot.code = src.code;
    if (src.addedBy) snapshot.addedBy = src.addedBy;
    if (src.inWarehouse != null) snapshot.inWarehouse = !!src.inWarehouse;
    if (log.action === 'create' && !snapshot.createdAt) {
      snapshot.createdAt = log.createdAt;
    }
    if (log.action === 'delete' && !snapshot.updatedAt) {
      snapshot.updatedAt = log.createdAt;
    }
  }

  for (const pr of purchases) {
    const payload = pr.productPayload || {};
    const unitCodes = Array.isArray(payload.unitCodes) ? payload.unitCodes : [];
    const matchedUnit = unitCodes.find((c) => codeMatchesStored(c, code));
    const payloadMatches =
      codeMatchesStored(payload.code, code) || !!matchedUnit;
    if (!payloadMatches) continue;

    if (!snapshot.name && payload.name) snapshot.name = payload.name;
    if (matchedUnit) snapshot.code = matchedUnit;
    else if (payload.code && codeMatchesStored(payload.code, code)) {
      snapshot.code = payload.code;
    }
    if (payload.addedBy) snapshot.addedBy = payload.addedBy;
    if (!snapshot.branch && pr.branch) snapshot.branch = pr.branch;
    if (!snapshot.category && payload.category) snapshot.category = payload.category;
    if (snapshot.price == null && payload.price != null) snapshot.price = payload.price;
    if (snapshot.netPrice == null && payload.netPrice != null) snapshot.netPrice = payload.netPrice;
    if (
      (!snapshot.attributes || !Object.keys(snapshot.attributes).length) &&
      payload.attributes
    ) {
      snapshot.attributes = attrsToObject(payload.attributes);
    }
    if (!snapshot.acquiredFrom && payload.acquiredFrom) {
      snapshot.acquiredFrom = payload.acquiredFrom;
    }
    if (!snapshot.createdAt) snapshot.createdAt = pr.createdAtUserLocal || pr.createdAt;

    if (!productId) {
      if (matchedUnit && Array.isArray(pr.createdProductIds) && unitCodes.length) {
        const idx = unitCodes.findIndex((c) => codeMatchesStored(c, code));
        if (idx >= 0 && pr.createdProductIds[idx]) {
          productId = String(pr.createdProductIds[idx]);
        }
      }
      if (!productId && pr.createdProductId) {
        productId = String(pr.createdProductId);
      }
      if (!productId && Array.isArray(pr.createdProductIds) && pr.createdProductIds.length === 1) {
        productId = String(pr.createdProductIds[0]);
      }
    }
  }

  if (!productId) {
    return {
      ok: false,
      statusCode: 404,
      error: 'No product or history found for this code',
    };
  }

  if (!mongoose.Types.ObjectId.isValid(productId)) {
    return {
      ok: false,
      statusCode: 404,
      error: 'No product or history found for this code',
    };
  }

  const synthetic = {
    _id: new mongoose.Types.ObjectId(productId),
    name: snapshot.name || snapshot.code,
    code: snapshot.code || normalized,
    stock: 0,
    inWarehouse: !!snapshot.inWarehouse,
    branch: snapshot.branch,
    category: snapshot.category,
    addedBy: snapshot.addedBy || '',
    price: snapshot.price,
    netPrice: snapshot.netPrice,
    attributes: snapshot.attributes || {},
    acquiredFrom: snapshot.acquiredFrom,
    createdAt: snapshot.createdAt || snapshot.updatedAt || new Date(),
    updatedAt: snapshot.updatedAt || snapshot.createdAt || new Date(),
  };

  const { events } = await buildProductHistoryEvents(synthetic);

  // Ensure a clear "removed from stock" signal if history has no delete event
  const hasDelete = events.some(
    (e) => e.type === 'product_delete' || e.type === 'removed_from_stock'
  );
  if (!hasDelete) {
    const lastSale = events.find((e) => e.type === 'sale');
    events.unshift({
      id: `removed-from-stock-${productId}`,
      type: 'removed_from_stock',
      occurredAt: lastSale?.occurredAt || synthetic.updatedAt || new Date().toISOString(),
      actorName: lastSale?.actorName || '',
      summary: synthetic.code,
      details: {
        code: synthetic.code,
        name: synthetic.name,
        reason: 'Product no longer in stock (deleted or sold out)',
      },
    });
    events.sort(
      (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
    );
  }

  return {
    ok: true,
    exists: false,
    status: 'removed_from_stock',
    product: formatProductPayload(synthetic, {
      removedFromStock: true,
    }),
    events,
  };
}
