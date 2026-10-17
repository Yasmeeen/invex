/** Empty branchIds = available in all branches (legacy / company-wide). */
export function isAvailableForBranch(
  branchIds: string[] | null | undefined,
  branchId: string | null | undefined,
  alwaysAll = false
): boolean {
  if (alwaysAll) return true;
  const ids = (branchIds || []).map((id) => String(id || '').trim()).filter(Boolean);
  if (!ids.length) return true;
  const bid = String(branchId || '').trim();
  if (!bid) return true;
  return ids.includes(bid);
}

export function moneyAccountAlwaysAllBranches(kind?: string, key?: string): boolean {
  const k = String(key || '')
    .trim()
    .toLowerCase();
  const kindNorm = String(kind || '')
    .trim()
    .toLowerCase();
  return k === 'cash' || kindNorm === 'cash' || kindNorm === 'settlement';
}

export function paymentMethodAlwaysAllBranches(key?: string, effectMode?: string): boolean {
  const k = String(key || '')
    .trim()
    .toLowerCase();
  if (k === 'cash' || k === 'credit') return true;
  return (
    String(effectMode || '')
      .trim()
      .toLowerCase() === 'settlement'
  );
}
