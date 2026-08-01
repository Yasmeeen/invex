import {
  isDeferredPurchaseTreasury,
  PURCHASE_TREASURY_DEFERRED_KEY,
  PURCHASE_TREASURY_DEFERRED_LABEL,
  treasuryKeyIsCashDrawer,
} from '../modules/settings_module/treasuryMethods.js';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function coerceTreasurySplitsArray(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'object' && typeof raw.length === 'number') {
    return Array.from(raw);
  }
  return [];
}

export function getPurchaseLines(purchase) {
  const doc =
    purchase && typeof purchase.toObject === 'function' ? purchase.toObject() : purchase;
  const rawLines = Array.isArray(doc?.lines) ? doc.lines : [];
  if (rawLines.length) {
    return rawLines
      .map((l) => ({
        productPayload: l?.productPayload || null,
        quantity: Math.max(1, Math.floor(Number(l?.quantity) || 1)),
        createdProductId: l?.createdProductId,
        createdProductIds: Array.isArray(l?.createdProductIds) ? l.createdProductIds : undefined,
      }))
      .filter((l) => l.productPayload);
  }
  if (!doc?.productPayload) return [];
  return [
    {
      productPayload: doc.productPayload,
      quantity: Math.max(1, Math.floor(Number(doc.quantity) || 1)),
      createdProductId: doc.createdProductId,
      createdProductIds: Array.isArray(doc.createdProductIds) ? doc.createdProductIds : undefined,
    },
  ];
}

export function deskPurchaseLineTotal(purchase) {
  return round2(
    getPurchaseLines(purchase).reduce((sum, line) => {
      const net = Number(line?.productPayload?.netPrice) || 0;
      return sum + net * line.quantity;
    }, 0)
  );
}

export function deskPurchaseItemCount(purchase) {
  return getPurchaseLines(purchase).reduce((sum, line) => sum + line.quantity, 0);
}

/**
 * Effective treasury lines for a desk purchase (splits or legacy single key).
 * @returns {{ key: string, label: string, amount: number }[]}
 */
export function resolvePurchaseTreasurySplits(purchase) {
  const doc =
    purchase && typeof purchase.toObject === 'function' ? purchase.toObject() : purchase;
  if (doc?.isExchangeTradeIn) {
    const settlement = coerceTreasurySplitsArray(doc?.exchangeSettlementSplits);
    if (settlement.length) {
      return settlement
        .map((row) => ({
          key: String(row?.key ?? '')
            .trim()
            .toLowerCase(),
          label: String(row?.label ?? '').trim(),
          amount: round2(row?.amount),
        }))
        .filter((s) => s.key && s.amount > 0);
    }
    return [];
  }
  const raw = coerceTreasurySplitsArray(doc?.purchaseTreasurySplits);
  if (raw.length) {
    return raw
      .map((row) => ({
        key: String(row?.key ?? '')
          .trim()
          .toLowerCase(),
        label: String(row?.label ?? '').trim(),
        amount: round2(row?.amount),
      }))
      .filter((s) => s.key && s.amount > 0);
  }

  const total = deskPurchaseLineTotal(purchase);
  if (total <= 0) return [];

  const key = String(purchase?.purchaseTreasuryKey || 'cash').trim().toLowerCase() || 'cash';
  const label = String(purchase?.purchaseTreasuryLabel || '').trim() || key;
  return [{ key, label, amount: total }];
}

export function purchaseHasDeferredTreasury(purchase) {
  const splits = resolvePurchaseTreasurySplits(purchase);
  if (splits.some((s) => isDeferredPurchaseTreasury(s.key))) return true;
  return isDeferredPurchaseTreasury(purchase?.purchaseTreasuryKey);
}

export function deferredTreasuryAmount(purchase) {
  const splits = resolvePurchaseTreasurySplits(purchase);
  return round2(
    splits.filter((s) => isDeferredPurchaseTreasury(s.key)).reduce((acc, s) => acc + s.amount, 0)
  );
}

export function paidNowTreasuryAmount(purchase) {
  const splits = resolvePurchaseTreasurySplits(purchase);
  return round2(
    splits.filter((s) => !isDeferredPurchaseTreasury(s.key)).reduce((acc, s) => acc + s.amount, 0)
  );
}

export function derivePurchaseTreasuryKey(splits) {
  if (!splits?.length) return 'cash';
  if (splits.length === 1) return splits[0].key;
  const allDeferred = splits.every((s) => isDeferredPurchaseTreasury(s.key));
  if (allDeferred) return PURCHASE_TREASURY_DEFERRED_KEY;
  return 'mixed';
}

export function derivePurchaseTreasuryLabel(splits, tMap = new Map()) {
  if (!splits?.length) return '';
  if (splits.length === 1) {
    const s = splits[0];
    if (isDeferredPurchaseTreasury(s.key)) return PURCHASE_TREASURY_DEFERRED_LABEL;
    return String(tMap.get(s.key) || s.label || s.key).trim();
  }
  return splits
    .map((s) => {
      if (isDeferredPurchaseTreasury(s.key)) return PURCHASE_TREASURY_DEFERRED_LABEL;
      return String(tMap.get(s.key) || s.label || s.key).trim();
    })
    .join(' + ');
}

/**
 * Normalize API payload: purchaseTreasurySplits[] or legacy purchaseTreasuryKey.
 */
