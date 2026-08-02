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
  { method: 'cash', accountKey: 'cash', mode: 'instant' },
  { method: 'visa', accountKey: 'bank_ahli', mode: 'instant' },
  { method: 'mastercard', accountKey: 'bank_ahli', mode: 'instant' },
  { method: 'meeza', accountKey: 'bank_ahli', mode: 'instant' },
  { method: 'vodafone_cash', accountKey: 'vodafone_cash', mode: 'instant' },
  { method: 'instapay', accountKey: 'bank_misr', mode: 'instant' },
  { method: 'etisalat_cash', accountKey: 'etisalat_cash', mode: 'instant' },
  { method: 'valu', accountKey: 'valu', mode: 'settlement', settlementBankAccountKey: 'bank_ahli' },
  { method: 'aman', accountKey: 'aman', mode: 'settlement', settlementBankAccountKey: 'bank_ahli' },
  { method: 'halan', accountKey: 'halan', mode: 'settlement', settlementBankAccountKey: 'bank_ahli' },
  { method: 'tru', accountKey: 'tru', mode: 'settlement', settlementBankAccountKey: 'bank_ahli' },
  { method: 'sohoula', accountKey: 'sohoula', mode: 'settlement', settlementBankAccountKey: 'bank_ahli' },
  { method: 'maylo_seven', accountKey: 'maylo_seven', mode: 'settlement', settlementBankAccountKey: 'bank_ahli' },
  { method: 'forsa', accountKey: 'forsa', mode: 'settlement', settlementBankAccountKey: 'bank_ahli' },
  { method: 'fawry', accountKey: 'fawry', mode: 'settlement', settlementBankAccountKey: 'bank_ahli' },
];

const SETTLEMENT_DEFAULT_KEYS = new Set(DEFAULT_SETTLEMENT_ACCOUNTS.map((a) => a.key));

function normalizeKey(raw) {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .slice(0, 40);
}

/** Guess bank vs wallet from key when channel not set (migration only). */
export function inferAccountChannel(key) {
  const k = normalizeKey(key);
  if (!k || k === 'cash') return '';
  if (
    k.includes('vodafone') ||
    k.includes('etisalat') ||
    k.includes('orange') ||
    k.includes('wallet') ||
    k.includes('_cash') ||
    k.endsWith('cash')
  ) {
    return 'wallet';
  }
  if (k.includes('bank') || k.includes('instapay')) {
    return 'bank';
  }
  return 'bank';
}

function normalizeChannel(kind, key, rawChannel) {
  if (kind === 'cash' || kind === 'settlement') return '';
  const c = String(rawChannel || '')
    .trim()
    .toLowerCase();
  if (c === 'bank' || c === 'wallet') return c;
  return inferAccountChannel(key);
}

function normalizeOptionalRef(raw, maxLen) {
  return String(raw ?? '')
    .trim()
    .slice(0, maxLen);
}

/**
 * Build unified money accounts from treasuries + settlement accounts.
 * Always includes cash with kind `cash`.
 */
