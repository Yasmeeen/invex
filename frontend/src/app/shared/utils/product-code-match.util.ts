/**
 * Match product codes with or without category prefix.
 * Stored codes look like `ELEC-001`; scan/type may be `ELEC-001` or `001`.
 */

function normalizeCode(code: string | null | undefined): string {
  return String(code || '').trim().toUpperCase();
}

/** Numeric / suffix part after the last `-` (e.g. `ELEC-001` → `001`). */
export function productCodeSuffix(code: string | null | undefined): string {
  const normalized = normalizeCode(code);
  if (!normalized) return '';
  const parts = normalized.split('-');
  return parts[parts.length - 1] || normalized;
}

function suffixMatches(productSuffix: string, scanned: string): boolean {
  if (!productSuffix || !scanned) return false;
  if (productSuffix === scanned) return true;
  // `1` / `01` / `001` → same product number
  if (/^\d+$/.test(productSuffix) && /^\d+$/.test(scanned)) {
    return Number(productSuffix) === Number(scanned);
  }
  return false;
}

/**
 * Find a product by scanned/typed code: full `PREFIX-NNN` or suffix `NNN` only.
 * Prefer exact full-code match; if several suffix hits, prefer exact padded suffix.
 */
export function findProductByScannedCode<T extends { code?: string }>(
  products: T[],
  input: string
): T | undefined {
  const normalized = normalizeCode(input);
  if (!normalized || !products?.length) return undefined;

  const exact = products.find((p) => normalizeCode(p.code) === normalized);
  if (exact) return exact;

  // Allow leading `-` from scanners / partial paste: `-001`
  const scannedSuffix = normalized.replace(/^-/, '');
  if (!scannedSuffix) return undefined;

  const suffixHits = products.filter((p) => {
    const code = normalizeCode(p.code);
    if (!code) return false;
    if (code.endsWith('-' + scannedSuffix)) return true;
    return suffixMatches(productCodeSuffix(code), scannedSuffix);
  });

  if (suffixHits.length === 0) return undefined;
  if (suffixHits.length === 1) return suffixHits[0];

  const exactSuffix = suffixHits.filter(
    (p) => productCodeSuffix(p.code) === scannedSuffix
  );
  if (exactSuffix.length === 1) return exactSuffix[0];
  if (exactSuffix.length > 1) return exactSuffix[0];

  return suffixHits[0];
}

/** Unique name match (typed at cashier). Undefined if none or more than one. */
export function findUniqueProductByName<T extends { name?: string }>(
  products: T[],
  input: string
): T | undefined {
  const q = String(input || '').trim().toLowerCase();
  if (!q || !products?.length) return undefined;
  const hits = products.filter((p) => String(p?.name || '').trim().toLowerCase().includes(q));
  if (hits.length === 1) return hits[0];
  const exact = hits.filter((p) => String(p?.name || '').trim().toLowerCase() === q);
  return exact.length === 1 ? exact[0] : undefined;
}
export function productMatchesSearchTerm(
  product: { name?: string; code?: string },
  term: string
): boolean {
  const q = String(term || '').trim().toLowerCase();
  if (!q) return true;

  const name = String(product?.name || '').toLowerCase();
  if (name.includes(q)) return true;

  const code = normalizeCode(product?.code);
  const qNorm = q.toUpperCase();
  if (code.includes(qNorm)) return true;

  const scannedSuffix = qNorm.replace(/^-/, '');
  if (scannedSuffix && suffixMatches(productCodeSuffix(code), scannedSuffix)) {
    return true;
  }

  return false;
}
