/** Cashier methods that never carry an app surcharge row. */
const BLOCKED_METHODS = new Set(['cash', 'credit', 'mixed']);

const METHOD_KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;

/**
 * @param {unknown} rawList
 * @returns {{ method: string; label: string; percent: number }[]}
 */
export function normalizePaymentAppFeePercents(rawList) {
  if (!Array.isArray(rawList)) {
    return [];
  }
  const seen = new Set();
  const out = [];
  for (const row of rawList) {
    const method = String(row?.method ?? '')
      .trim()
      .toLowerCase();
    if (!method || BLOCKED_METHODS.has(method) || !METHOD_KEY_RE.test(method) || seen.has(method)) {
      continue;
    }
    let percent = Number(row?.percent);
    if (!Number.isFinite(percent)) {
      percent = 0;
    }
    percent = Math.max(0, Math.min(100, Math.round(percent * 100) / 100));
    const label = String(row?.label ?? '').trim().slice(0, 120);
    seen.add(method);
    out.push({
      method,
      label,
      percent,
    });
  }
  out.sort((a, b) => a.method.localeCompare(b.method));
  return out;
}
