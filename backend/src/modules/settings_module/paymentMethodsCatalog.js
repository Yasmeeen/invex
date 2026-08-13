import { normalizePaymentAppFeePercents } from './paymentAppFees.js';
import {
  DEFAULT_PURCHASE_TREASURY_METHODS,
  normalizePurchaseTreasuryMethods,
} from './treasuryMethods.js';
import { DEFAULT_SETTLEMENT_ACCOUNTS } from './moneyAccounts.js';

const KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;
const SHOW_IN = new Set(['sale', 'purchase', 'both']);
const EFFECT_MODES = new Set(['instant', 'settlement', 'none']);
const FEE_BLOCKED = new Set(['cash', 'credit', 'mixed']);

/** Known cashier/sale methods (labels Arabic; client can edit). */
const DEFAULT_SALE_METHODS = [
  { key: 'cash', label: 'نقدي', showIn: 'both', effectMode: 'instant' },
  { key: 'credit', label: 'بيع بالآجل', showIn: 'both', effectMode: 'none' },
  { key: 'visa', label: 'فيزا', showIn: 'sale', effectMode: 'instant' },
  { key: 'mastercard', label: 'ماستركارد', showIn: 'sale', effectMode: 'instant' },
  { key: 'meeza', label: 'ميزة', showIn: 'sale', effectMode: 'instant' },
  { key: 'vodafone_cash', label: 'فودافون كاش', showIn: 'both', effectMode: 'instant' },
  { key: 'instapay', label: 'إنستاباي', showIn: 'sale', effectMode: 'instant' },
  { key: 'etisalat_cash', label: 'اتصالات كاش', showIn: 'both', effectMode: 'instant' },
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
  if (FEE_BLOCKED.has(key)) return 0;
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
  purchaseTreasuryMethods,
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
    for (const row of rawCatalog) push(row);
    if (!seen.has('cash')) {
      push({ key: 'cash', label: 'نقدي', showIn: 'both', effectMode: 'instant', feePercent: 0 });
    }
    if (!seen.has('credit')) {
      push({ key: 'credit', label: 'بيع بالآجل', showIn: 'both', effectMode: 'none', feePercent: 0 });
    }
    // Keep cash & credit near the top
    out.sort((a, b) => {
      const rank = (k) => (k === 'cash' ? 0 : k === 'credit' ? 1 : 2);
      const d = rank(a.key) - rank(b.key);
      return d !== 0 ? d : a.key.localeCompare(b.key);
    });
    return out;
  }

  // --- Migrate from existing settings ---
  const fees = normalizePaymentAppFeePercents(paymentAppFeePercents);
  const feeMap = new Map(fees.map((f) => [f.method, f]));
  const treasuries = normalizePurchaseTreasuryMethods(purchaseTreasuryMethods);
  const treasuryKeys = new Set(treasuries.map((t) => t.key));
  const settlementKeys = new Set(DEFAULT_SETTLEMENT_ACCOUNTS.map((a) => a.key));

  for (const def of DEFAULT_SALE_METHODS) {
    const fee = feeMap.get(def.key);
    const inTreasury = treasuryKeys.has(def.key);
    let showIn = def.showIn;
    if (def.key !== 'cash' && def.key !== 'credit') {
      if (fee && inTreasury) showIn = 'both';
      else if (fee) showIn = 'sale';
      else if (inTreasury && def.effectMode === 'instant') showIn = def.showIn === 'both' ? 'both' : 'both';
    }
    push(
      {
        key: def.key,
        label: fee?.label || def.label,
        showIn,
        effectMode: def.effectMode,
        feePercent: fee?.percent ?? 0,
      },
      def
    );
  }

  // Custom fee rows not in defaults
  for (const fee of fees) {
    if (seen.has(fee.method)) continue;
    const inTreasury = treasuryKeys.has(fee.method);
    push({
      key: fee.method,
      label: fee.label || fee.method,
      showIn: inTreasury ? 'both' : 'sale',
      effectMode: settlementKeys.has(fee.method) ? 'settlement' : 'instant',
      feePercent: fee.percent,
    });
  }

  // Purchase-only treasuries (banks etc.)
  for (const t of treasuries) {
    if (seen.has(t.key)) {
      // Ensure showIn includes purchase when key exists as treasury
      const row = out.find((x) => x.key === t.key);
      if (row && row.effectMode !== 'none' && row.showIn === 'sale') {
        row.showIn = 'both';
      }
      if (row && t.label) row.label = t.label;
      continue;
    }
    push({
      key: t.key,
      label: t.label,
      showIn: 'purchase',
      effectMode: 'instant',
      feePercent: 0,
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
 * Purchase treasury pickers — derived from catalog (purchase-visible, has money effect).
 * Always includes cash.
 */
export function catalogToPurchaseTreasuryMethods(catalog) {
  const list = Array.isArray(catalog) ? catalog : [];
  const rows = list
    .filter((r) => catalogShowsInPurchase(r) && r.effectMode !== 'none')
    .map((r) => ({ key: r.key, label: r.label }));
  if (!rows.some((r) => r.key === 'cash')) {
    rows.unshift({ key: 'cash', label: 'نقدي' });
  }
  return normalizePurchaseTreasuryMethods(rows.length ? rows : DEFAULT_PURCHASE_TREASURY_METHODS);
}

/**
 * Ensure moneyAccounts cover catalog methods that need a balance home.
 * Does not remove existing accounts (preserves balances).
 */
export function mergeMoneyAccountsFromCatalog(moneyAccounts, catalog) {
  const list = Array.isArray(moneyAccounts) ? [...moneyAccounts] : [];
  const seen = new Set(list.map((a) => normalizeKey(a.key)));
  for (const row of catalog || []) {
    if (!row || row.effectMode === 'none') continue;
    const key = normalizeKey(row.key);
    if (!key) continue;

    if (row.effectMode === 'settlement') {
      if (seen.has(key)) {
        const existing = list.find((a) => normalizeKey(a.key) === key);
        if (existing && existing.kind === 'settlement' && row.label) {
          existing.label = row.label;
        }
      } else {
        list.push({
          key,
          label: row.label,
          kind: 'settlement',
          channel: '',
          accountNumber: '',
          phone: '',
          enabled: true,
        });
        seen.add(key);
      }
      continue;
    }

    if (seen.has(key)) continue;
    if (catalogShowsInPurchase(row) || key === 'cash') {
      list.push({
        key,
        label: row.label,
        kind: key === 'cash' ? 'cash' : 'treasury',
        channel: '',
        accountNumber: '',
        phone: '',
        enabled: true,
      });
      seen.add(key);
    }
  }
  return list;
}
