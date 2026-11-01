/** Pure stock-count rules: scan classification and shortage / surplus math. */

export function normalizeCode(code) {
  return String(code || '').trim().toUpperCase();
}

export function categoryIdOf(product) {
  const category = product?.category;
  if (!category) return '';
  if (typeof category === 'object') return String(category._id || '');
  return String(category);
}

export function isWeightProduct(product) {
  if (!product) return false;
  if (product.sellByWeightOverride === true) return true;
  if (product.sellByWeightOverride === false) return false;
  const category = product.category;
  return !!(category && typeof category === 'object' && category.sellByWeight);
}

export function branchIdOf(product) {
  const branch = product?.branch;
  if (!branch) return '';
  if (typeof branch === 'object') return String(branch._id || '');
  return String(branch);
}

export function productInLocation(product, count) {
  if (!product || !count) return false;
  if (count.locationType === 'warehouse') return !!product.inWarehouse;
  if (product.inWarehouse) return false;
  return branchIdOf(product) !== '' && branchIdOf(product) === String(count.branch || '');
}

export function categorySelected(product, count) {
  const id = categoryIdOf(product);
  if (!id) return false;
  return (count?.categories || []).some((row) => String(row.categoryId || row) === id);
}

function expectedMap(count) {
  const map = new Map();
  for (const item of count?.expectedItems || []) {
    const id = String(item.productId || item._id || '');
    if (id) map.set(id, item);
  }
  return map;
}

function scansForProduct(scans, productId) {
  const id = String(productId || '');
  if (!id) return [];
  return (scans || []).filter((scan) => String(scan.productId || '') === id);
}

function hasNormalized(scans, normalized) {
  return (scans || []).some((scan) => normalizeCode(scan.normalizedCode) === normalized);
}

/**
 * Pick the product a scanned code refers to.
 * Prefer the unit that belongs to this count's opening snapshot.
 */
export function chooseProduct(matches, count, rawCode) {
  if (!matches?.length) return { product: null, ambiguous: false };

  const normalized = normalizeCode(rawCode);
  const exact = matches.filter((product) => normalizeCode(product.code) === normalized);
  const pool = exact.length ? exact : matches;
  const expectedIds = new Set(
    (count?.expectedItems || []).map((item) => String(item.productId || ''))
  );

  const inExpected = pool.filter((product) => expectedIds.has(String(product._id)));
  if (inExpected.length === 1) return { product: inExpected[0], ambiguous: false };
  if (inExpected.length > 1) return { product: null, ambiguous: true };

  const inLocation = pool.filter((product) => productInLocation(product, count));
  if (inLocation.length === 1) return { product: inLocation[0], ambiguous: false };
  if (inLocation.length > 1) return { product: null, ambiguous: true };

  if (pool.length === 1) return { product: pool[0], ambiguous: false };
  const withStock = pool.filter(
    (product) => (Number(product.stock) || 0) > 0 && !product.removedWhenOutOfStock
  );
  return { product: withStock[0] || pool[0], ambiguous: false };
}

/** Why a scanned unit is not part of the expected stock for this count. */
export function surplusReason(product, count) {
  if (!product) return 'unknown';
  if (isWeightProduct(product)) return 'weight';
  if (product.removedWhenOutOfStock) return 'removed';
  if ((Number(product.stock) || 0) <= 0) return 'out_of_stock';
  if (!productInLocation(product, count)) return 'other_location';
  if (!categorySelected(product, count)) return 'wrong_category';
  return 'not_expected';
}

export function matchedCountByProduct(scans) {
  const map = new Map();
  for (const scan of scans || []) {
    if (scan.kind !== 'matched' || !scan.productId) continue;
    const id = String(scan.productId);
    map.set(id, (map.get(id) || 0) + 1);
  }
  return map;
}

function expectedQtyOf(item) {
  return Math.max(0, Math.round(Number(item?.expectedQty ?? item?.stock) || 0));
}

export function buildSummary(expectedItems, scans) {
  const matched = matchedCountByProduct(scans);
  let expectedUnits = 0;
  let countedUnits = 0;
  let shortageUnits = 0;

  for (const item of expectedItems || []) {
    const expectedQty = expectedQtyOf(item);
    const scannedQty = matched.get(String(item.productId || item._id || '')) || 0;
    expectedUnits += expectedQty;
    countedUnits += Math.min(expectedQty, scannedQty);
    shortageUnits += Math.max(0, expectedQty - scannedQty);
  }

  const surplusUnits = (scans || []).filter((scan) => scan.kind === 'surplus').length;
  return { expectedUnits, countedUnits, shortageUnits, surplusUnits };
}

export function buildAllRows(expectedItems, scans) {
  const matched = matchedCountByProduct(scans);
  const rows = [];
  for (const item of expectedItems || []) {
    const expectedQty = expectedQtyOf(item);
    if (expectedQty <= 0) continue;
    const id = String(item.productId || item._id || '');
    const scannedQty = matched.get(id) || 0;
    rows.push({
      productId: item.productId || item._id,
      name: item.name || '',
      code: item.code || '',
      categoryName: item.categoryName || item.category?.name || '',
      expectedQty,
      scannedQty,
      shortageQty: Math.max(0, expectedQty - scannedQty),
      diffQty: scannedQty - expectedQty,
    });
  }
  rows.sort((a, b) =>
    String(a.code || '').localeCompare(String(b.code || ''), 'en', { numeric: true })
  );
  return rows;
}

