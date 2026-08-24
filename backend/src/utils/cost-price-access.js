/** Roles that Super Admin can hide cost / purchase price from. Super Admin is never in this list. */
export const COST_PRICE_RESTRICTABLE_ROLES = [
  'Co Admin',
  'Branch Manager',
  'Cashier',
  'Collector',
  'Warehouse',
  'Moderator',
];

export const DEFAULT_ROLES_HIDDEN_FROM_COST_PRICE = [...COST_PRICE_RESTRICTABLE_ROLES];

const ALLOWED = new Set(COST_PRICE_RESTRICTABLE_ROLES);

function canonicalRole(role) {
  const r = String(role || '').trim();
  if (r === 'Operation Manager') return 'Warehouse';
  return r;
}

/** Missing / invalid value → hide from every restrictable role (cost stays Super Admin-only). */
export function normalizeRolesHiddenFromCostPrice(raw) {
  if (!Array.isArray(raw)) {
    return [...DEFAULT_ROLES_HIDDEN_FROM_COST_PRICE];
  }
  const out = [];
  for (const item of raw) {
    const role = canonicalRole(item);
    if (!ALLOWED.has(role)) continue;
    if (!out.includes(role)) out.push(role);
  }
  return out;
}

export function canSeeCostPrice(role, hiddenRolesRaw) {
  const r = canonicalRole(role);
  if (r === 'Super Admin' || r === 'Admin') return true;
  const hidden = new Set(normalizeRolesHiddenFromCostPrice(hiddenRolesRaw));
  return !hidden.has(r);
}

export function stripCostFieldsFromProduct(product) {
  if (!product || typeof product !== 'object') return product;
  const next = { ...product };
  delete next.netPrice;
  if (Array.isArray(next.unitDetails)) {
    next.unitDetails = next.unitDetails.map((u) => {
      if (!u || typeof u !== 'object') return u;
      const { netPrice, ...rest } = u;
      return rest;
    });
  }
  return next;
}

export function stripInventoryCapital(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  const drop = (obj) => {
    if (!obj || typeof obj !== 'object') return obj;
    const next = { ...obj };
    delete next.inventoryCapital;
    delete next.inventoryCapital;
    return next;
  };
  const next = drop(payload);
  if (next.totals && typeof next.totals === 'object') {
    next.totals = drop(next.totals);
  }
  if (Array.isArray(next.byLocation)) {
    next.byLocation = next.byLocation.map(drop);
  }
  return next;
}
