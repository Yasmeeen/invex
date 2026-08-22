import { normalizePaymentAppFeePercents } from './paymentAppFees.js';
import {
  RETIRED_DEFAULT_PURCHASE_TREASURY_KEYS,
} from './treasuryMethods.js';
import { DEFAULT_SETTLEMENT_ACCOUNTS, paymentMethodToAccountMap } from './moneyAccounts.js';

const KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;
const SHOW_IN = new Set(['sale', 'purchase', 'both']);
const EFFECT_MODES = new Set(['instant', 'settlement', 'none']);
/** Cashier app-fee percents (Aman/Valu…) — credit markup is stored on the catalog row instead. */
const FEE_BLOCKED = new Set(['cash', 'credit', 'mixed']);
const FEE_PERCENT_BLOCKED = new Set(['cash', 'mixed']);

/** Known cashier/sale methods (labels Arabic; client can edit). */
const DEFAULT_SALE_METHODS = [
  { key: 'cash', label: 'نقدي', showIn: 'both', effectMode: 'instant' },
  { key: 'credit', label: 'بيع بالآجل', showIn: 'both', effectMode: 'none' },
  { key: 'visa', label: 'فيزا', showIn: 'sale', effectMode: 'instant' },
  { key: 'mastercard', label: 'ماستركارد', showIn: 'sale', effectMode: 'instant' },
  { key: 'meeza', label: 'ميزة', showIn: 'sale', effectMode: 'instant' },
  { key: 'vodafone_cash', label: 'فودافون كاش', showIn: 'sale', effectMode: 'instant' },
  { key: 'instapay', label: 'إنستاباي', showIn: 'sale', effectMode: 'instant' },
  { key: 'etisalat_cash', label: 'اتصالات كاش', showIn: 'sale', effectMode: 'instant' },
  { key: 'valu', label: 'فاليو', showIn: 'sale', effectMode: 'settlement' },
  { key: 'aman', label: 'أمان', showIn: 'sale', effectMode: 'settlement' },
  { key: 'halan', label: 'حالان', showIn: 'sale', effectMode: 'settlement' },
  { key: 'tru', label: 'ترو', showIn: 'sale', effectMode: 'settlement' },
  { key: 'sohoula', label: 'سهولة', showIn: 'sale', effectMode: 'settlement' },
  { key: 'maylo_seven', label: 'مايلو سفن', showIn: 'sale', effectMode: 'settlement' },
  { key: 'forsa', label: 'فرصة', showIn: 'sale', effectMode: 'settlement' },
  { key: 'fawry', label: 'فوري', showIn: 'sale', effectMode: 'settlement' },
];

function normalizeKey(raw) {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .slice(0, 40);
}

function normalizeShowIn(raw, fallback = 'sale') {
  const v = String(raw || '')
    .trim()
    .toLowerCase();
  return SHOW_IN.has(v) ? v : fallback;
}

function normalizeEffectMode(key, raw) {
  if (key === 'credit') return 'none';
  if (key === 'cash') return 'instant';
  const v = String(raw || '')
    .trim()
    .toLowerCase();
  return EFFECT_MODES.has(v) ? v : 'instant';
}

function normalizeFeePercent(key, raw) {
  if (FEE_PERCENT_BLOCKED.has(key)) return 0;
  let percent = Number(raw);
  if (!Number.isFinite(percent)) percent = 0;
  return Math.max(0, Math.min(100, Math.round(percent * 100) / 100));
}

/**
 * Normalize a stored/unified payment methods catalog.
 * Empty/missing → migrate from fees + treasuries + defaults (read-time only).
 */
