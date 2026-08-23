export const WEIGHT_DECIMALS = 3;
export const MIN_WEIGHT = 0.001;

export function roundWeight(n) {
  const f = 10 ** WEIGHT_DECIMALS;
  return Math.round(Number(n || 0) * f) / f;
}

export function normalizePieceQuantity(qty) {
  return Math.max(1, Math.floor(Number(qty) || 0));
}

export function normalizeWeightQuantity(qty) {
  const n = roundWeight(Number(qty) || 0);
  return n >= MIN_WEIGHT ? n : 0;
}

/** @param {{ weightSalesEnabled?: boolean, category?: { sellByWeight?: boolean } | null, product?: { sellByWeightOverride?: boolean | null } | null }} opts */
export function resolveSellByWeight(opts = {}) {
  if (!opts.weightSalesEnabled) return false;
  const override = opts.product?.sellByWeightOverride;
  if (override != null) return !!override;
  return !!opts.category?.sellByWeight;
}

export function isWeightSaleUnit(saleUnit) {
  return String(saleUnit || '').trim().toLowerCase() === 'weight';
}

export function normalizeSaleQuantity(qty, isWeight) {
  return isWeight ? normalizeWeightQuantity(qty) : normalizePieceQuantity(qty);
}

export function normalizeWeightUnit(raw) {
  const u = String(raw || 'kg').trim().toLowerCase();
  return u === 'g' ? 'g' : 'kg';
}
