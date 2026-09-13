/** Sort fridge / carcass source SKUs before other products (Arabic name tie-break). */
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

export function compareFridgeFirst(
  a: { name?: string | null; catalogKey?: string | null; code?: string | null },
  b: { name?: string | null; catalogKey?: string | null; code?: string | null }
): number {
  const ra = isFridgeSourceProduct(a) ? 0 : 1;
  const rb = isFridgeSourceProduct(b) ? 0 : 1;
  if (ra !== rb) return ra - rb;
  return String(a?.name || '').localeCompare(String(b?.name || ''), 'ar');
}