export function buildShortageRows(expectedItems, scans) {
  const matched = matchedCountByProduct(scans);
  const rows = [];
  for (const item of expectedItems || []) {
    const expectedQty = expectedQtyOf(item);
    if (expectedQty <= 0) continue;
    const id = String(item.productId || item._id || '');
    const scannedQty = matched.get(id) || 0;
    const shortageQty = expectedQty - scannedQty;
    if (shortageQty <= 0) continue;
    rows.push({
      productId: item.productId || item._id,
      name: item.name || '',
      code: item.code || '',
      categoryName: item.categoryName || item.category?.name || '',
      expectedQty,
      scannedQty,
      shortageQty,
      diffQty: scannedQty - expectedQty,
    });
  }
  rows.sort((a, b) =>
    String(a.code || '').localeCompare(String(b.code || ''), 'en', { numeric: true })
  );
  return rows;
}

export function buildSurplusRows(scans) {
  return (scans || [])
    .filter((scan) => scan.kind === 'surplus')
    .map((scan) => ({
      scanId: scan._id,
      rawCode: scan.rawCode || '',
      productId: scan.productId || null,
      name: scan.productName || '',
      code: scan.productCode || scan.rawCode || '',
      categoryName: scan.categoryName || '',
      reason: scan.surplusReason || 'unknown',
      scannedAt: scan.scannedAt,
    }))
    .sort((a, b) => new Date(b.scannedAt || 0).getTime() - new Date(a.scannedAt || 0).getTime());
}

export function buildScannedRows(scans) {
  return (scans || [])
    .filter((scan) => scan.kind === 'matched')
    .map((scan) => ({
      scanId: scan._id,
      rawCode: scan.rawCode || '',
      productId: scan.productId || null,
      name: scan.productName || '',
      code: scan.productCode || scan.rawCode || '',
      categoryName: scan.categoryName || '',
      reason: '',
      scannedAt: scan.scannedAt,
    }))
    .sort((a, b) => new Date(b.scannedAt || 0).getTime() - new Date(a.scannedAt || 0).getTime());
}

/**
 * Decide what a new scan does. Does not mutate the count.
 * action: invalid | too_long | ambiguous | already_scanned | record
 */
export function classifyScan(count, matches, rawCode) {
  const raw = String(rawCode || '').trim();
  const normalized = normalizeCode(raw);
  if (!normalized) return { action: 'invalid' };
  if (normalized.length > 80) return { action: 'too_long' };

  const { product, ambiguous } = chooseProduct(matches || [], count, raw);
  if (ambiguous) {
    return { action: 'ambiguous', normalized, rawCode: raw };
  }

  if (!product) {
    if (hasNormalized(count?.scans, normalized)) {
      return {
        action: 'already_scanned',
        normalized,
        rawCode: raw,
        reason: 'unknown',
        product: null,
      };
    }
    return {
      action: 'record',
      kind: 'surplus',
      reason: 'unknown',
      normalized,
      rawCode: raw,
      product: null,
    };
  }

  const expected = expectedMap(count).get(String(product._id));
  const prior = scansForProduct(count?.scans, product._id);

  if (expected) {
    const matched = prior.filter((scan) => scan.kind === 'matched').length;
    const qty = expectedQtyOf(expected);
    if (matched < qty) {
      return {
        action: 'record',
        kind: 'matched',
        reason: '',
        normalized,
        rawCode: raw,
        product,
      };
    }
    if (qty <= 1) {
      return {
        action: 'already_scanned',
        normalized,
        rawCode: raw,
        reason: '',
        product,
      };
    }
    return {
      action: 'record',
      kind: 'surplus',
      reason: 'over_qty',
      normalized,
      rawCode: raw,
      product,
    };
  }

  const reason = surplusReason(product, count);
  if (prior.length) {
    return {
      action: 'already_scanned',
      normalized,
      rawCode: raw,
      reason,
      product,
    };
  }
  return {
    action: 'record',
    kind: 'surplus',
    reason,
    normalized,
    rawCode: raw,
    product,
  };
}

export function filterLines(lines, q, categoryName) {
  const query = String(q || '').trim().toLowerCase();
  const category = String(categoryName || '').trim();
  return (lines || []).filter((line) => {
    if (category && String(line.categoryName || '') !== category) return false;
    if (!query) return true;
    const blob = [line.name, line.code, line.rawCode, line.categoryName, line.reason]
      .join(' ')
      .toLowerCase();
    return blob.includes(query);
  });
}

export function paginateLines(lines, pageRaw, limitRaw) {
  const limit = Math.min(100, Math.max(1, Number(limitRaw) || 20));
  const total = (lines || []).length;
  const totalPages = total ? Math.ceil(total / limit) : 0;
  const page = Math.min(Math.max(Number(pageRaw) || 1, 1), totalPages || 1);
  const start = (page - 1) * limit;
  return {
    rows: (lines || []).slice(start, start + limit),
    meta: {
      currentPage: total ? page : 1,
      totalCount: total,
      totalPages,
      nextPage: total && page < totalPages ? page + 1 : null,
      prevPage: total && page > 1 ? page - 1 : null,
    },
  };
}