export function normalizePaymentMethodsCatalog({
  paymentMethodsCatalog,
  paymentAppFeePercents,
} = {}) {
  const seen = new Set();
  const out = [];

  const push = (row, defaults = {}) => {
    const key = normalizeKey(row?.key ?? row?.method);
    if (!key || key === 'mixed' || !KEY_PATTERN.test(key) || seen.has(key)) return;
    const label =
      String(row?.label ?? '').trim().slice(0, 120) ||
      String(defaults.label || '').trim().slice(0, 120) ||
      key;
    let showIn = normalizeShowIn(row?.showIn ?? defaults.showIn, defaults.showIn || 'sale');
    let effectMode = normalizeEffectMode(key, row?.effectMode ?? defaults.effectMode);
    if (key === 'credit') effectMode = 'none';
    if (key === 'cash') {
      effectMode = 'instant';
      if (!row?.showIn && !defaults.showIn) showIn = 'both';
    }
    const feePercent = normalizeFeePercent(key, row?.feePercent ?? defaults.feePercent ?? 0);
    seen.add(key);
    out.push({ key, label, showIn, effectMode, feePercent });
  };

  const rawCatalog = Array.isArray(paymentMethodsCatalog) ? paymentMethodsCatalog : [];
  if (rawCatalog.length > 0) {
    for (const row of rawCatalog) {
      const key = normalizeKey(row?.key ?? row?.method);
      const showIn = normalizeShowIn(row?.showIn, 'sale');
      // Drop retired purchase-treasury rows; keep if the store marked them for sale/both.
      if (RETIRED_DEFAULT_PURCHASE_TREASURY_KEYS.has(key) && showIn === 'purchase') continue;
      push(row);
    }
    if (!seen.has('cash')) {
      push({ key: 'cash', label: 'نقدي', showIn: 'both', effectMode: 'instant', feePercent: 0 });
    }
    if (!seen.has('credit')) {
      push({ key: 'credit', label: 'بيع بالآجل', showIn: 'both', effectMode: 'none', feePercent: 0 });
    }
    out.sort((a, b) => {
      const rank = (k) => (k === 'cash' ? 0 : k === 'credit' ? 1 : 2);
      const d = rank(a.key) - rank(b.key);
      return d !== 0 ? d : a.key.localeCompare(b.key);
    });
    return out;
  }

  // Empty catalog: cash + credit + configured fee methods. Do not seed purchase treasuries.
  const fees = normalizePaymentAppFeePercents(paymentAppFeePercents);
  const feeMap = new Map(fees.map((f) => [f.method, f]));
  const settlementKeys = new Set(DEFAULT_SETTLEMENT_ACCOUNTS.map((a) => a.key));

  for (const def of DEFAULT_SALE_METHODS) {
    const fee = feeMap.get(def.key);
    push(
      {
        key: def.key,
        label: fee?.label || def.label,
        showIn: def.showIn,
        effectMode: def.effectMode,
        feePercent: fee?.percent ?? 0,
      },
      def
    );
  }

  for (const fee of fees) {
    if (seen.has(fee.method)) continue;
    if (RETIRED_DEFAULT_PURCHASE_TREASURY_KEYS.has(fee.method)) continue;
    push({
      key: fee.method,
      label: fee.label || fee.method,
      showIn: 'sale',
      effectMode: settlementKeys.has(fee.method) ? 'settlement' : 'instant',
      feePercent: fee.percent,
    });
  }

  return out;
}

export function catalogShowsInSale(row) {
  return row?.showIn === 'sale' || row?.showIn === 'both';
}

export function catalogShowsInPurchase(row) {
  return row?.showIn === 'purchase' || row?.showIn === 'both';
}

/** Fees for cashier only — derived from catalog (sale-visible, non-blocked). */
export function catalogToPaymentAppFeePercents(catalog) {
  const list = Array.isArray(catalog) ? catalog : [];
  return normalizePaymentAppFeePercents(
    list
      .filter((r) => catalogShowsInSale(r) && !FEE_BLOCKED.has(r.key))
      .map((r) => ({
        method: r.key,
        label: r.label,
        percent: r.feePercent || 0,
      }))
  );
}

/**
 * Purchase pickers: payment-method catalog rows shown in purchase/both with instant effect.
 * Does not inject money-account rows (old purchase treasuries). Always includes cash.
 */
export function catalogToPurchaseTreasuryMethods(
  catalog,
  paymentMethodAccountMap,
  moneyAccounts
) {
  const list = Array.isArray(catalog) ? catalog : [];
  const spendable = new Set(
    (moneyAccounts || [])
      .filter((a) => a && (a.kind === 'cash' || a.kind === 'treasury'))
      .map((a) => normalizeKey(a.key))
      .filter(Boolean)
  );
  const map = paymentMethodToAccountMap(paymentMethodAccountMap || []);
  const rows = [];

  for (const r of list) {
    if (!r || !catalogShowsInPurchase(r) || r.effectMode !== 'instant') continue;
    const key = normalizeKey(r.key);
    if (!key) continue;
    if (RETIRED_DEFAULT_PURCHASE_TREASURY_KEYS.has(key) && r.showIn !== 'both') continue;
    if (key === 'cash') {
      rows.push({ key, label: r.label });
      continue;
    }
    if (spendable.size) {
      const acc = map.get(key);
      if (!acc || !spendable.has(acc)) continue;
    }
    rows.push({ key, label: r.label });
  }

  if (!rows.some((r) => r.key === 'cash')) {
    rows.unshift({ key: 'cash', label: 'نقدي' });
  }
  return rows;
}

/**
 * Never invent bank/wallet accounts from payment methods.
 * Stores add money accounts themselves and link methods to them.
 */
export function mergeMoneyAccountsFromCatalog(moneyAccounts, catalog) {
  const list = Array.isArray(moneyAccounts) ? [...moneyAccounts] : [];
  const seen = new Set(list.map((a) => normalizeKey(a.key)));
  if (!seen.has('cash')) {
    const cashRow = (catalog || []).find((r) => normalizeKey(r?.key) === 'cash');
    list.unshift({
      key: 'cash',
      label: cashRow?.label || 'نقدي',
      kind: 'cash',
      channel: '',
      accountNumber: '',
      phone: '',
      enabled: true,
    });
  }
  return list;
}
