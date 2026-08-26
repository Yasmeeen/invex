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
