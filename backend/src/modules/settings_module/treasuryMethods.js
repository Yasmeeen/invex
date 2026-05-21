import StoreSettings from '../../DB/models/storeSettings.model.js';

const KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;

/** Starter list — admins can edit in Store Settings (Arabic labels typical). */
export const DEFAULT_PURCHASE_TREASURY_METHODS = [
  { key: 'cash', label: 'نقدي' },
  { key: 'bank_misr', label: 'بنك مصر' },
  { key: 'bank_ahli', label: 'بنك الأهلي' },
  { key: 'bank_ahli_corp', label: 'بنك الأهلي شركات' },
  { key: 'etisalat_cash', label: 'اتصالات كاش' },
  { key: 'vodafone_cash', label: 'فودافون كاش' },
  { key: 'orange_30_cash', label: 'أورانج ٣٠ كاش' },
  { key: 'orange_40_cash', label: 'أورانج ٤٠ كاش' },
];

function uniqNormalize(rawList) {
  if (!Array.isArray(rawList) || rawList.length === 0) {
    return DEFAULT_PURCHASE_TREASURY_METHODS.map((x) => ({ ...x }));
  }
  const seen = new Set();
  const out = [];
  for (const row of rawList) {
    const key = String(row?.key ?? '')
      .trim()
      .toLowerCase()
      .slice(0, 40);
    const label = String(row?.label ?? '').trim().slice(0, 120);
    if (!key || !label || !KEY_PATTERN.test(key) || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, label });
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
  const doc = await StoreSettings.findOne().sort({ updatedAt: -1 }).select('purchaseTreasuryMethods').lean();
  return normalizePurchaseTreasuryMethods(doc?.purchaseTreasuryMethods);
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