export function normalizeMoneyAccounts({ purchaseTreasuryMethods, moneyAccounts } = {}) {
  const treasuries = normalizePurchaseTreasuryMethods(purchaseTreasuryMethods);
  const seen = new Set();
  const out = [];
  const rawMoney = Array.isArray(moneyAccounts) ? moneyAccounts : [];
  const extrasByKey = new Map();
  for (const row of rawMoney) {
    const k = normalizeKey(row?.key);
    if (k) extrasByKey.set(k, row);
  }

  const push = (key, label, kind, extras = {}) => {
    const k = normalizeKey(key);
    if (!k || !KEY_PATTERN.test(k) || seen.has(k)) return;
    const lbl = String(label || '').trim().slice(0, 120) || k;
    let kindNorm = String(kind || '').trim().toLowerCase();
    if (k === 'cash') kindNorm = 'cash';
    if (!ACCOUNT_KINDS.has(kindNorm)) {
      kindNorm = k === 'cash' ? 'cash' : 'treasury';
    }
    const channel = normalizeChannel(kindNorm, k, extras.channel);
    const accountNumber =
      channel === 'bank' ? normalizeOptionalRef(extras.accountNumber, 80) : '';
    const phone = channel === 'wallet' ? normalizeOptionalRef(extras.phone, 40) : '';
    seen.add(k);
    out.push({
      key: k,
      label: lbl,
      kind: kindNorm,
      channel,
      accountNumber,
      phone,
    });
  };

  for (const row of treasuries) {
    const extra = extrasByKey.get(normalizeKey(row.key)) || {};
    push(row.key, row.label, row.key === 'cash' ? 'cash' : 'treasury', extra);
  }

  if (rawMoney.length === 0) {
    for (const row of DEFAULT_SETTLEMENT_ACCOUNTS) {
      push(row.key, row.label, 'settlement');
    }
  } else {
    for (const row of rawMoney) {
      const kind = String(row?.kind || '').trim().toLowerCase();
      if (kind === 'settlement' || (!kind && !treasuries.some((t) => t.key === normalizeKey(row?.key)))) {
        push(row?.key, row?.label, kind === 'settlement' ? 'settlement' : kind || 'settlement', row);
      } else if (kind === 'treasury' || kind === 'cash') {
        // Already pushed from treasuries when present; fill missing treasury-only rows
        const k = normalizeKey(row?.key);
        if (k && !seen.has(k)) {
          push(row?.key, row?.label, kind, row);
        } else if (k && seen.has(k)) {
          // Refresh label/extras from moneyAccounts when both sources have the key
          const idx = out.findIndex((x) => x.key === k);
          if (idx >= 0 && kind === 'treasury') {
            const channel = normalizeChannel('treasury', k, row.channel);
            out[idx] = {
              ...out[idx],
              label: String(row?.label || out[idx].label).trim().slice(0, 120) || out[idx].label,
              channel,
              accountNumber:
                channel === 'bank' ? normalizeOptionalRef(row.accountNumber, 80) : '',
              phone: channel === 'wallet' ? normalizeOptionalRef(row.phone, 40) : '',
            };
          }
        }
      }
    }
  }

  if (!out.some((x) => x.key === 'cash')) {
    out.unshift({
      key: 'cash',
      label: 'نقدي',
      kind: 'cash',
      channel: '',
      accountNumber: '',
      phone: '',
    });
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
 * Methods with accountKey '' are dropped. `credit` / `mixed` never mapped.
 */
export function normalizePaymentMethodAccountMap(rawList, validAccountKeys, accountsByKey) {
  const valid = validAccountKeys instanceof Set ? validAccountKeys : new Set(validAccountKeys || []);
  const accMap =
    accountsByKey instanceof Map
      ? accountsByKey
      : new Map((Array.isArray(accountsByKey) ? accountsByKey : []).map((a) => [a.key, a]));
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

    let mode = String(row?.mode || '')
      .trim()
      .toLowerCase();
    if (mode !== 'instant' && mode !== 'settlement') {
      const acc = accMap.get(accountKey);
      if (acc?.kind === 'settlement' || SETTLEMENT_DEFAULT_KEYS.has(accountKey) || SETTLEMENT_DEFAULT_KEYS.has(method)) {
        mode = 'settlement';
      } else {
        mode = 'instant';
      }
    }
    if (method === 'cash') mode = 'instant';

    let settlementBankAccountKey = normalizeKey(row?.settlementBankAccountKey);
    if (mode !== 'settlement') {
      settlementBankAccountKey = '';
    } else if (
      settlementBankAccountKey &&
      valid.size > 0 &&
      !valid.has(settlementBankAccountKey)
    ) {
      settlementBankAccountKey = '';
    } else if (settlementBankAccountKey === accountKey) {
      settlementBankAccountKey = '';
    }

    seen.add(method);
    out.push({
      method,
      accountKey,
      mode,
      settlementBankAccountKey: settlementBankAccountKey || '',
    });
  }

  if (!out.some((x) => x.method === 'cash')) {
    out.unshift({ method: 'cash', accountKey: 'cash', mode: 'instant', settlementBankAccountKey: '' });
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

/** Find settlement bank for a settlement account key from the payment map. */
export function settlementBankForAccount(mapRows, settlementAccountKey) {
  const key = normalizeKey(settlementAccountKey);
  if (!key) return '';
  for (const row of mapRows || []) {
    if (row.accountKey === key && row.mode === 'settlement' && row.settlementBankAccountKey) {
      return row.settlementBankAccountKey;
    }
  }
  return '';
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
    keys,
    moneyAccounts
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
