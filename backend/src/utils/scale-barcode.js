/**
 * In-store EAN-13 from TM-A scale labels:
 * 2 + 6-digit PLU + 5-digit grams + check
 * Example: 2000022013901 → PLU 000022 / 22
 */

function digitsOnly(raw) {
  return String(raw || '').replace(/\D/g, '');
}

function pluParts(padded) {
  const plu = String(padded || '').replace(/\D/g, '');
  const pluUnpadded = plu.replace(/^0+/, '') || '0';
  return { plu, pluUnpadded };
}

export function parseScaleBarcode(raw) {
  const d = digitsOnly(raw);
  if (d.length !== 13 || d[0] !== '2') return null;
  return pluParts(d.slice(1, 7));
}
