/**
 * In-store EAN-13 from TM-A scale labels (confirmed from printed sticker):
 * 2 + 6-digit PLU + 5-digit grams + check
 * Example: 2000022013901 → PLU 000022 / 22, weight 1.390 kg
 */

export interface ScaleBarcodeParse {
  plu: string;
  pluUnpadded: string;
  /** Weight in kg, or 0 if the label has no usable weight. */
  weightKg: number;
}

function digitsOnly(raw: string): string {
  return String(raw || '').replace(/\D/g, '');
}

function pluParts(padded: string): { plu: string; pluUnpadded: string } {
  const plu = String(padded || '').replace(/\D/g, '');
  const pluUnpadded = plu.replace(/^0+/, '') || '0';
  return { plu, pluUnpadded };
}

function gramsToKg(grams: number): number {
  if (!Number.isFinite(grams) || grams <= 0) return 0;
  return Math.round(grams) / 1000;
}

export function parseScaleBarcode(raw: string): ScaleBarcodeParse | null {
  const d = digitsOnly(raw);
  if (d.length !== 13 || d[0] !== '2') return null;
  const { plu, pluUnpadded } = pluParts(d.slice(1, 7));
  const grams = parseInt(d.slice(7, 12), 10);
  return { plu, pluUnpadded, weightKg: gramsToKg(grams) };
}

/** Codes to try in cashier lookup, full scan first so real 13-digit SKUs still match. */
export function scaleBarcodeLookupCodes(raw: string): string[] {
  const trimmed = String(raw || '').trim();
  const out: string[] = [];
  const push = (c: string) => {
    const v = String(c || '').trim();
    if (v && !out.includes(v)) out.push(v);
  };
  push(trimmed);
  const parsed = parseScaleBarcode(trimmed);
  if (parsed) {
    push(parsed.plu);
    push(parsed.pluUnpadded);
  }
  return out;
}
