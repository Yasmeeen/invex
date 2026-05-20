/** Digits only (for comparing Egyptian mobile formats). */
export function digitsOnly(s) {
  return String(s || '').replace(/\D/g, '');
}

/**
 * Build possible DB values for the same logical phone (0XX…, +20…, 20…, 10 digits).
 */
export function buildPhoneSearchCandidates(raw) {
  const decoded = decodeURIComponent(String(raw || '').trim());
  const d = digitsOnly(decoded);
  const set = new Set([decoded, d].filter(Boolean));
  if (d.length >= 10) {
    const last10 = d.slice(-10);
    set.add(last10);
    set.add(`0${last10}`);
    set.add(`20${last10}`);
    set.add(`+20${last10}`);
    set.add(`0020${last10}`);
    if (d.startsWith('20') && d.length >= 12) {
      set.add(`0${d.slice(2)}`);
    }
  }
  return [...set].filter(Boolean);
}
