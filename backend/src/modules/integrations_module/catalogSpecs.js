/**
 * Specs marked showOnEcommerce on the category, with values from this product.
 */

function attrsToPlainObject(attributes) {
  if (!attributes) return {};
  if (attributes instanceof Map) return Object.fromEntries(attributes.entries());
  if (typeof attributes === 'object') return { ...attributes };
  return {};
}

function normalizeAttrKey(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

/**
 * @param {object} product lean product with populated category.attributeDefs
 * @param {{ excludeKeys?: string[] }} [opts]
 * @returns {Array<{ key: string, label: string, value: string }>}
 */
export function buildEcommerceSpecs(product, opts = {}) {
  const category =
    product?.category && typeof product.category === 'object' ? product.category : null;
  const defs = Array.isArray(category?.attributeDefs) ? category.attributeDefs : [];
  const attrs = attrsToPlainObject(product?.attributes);
  const exclude = new Set((opts.excludeKeys || []).map(normalizeAttrKey));
  const out = [];
  for (const d of defs) {
    if (!d?.showOnEcommerce) continue;
    const key = normalizeAttrKey(d.key);
    if (!key || exclude.has(key)) continue;
    const value = String(attrs[key] ?? attrs[d.key] ?? '').trim();
    if (!value) continue;
    out.push({
      key,
      label: String(d.label || d.key || key).trim() || key,
      value,
    });
  }
  return out;
}
