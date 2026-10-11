/**
 * Specs from category.attributeDefs with values from this product.
 */

function attrsToPlainObject(attributes) {
  if (!attributes) return {};
  if (attributes instanceof Map) return Object.fromEntries(attributes.entries());
  if (typeof attributes === 'object' && !Array.isArray(attributes)) {
    return { ...attributes };
  }
  return {};
}

function normalizeAttrKey(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

function resolveAttrValue(attrs, defKey) {
  const wanted = normalizeAttrKey(defKey);
  if (!wanted) return '';
  const direct = attrs[wanted] ?? attrs[defKey];
  if (direct != null && String(direct).trim()) return String(direct).trim();
  for (const [key, value] of Object.entries(attrs)) {
    if (normalizeAttrKey(key) === wanted && value != null && String(value).trim()) {
      return String(value).trim();
    }
  }
  return '';
}

/**
 * @param {object} product lean product with populated category.attributeDefs
 * @param {{ excludeKeys?: string[], onlyEcommerce?: boolean, includeUndefinedDefs?: boolean }} [opts]
 * @returns {Array<{ key: string, label: string, value: string }>}
 */
export function buildCatalogSpecs(product, opts = {}) {
  const category =
    product?.category && typeof product.category === 'object' ? product.category : null;
  const defs = Array.isArray(category?.attributeDefs) ? category.attributeDefs : [];
  const attrs = attrsToPlainObject(product?.attributes);
  const exclude = new Set((opts.excludeKeys || []).map(normalizeAttrKey));
  const onlyEcommerce = opts.onlyEcommerce !== false;
  const out = [];
  const used = new Set();

  for (const d of defs) {
    if (onlyEcommerce && !d?.showOnEcommerce) continue;
    const key = normalizeAttrKey(d.key);
    if (!key || exclude.has(key) || used.has(key)) continue;
    const value = resolveAttrValue(attrs, d.key);
    if (!value) continue;
    used.add(key);
    out.push({
      key,
      label: String(d.label || d.key || key).trim() || key,
      value,
    });
  }

  // CRM: also surface any filled attribute values not covered by defs.
  if (!onlyEcommerce) {
    for (const [rawKey, rawValue] of Object.entries(attrs)) {
      const key = normalizeAttrKey(rawKey);
      if (!key || exclude.has(key) || used.has(key)) continue;
      const value = String(rawValue ?? '').trim();
      if (!value) continue;
      used.add(key);
      out.push({
        key,
        label: String(rawKey || key).trim() || key,
        value,
      });
    }
  }

  return out;
}

/** Specs marked showOnEcommerce on the category, with values from this product. */
export function buildEcommerceSpecs(product, opts = {}) {
  return buildCatalogSpecs(product, { ...opts, onlyEcommerce: true });
}

/** All filled category attribute values for CRM product inquiry / order screens. */
export function buildCrmProductSpecs(product, opts = {}) {
  return buildCatalogSpecs(product, { ...opts, onlyEcommerce: false });
}

export function plainProductAttributes(attributes) {
  return attrsToPlainObject(attributes);
}