export function normalizePurchaseTreasuryInput({
  purchaseTreasurySplits: splitsRaw,
  purchaseTreasuryKey: keyRaw,
  lineTotal,
  treasuryMethods,
  tMap,
  exchangeTradeIn = false,
}) {
  const total = round2(lineTotal);
  if (total <= 0) {
    return { error: 'Invalid purchase total' };
  }

  if (exchangeTradeIn) {
    return {
      splits: [],
      treasuryKey: 'exchange',
      treasuryLabel: 'Exchange',
      amountPaid: 0,
      hasDeferred: false,
    };
  }

  const keysAllowed = new Set((treasuryMethods || []).map((m) => m.key));
  keysAllowed.add(PURCHASE_TREASURY_DEFERRED_KEY);

  let splits = [];
  if (Array.isArray(splitsRaw) && splitsRaw.length) {
    for (const row of splitsRaw) {
      const key = String(row?.key ?? '')
        .trim()
        .toLowerCase();
      const amount = round2(row?.amount);
      if (!key || amount <= 0) continue;
      if (!keysAllowed.has(key)) {
        return { error: 'Invalid purchase treasury method' };
      }
      const label = isDeferredPurchaseTreasury(key)
        ? PURCHASE_TREASURY_DEFERRED_LABEL
        : String(tMap?.get(key) || row?.label || key).trim();
      splits.push({ key, label, amount });
    }
    if (!splits.length) {
      return { error: 'At least one purchase treasury split is required' };
    }
    const sum = round2(splits.reduce((acc, s) => acc + s.amount, 0));
    if (Math.abs(sum - total) > 0.01) {
      return { error: 'Treasury amounts must equal total purchase cost' };
    }
  } else {
    const key =
      keyRaw !== undefined && keyRaw !== null && String(keyRaw).trim() !== ''
        ? String(keyRaw).trim().toLowerCase()
        : 'cash';
    if (!keysAllowed.has(key)) {
      return { error: 'Invalid purchase treasury method' };
    }
    const label = isDeferredPurchaseTreasury(key)
      ? PURCHASE_TREASURY_DEFERRED_LABEL
      : String(tMap?.get(key) || key).trim();
    splits = [{ key, label, amount: total }];
  }

  const treasuryKey = derivePurchaseTreasuryKey(splits);
  const treasuryLabel = derivePurchaseTreasuryLabel(splits, tMap);
  const hasDeferred = splits.some((s) => isDeferredPurchaseTreasury(s.key));
  const amountPaid = hasDeferred ? paidNowTreasuryAmount({ purchaseTreasurySplits: splits }) : 0;

  return { splits, treasuryKey, treasuryLabel, amountPaid, hasDeferred };
}

/** Spread purchase cost across treasury keys (for reports / drawer close). */
export function aggregateTreasuryAmountsFromPurchases(rows) {
  const byKey = {};
  for (const r of rows) {
    const splits = resolvePurchaseTreasurySplits(r);
    const seen = new Set();
    for (const s of splits) {
      const key = s.key;
      const label = s.label || key;
      if (!byKey[key]) {
        byKey[key] = { key, label, total: 0, count: 0 };
      }
      byKey[key].total = round2(byKey[key].total + s.amount);
      if (!seen.has(key)) {
        byKey[key].count += 1;
        seen.add(key);
      }
    }
  }
  return byKey;
}

/** Physical drawer cash outflow from desk purchases (cash split amounts only). */
export function sumCashDrawerOutflowFromPurchases(rows) {
  let total = 0;
  for (const r of rows || []) {
    const splits = resolvePurchaseTreasurySplits(r);
    for (const s of splits) {
      if (treasuryKeyIsCashDrawer(s.key)) {
        total = round2(total + s.amount);
      }
    }
  }
  return total;
}

/** Effective treasury lines for a daily expense (splits or legacy single amount as cash). */
export function resolveExpenseTreasurySplits(expense) {
  const doc = expense && typeof expense.toObject === 'function' ? expense.toObject() : expense;
  const raw = coerceTreasurySplitsArray(doc?.expenseTreasurySplits);
  if (raw.length) {
    return raw
      .map((row) => ({
        key: String(row?.key ?? '')
          .trim()
          .toLowerCase(),
        label: String(row?.label ?? '').trim(),
        amount: round2(row?.amount),
      }))
      .filter((s) => s.key && s.amount > 0);
  }

  const total = round2(Number(doc?.amount) || 0);
  if (total <= 0) return [];

  const key = String(doc?.expenseTreasuryKey || 'cash').trim().toLowerCase() || 'cash';
  const label = String(doc?.expenseTreasuryLabel || '').trim() || key;
  return [{ key, label, amount: total }];
}

/** Sum of amounts paid from the physical cash drawer treasury. */
export function cashAmountFromTreasurySplits(splits) {
  return round2(
    (splits || [])
      .filter((s) => treasuryKeyIsCashDrawer(s.key))
      .reduce((acc, s) => acc + (Number(s.amount) || 0), 0)
  );
}

/** Cash-only portion of daily expenses (for drawer close). */
export function sumCashDrawerOutflowFromExpenses(rows) {
  let total = 0;
  for (const r of rows || []) {
    const splits = resolveExpenseTreasurySplits(r);
    for (const s of splits) {
      if (treasuryKeyIsCashDrawer(s.key)) {
        total = round2(total + s.amount);
      }
    }
  }
  return total;
}

/** Shared normalizer (desk purchase + daily expense). */
export const normalizeTreasurySplitsInput = normalizePurchaseTreasuryInput;
