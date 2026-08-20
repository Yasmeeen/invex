export const WEIGHT_DECIMALS = 3;
export const MIN_WEIGHT = 0.001;

export function roundWeight(n: number): number {
  const f = 10 ** WEIGHT_DECIMALS;
  return Math.round(Number(n || 0) * f) / f;
}

export function normalizePieceQuantity(qty: number): number {
  return Math.max(1, Math.floor(Number(qty) || 0));
}

export function normalizeWeightQuantity(qty: number): number {
  const n = roundWeight(Number(qty) || 0);
  return n >= MIN_WEIGHT ? n : 0;
}

export function resolveSellByWeight(opts: {
  weightSalesEnabled?: boolean;
  category?: { sellByWeight?: boolean } | null;
  product?: { sellByWeightOverride?: boolean | null; category?: { sellByWeight?: boolean } | null } | null;
}): boolean {
  if (!opts.weightSalesEnabled) return false;
  const override = opts.product?.sellByWeightOverride;
  if (override != null) return !!override;
  const cat =
    opts.category ??
    (typeof opts.product?.category === 'object' ? opts.product.category : null);
  return !!cat?.sellByWeight;
}

export function isWeightSaleUnit(saleUnit?: string | null): boolean {
  return String(saleUnit || '').trim().toLowerCase() === 'weight';
}

export function normalizeSaleQuantity(qty: number, isWeight: boolean): number {
  return isWeight ? normalizeWeightQuantity(qty) : normalizePieceQuantity(qty);
}

export function normalizeWeightUnit(raw?: string | null): 'kg' | 'g' {
  const u = String(raw || 'kg').trim().toLowerCase();
  return u === 'g' ? 'g' : 'kg';
}

export function formatWeightQuantity(qty: number, unit: 'kg' | 'g' = 'kg'): string {
  const w = normalizeWeightQuantity(qty);
  if (unit === 'g') {
    return `${roundWeight(w * 1000)} g`;
  }
  return `${w} kg`;
}
