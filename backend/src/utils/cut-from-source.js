import mongoose from 'mongoose';
import Product from '../DB/models/product.model.js';
import { butcherFeaturesEnabled } from './business-activity.util.js';

export function isCutFromSourceEnabled(settings) {
  return butcherFeaturesEnabled(settings) && !!settings?.cutFromSourceEnabled;
}

export function sourceProductIdOf(product) {
  const raw = product?.sourceProductId;
  if (!raw) return null;
  if (typeof raw === 'object' && raw._id) return String(raw._id);
  return String(raw);
}

/** Free units on a stock document (own stock minus holds). */
export function computeSellableUnits(product) {
  return Math.max(
    0,
    (Number(product?.stock) || 0) -
      (Number(product?.transferReservedQuantity) || 0) -
      (Number(product?.bookedQuantity) || 0) -
      (Number(product?.ecommerceReservedQuantity) || 0)
  );
}

/**
 * Product whose stock is consumed when selling `product`.
 * Cut SKUs keep stock at 0 and draw from sourceProductId when the feature is on.
 */
export function stockBearerId(product, cutFromSourceEnabled) {
  if (!product) return null;
  if (cutFromSourceEnabled) {
    const sourceId = sourceProductIdOf(product);
    if (sourceId) return sourceId;
  }
  return product._id ? String(product._id) : null;
}

export function stockBearerOf(product, sourceById, cutFromSourceEnabled) {
  const bearerId = stockBearerId(product, cutFromSourceEnabled);
  if (!bearerId) return product;
  if (product?._id && String(product._id) === bearerId) return product;
  return sourceById?.get(bearerId) || product;
}

export function effectiveSellableUnits(product, sourceById, cutFromSourceEnabled) {
  return computeSellableUnits(stockBearerOf(product, sourceById, cutFromSourceEnabled));
}

/** Load fridge/source docs for cut SKUs into a Map keyed by id string. */
export async function loadSourceProductsById(
  products,
  { enabled, session, select } = {}
) {
  const map = new Map();
  if (!enabled || !Array.isArray(products) || !products.length) return map;
  const ids = [
    ...new Set(
      products
        .map((p) => sourceProductIdOf(p))
        .filter((id) => id && mongoose.Types.ObjectId.isValid(id))
    ),
  ];
  if (!ids.length) return map;
  const fields =
    select ||
    'name code stock transferReservedQuantity bookedQuantity ecommerceReservedQuantity netPrice branch inWarehouse removedWhenOutOfStock category price sourceProductId productType processingExtraCost';
  const query = Product.find({ _id: { $in: ids } }).select(fields);
  if (session) query.session(session);
  const sources = await query;
  for (const src of sources) {
    map.set(String(src._id), src);
  }
  return map;
}

/**
 * Parse optional sourceProductId from a product create/update body.
 * When the feature is off, the field is ignored so other stores are unchanged.
 */
export async function resolveCutSourceFields(body, { productId, branchOid, isWarehouse, enabled }) {
  if (!enabled) {
    return { skip: true };
  }
  if (!Object.prototype.hasOwnProperty.call(body || {}, 'sourceProductId')) {
    return { skip: true };
  }
  const raw = body.sourceProductId;
  if (raw == null || raw === '') {
    return { sourceProductId: null };
  }
  const id = typeof raw === 'object' ? raw._id ?? raw.id : raw;
  if (!mongoose.Types.ObjectId.isValid(String(id))) {
    return { error: 'Invalid source product' };
  }
  if (productId && String(id) === String(productId)) {
    return { error: 'Product cannot source from itself' };
  }
  const src = await Product.findById(id).select('_id name sourceProductId branch inWarehouse');
  if (!src) {
    return { error: 'Source product not found' };
  }
  if (src.sourceProductId) {
    return { error: 'Source product cannot itself be a cut' };
  }
  const srcWh = !!src.inWarehouse;
  if (!!isWarehouse !== srcWh) {
    return { error: 'Source product must be in the same location' };
  }
  if (!isWarehouse) {
    if (!branchOid || String(src.branch || '') !== String(branchOid)) {
      return { error: 'Source product must be in the same branch' };
    }
  }
  return { sourceProductId: src._id };
}

export async function attachSourceProducts(products) {
  if (!Array.isArray(products) || !products.length) return products;
  const ids = [
    ...new Set(
      products
        .map((p) => sourceProductIdOf(p))
        .filter((id) => id && mongoose.Types.ObjectId.isValid(id))
    ),
  ];
  if (!ids.length) return products;
  const sources = await Product.find({ _id: { $in: ids } })
    .select('name code stock branch inWarehouse')
    .lean();
  const map = new Map(sources.map((s) => [String(s._id), s]));
  for (const p of products) {
    const sid = sourceProductIdOf(p);
    if (sid) {
      p.sourceProduct = map.get(sid) || null;
    }
  }
  return products;
}
