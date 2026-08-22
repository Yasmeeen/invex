const KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;

/** Only cash is built-in. Banks/wallets are created by the store under money accounts. */
export const DEFAULT_PURCHASE_TREASURY_METHODS = [{ key: 'cash', label: 'نقدي' }];

/** Old starter treasuries — never seed these; purchase lists come from payment-method showIn. */
export const RETIRED_DEFAULT_PURCHASE_TREASURY_KEYS = new Set([
  'bank_misr',
  'bank_ahli',
  'bank_ahli_corp',
  'etisalat_cash',
  'vodafone_cash',
  'orange_30_cash',
  'orange_40_cash',
]);

function uniqNormalize(rawList) {
  const seen = new Set();
  const out = [];
  if (Array.isArray(rawList)) {
    for (const row of rawList) {
      const key = String(row?.key ?? '')
        .trim()
        .toLowerCase()
        .slice(0, 40);
      const label = String(row?.label ?? '').trim().slice(0, 120);
      if (!key || !label || !KEY_PATTERN.test(key) || seen.has(key)) continue;
      if (RETIRED_DEFAULT_PURCHASE_TREASURY_KEYS.has(key)) continue;
      seen.add(key);
      out.push({ key, label });
    }
  }
  if (!out.some((x) => x.key === 'cash')) {
    out.unshift({ key: 'cash', label: 'نقدي' });
  }
  return out;
}

/**
 * Effective methods for API/UI (never empty; always includes `cash`).
 */
export function normalizePurchaseTreasuryMethods(rawList) {
  return uniqNormalize(rawList);
}

export async function getEffectivePurchaseTreasuryMethodsFromDb() {
  const { getEffectiveMoneyAccountsFromDb } = await import('./moneyAccounts.js');
  const { catalogToPurchaseTreasuryMethods } = await import('./paymentMethodsCatalog.js');
  const { moneyAccounts, paymentMethodAccountMap, paymentMethodsCatalog } =
    await getEffectiveMoneyAccountsFromDb();
  return catalogToPurchaseTreasuryMethods(
    paymentMethodsCatalog,
    paymentMethodAccountMap,
    moneyAccounts
  );
}

export function treasuryMethodMap(methods) {
  const m = new Map();
  for (const row of methods || []) {
    m.set(row.key, row.label);
  }
  return m;
}

/** Physical drawer cash — only this bucket reduces expected drawer cash. */
export function treasuryKeyIsCashDrawer(key) {
  return String(key || '').trim().toLowerCase() === 'cash';
}

/** Pay later — no cash drawer outflow; supplier liability via PurchasingRequest. */
export const PURCHASE_TREASURY_DEFERRED_KEY = 'deferred';

export const PURCHASE_TREASURY_DEFERRED_LABEL = 'شراء بالآجل';

export function isDeferredPurchaseTreasury(key) {
  return String(key || '').trim().toLowerCase() === PURCHASE_TREASURY_DEFERRED_KEY;
}
