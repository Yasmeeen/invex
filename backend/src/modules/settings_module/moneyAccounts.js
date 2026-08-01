import StoreSettings from '../../DB/models/storeSettings.model.js';
import {
  DEFAULT_PURCHASE_TREASURY_METHODS,
  normalizePurchaseTreasuryMethods,
} from './treasuryMethods.js';

const KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;
const ACCOUNT_KINDS = new Set(['cash', 'treasury', 'settlement']);

/** Settlement apps — money held by the provider until they pay the store. */
export const DEFAULT_SETTLEMENT_ACCOUNTS = [
  { key: 'valu', label: 'فاليو', kind: 'settlement' },
  { key: 'aman', label: 'أمان', kind: 'settlement' },
  { key: 'halan', label: 'حالان', kind: 'settlement' },
  { key: 'tru', label: 'ترو', kind: 'settlement' },
  { key: 'sohoula', label: 'سهولة', kind: 'settlement' },
  { key: 'maylo_seven', label: 'مايلو سفن', kind: 'settlement' },
  { key: 'forsa', label: 'فرصة', kind: 'settlement' },
  { key: 'fawry', label: 'فوري', kind: 'settlement' },
];

/** Default payment method → account mapping (cash always → cash). */
export const DEFAULT_PAYMENT_METHOD_ACCOUNT_MAP = [
  { method: 'cash', accountKey: 'cash' },
  { method: 'visa', accountKey: 'bank_ahli' },
  { method: 'mastercard', accountKey: 'bank_ahli' },
  { method: 'meeza', accountKey: 'bank_ahli' },
  { method: 'vodafone_cash', accountKey: 'vodafone_cash' },
  { method: 'instapay', accountKey: 'bank_misr' },
  { method: 'etisalat_cash', accountKey: 'etisalat_cash' },
  { method: 'valu', accountKey: 'valu' },
  { method: 'aman', accountKey: 'aman' },
  { method: 'halan', accountKey: 'halan' },
  { method: 'tru', accountKey: 'tru' },
  { method: 'sohoula', accountKey: 'sohoula' },
  { method: 'maylo_seven', accountKey: 'maylo_seven' },
  { method: 'forsa', accountKey: 'forsa' },
  { method: 'fawry', accountKey: 'fawry' },
];

function normalizeKey(raw) {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .slice(0, 40);
}

/**
 * Build unified money accounts from treasuries + settlement accounts.
 * Always includes cash with kind `cash`.
 */
export function normalizeMoneyAccounts({ purchaseTreasuryMethods, moneyAccounts } = {}) {
  const treasuries = normalizePurchaseTreasuryMethods(purchaseTreasuryMethods);
  const seen = new Set();
  const out = [];

  const push = (key, label, kind) => {
    const k = normalizeKey(key);
    if (!k || !KEY_PATTERN.test(k) || seen.has(k)) return;
    const lbl = String(label || '').trim().slice(0, 120) || k;
    let kindNorm = String(kind || '').trim().toLowerCase();
    if (k === 'cash') kindNorm = 'cash';
    if (!ACCOUNT_KINDS.has(kindNorm)) {
      kindNorm = k === 'cash' ? 'cash' : 'treasury';
    }
    seen.add(k);
    out.push({ key: k, label: lbl, kind: kindNorm });
  };

  for (const row of treasuries) {
    push(row.key, row.label, row.key === 'cash' ? 'cash' : 'treasury');
  }

  const rawMoney = Array.isArray(moneyAccounts) ? moneyAccounts : [];
  if (rawMoney.length === 0) {
    for (const row of DEFAULT_SETTLEMENT_ACCOUNTS) {
      push(row.key, row.label, 'settlement');
    }
  } else {
    for (const row of rawMoney) {
      const kind = String(row?.kind || '').trim().toLowerCase();
      if (kind === 'settlement' || (!kind && !treasuries.some((t) => t.key === normalizeKey(row?.key)))) {
        push(row?.key, row?.label, kind === 'settlement' ? 'settlement' : kind || 'settlement');
      } else if (kind === 'treasury' || kind === 'cash') {
        push(row?.key, row?.label, kind);
      }
    }
  }

  if (!out.some((x) => x.key === 'cash')) {
    out.unshift({ key: 'cash', label: 'نقدي', kind: 'cash' });
  }

  return out;
}

/**
 * Effective purchase treasuries derived from money accounts (cash + treasury kinds only).
 * Keeps purchase UI / existing APIs working off purchaseTreasuryMethods shape.
 */
export function moneyAccountsToPurchaseTreasuries(moneyAccounts) {
  const list = Array.isArray(moneyAccounts) ? moneyAccounts : [];
  const treasuries = list
    .filter((a) => a.kind === 'cash' || a.kind === 'treasury')
    .map((a) => ({ key: a.key, label: a.label }));
  return normalizePurchaseTreasuryMethods(treasuries.length ? treasuries : DEFAULT_PURCHASE_TREASURY_METHODS);
}

/**
 * Normalize paymentMethod → accountKey map.
 * `cash` always maps to `cash`. Empty / missing accountKey means unmapped (no ledger impact).
 * Methods with accountKey '' are dropped.
 */
export function normalizePaymentMethodAccountMap(rawList, validAccountKeys) {
  const valid = validAccountKeys instanceof Set ? validAccountKeys : new Set(validAccountKeys || []);
  const seen = new Set();
  const out = [];

  const source =
    Array.isArray(rawList) && rawList.length > 0
      ? rawList
      : DEFAULT_PAYMENT_METHOD_ACCOUNT_MAP;

  for (const row of source) {
    const method = normalizeKey(row?.method);
    if (!method || method === 'credit' || method === 'mixed' || !KEY_PATTERN.test(method) || seen.has(method)) {
      continue;
    }
    let accountKey = normalizeKey(row?.accountKey);
    if (method === 'cash') accountKey = 'cash';
    if (!accountKey) continue;
    if (valid.size > 0 && !valid.has(accountKey)) continue;
    seen.add(method);
    out.push({ method, accountKey });
  }

  if (!out.some((x) => x.method === 'cash')) {
    out.unshift({ method: 'cash', accountKey: 'cash' });
  }

  out.sort((a, b) => a.method.localeCompare(b.method));
  return out;
}

export function paymentMethodToAccountMap(mapRows) {
  const m = new Map();
  for (const row of mapRows || []) {
    m.set(row.method, row.accountKey);
  }
  m.set('cash', 'cash');
  return m;
}

export async function getEffectiveMoneyAccountsFromDb() {
  const doc = await StoreSettings.findOne()
    .sort({ updatedAt: -1 })
    .select('purchaseTreasuryMethods moneyAccounts paymentMethodAccountMap')
    .lean();
  const moneyAccounts = normalizeMoneyAccounts({
    purchaseTreasuryMethods: doc?.purchaseTreasuryMethods,
    moneyAccounts: doc?.moneyAccounts,
  });
  const keys = new Set(moneyAccounts.map((a) => a.key));
  const paymentMethodAccountMap = normalizePaymentMethodAccountMap(
    doc?.paymentMethodAccountMap,
    keys
  );
  return { moneyAccounts, paymentMethodAccountMap };
}

export function moneyAccountMap(accounts) {
  const m = new Map();
  for (const row of accounts || []) {
    m.set(row.key, row);
  }
  return m;
}
