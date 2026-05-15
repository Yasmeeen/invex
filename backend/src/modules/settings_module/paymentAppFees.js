/** Payment methods that may carry a BNPL / wallet provider surcharge (matches cashier split methods). */
const ALLOWED_METHODS = new Set([
  'visa',
  'mastercard',
  'meeza',
  'valu',
  'aman',
  'halan',
  'tru',
  'sohoula',
  'maylo_seven',
  'fawry',
  'vodafone_cash',
  'instapay',
  'forsa',
]);

/**
 * @param {unknown} rawList
 * @returns {{ method: string; percent: number }[]}
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
    if (!method || !ALLOWED_METHODS.has(method) || seen.has(method)) {
      continue;
    }
    let percent = Number(row?.percent);
    if (!Number.isFinite(percent)) {
      percent = 0;
    }
    percent = Math.max(0, Math.min(100, Math.round(percent * 100) / 100));
    seen.add(method);
    out.push({ method, percent });
  }
  out.sort((a, b) => a.method.localeCompare(b.method));
  return out;
}
