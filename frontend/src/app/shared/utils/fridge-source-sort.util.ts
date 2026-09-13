/** Detect fridge / carcass source SKUs (ثلاجة / *_fridge). */
export function isFridgeSourceProduct(p: {
  name?: string | null;
  catalogKey?: string | null;
  code?: string | null;
}): boolean {
  const key = String(p?.catalogKey || '').trim();
  if (/_fridge$/i.test(key)) return true;
  const name = String(p?.name || '');
  if (name.includes('ثلاجة')) return true;
  const code = String(p?.code || '').toLowerCase();
  return code.includes('-fridge') || code.endsWith('_fridge');
}

/**
 * Within one category (or a source-picker list): fridge first, then Arabic name.
 * Product list API sorts by category then this rule — not all fridges globally first.
 */
export function compareFridgeFirst(
  a: { name?: string | null; catalogKey?: string | null; code?: string | null },
  b: { name?: string | null; catalogKey?: string | null; code?: string | null }
): number {
  const ra = isFridgeSourceProduct(a) ? 0 : 1;
  const rb = isFridgeSourceProduct(b) ? 0 : 1;
  if (ra !== rb) return ra - rb;
  return String(a?.name || '').localeCompare(String(b?.name || ''), 'ar');
}
