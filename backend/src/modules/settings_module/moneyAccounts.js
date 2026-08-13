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

/** Default bank that receives settlement payouts (بنك مصر). */
export const DEFAULT_SETTLEMENT_BANK_KEY = 'bank_misr';

/** Default payment method → account mapping (cash always → cash). */
export const DEFAULT_PAYMENT_METHOD_ACCOUNT_MAP = [
  { method: 'cash', accountKey: 'cash', mode: 'instant' },
  { method: 'visa', accountKey: 'bank_ahli', mode: 'instant' },
  { method: 'mastercard', accountKey: 'bank_ahli', mode: 'instant' },
  { method: 'meeza', accountKey: 'bank_ahli', mode: 'instant' },
  { method: 'vodafone_cash', accountKey: 'vodafone_cash', mode: 'instant' },
  { method: 'instapay', accountKey: 'bank_misr', mode: 'instant' },
  { method: 'etisalat_cash', accountKey: 'etisalat_cash', mode: 'instant' },
  { method: 'valu', accountKey: 'valu', mode: 'settlement', settlementBankAccountKey: DEFAULT_SETTLEMENT_BANK_KEY },
  { method: 'aman', accountKey: 'aman', mode: 'settlement', settlementBankAccountKey: DEFAULT_SETTLEMENT_BANK_KEY },
  { method: 'halan', accountKey: 'halan', mode: 'settlement', settlementBankAccountKey: DEFAULT_SETTLEMENT_BANK_KEY },
  { method: 'tru', accountKey: 'tru', mode: 'settlement', settlementBankAccountKey: DEFAULT_SETTLEMENT_BANK_KEY },
  { method: 'sohoula', accountKey: 'sohoula', mode: 'settlement', settlementBankAccountKey: DEFAULT_SETTLEMENT_BANK_KEY },
  { method: 'maylo_seven', accountKey: 'maylo_seven', mode: 'settlement', settlementBankAccountKey: DEFAULT_SETTLEMENT_BANK_KEY },
  { method: 'forsa', accountKey: 'forsa', mode: 'settlement', settlementBankAccountKey: DEFAULT_SETTLEMENT_BANK_KEY },
  { method: 'fawry', accountKey: 'fawry', mode: 'settlement', settlementBankAccountKey: DEFAULT_SETTLEMENT_BANK_KEY },
];

const SETTLEMENT_DEFAULT_KEYS = new Set(DEFAULT_SETTLEMENT_ACCOUNTS.map((a) => a.key));

function normalizeKey(raw) {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .slice(0, 40);
}

/** Prefer بنك مصر when a settlement method has no payout bank yet. */
function resolveDefaultSettlementBank(valid, accMap, accountKey) {
  const preferred = DEFAULT_SETTLEMENT_BANK_KEY;
  if (preferred && preferred !== accountKey && (valid.size === 0 || valid.has(preferred))) {
    const acc = accMap.get(preferred);
    if (!acc || acc.kind === 'cash' || acc.kind === 'treasury') return preferred;
  }
  return '';
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
    let enabled = extras.enabled !== false && extras.enabled !== 0 && extras.enabled !== 'false';
    if (k === 'cash') enabled = true;
    seen.add(k);
    out.push({
      key: k,
      label: lbl,
      kind: kindNorm,
      channel,
      accountNumber,
      phone,
      enabled,
    });
  };

  for (const row of treasuries) {
    const extra = extrasByKey.get(normalizeKey(row.key)) || {};
    push(row.key, row.label, row.key === 'cash' ? 'cash' : 'treasury', extra);
  }

  for (const row of rawMoney) {
    const kind = String(row?.kind || '').trim().toLowerCase();
    const k = normalizeKey(row?.key);
    if (kind === 'settlement' || (!kind && SETTLEMENT_DEFAULT_KEYS.has(k))) {
      push(row?.key, row?.label, 'settlement', row);
    } else if (kind === 'treasury' || kind === 'cash') {
      // Already pushed from treasuries when present; fill missing treasury-only rows
      if (k && !seen.has(k)) {
        push(row?.key, row?.label, kind, row);
      } else if (k && seen.has(k)) {
        // Refresh label/extras from moneyAccounts when both sources have the key
        const idx = out.findIndex((x) => x.key === k);
        if (idx >= 0 && kind === 'treasury') {
          const channel = normalizeChannel('treasury', k, row.channel);
          let enabled = row.enabled !== false && row.enabled !== 0 && row.enabled !== 'false';
          if (k === 'cash') enabled = true;
          out[idx] = {
            ...out[idx],
            label: String(row?.label || out[idx].label).trim().slice(0, 120) || out[idx].label,
            channel,
            accountNumber:
              channel === 'bank' ? normalizeOptionalRef(row.accountNumber, 80) : '',
            phone: channel === 'wallet' ? normalizeOptionalRef(row.phone, 40) : '',
            enabled,
          };
        }
      }
    } else if (!kind && k && !seen.has(k)) {
      // Legacy rows without kind: treat as treasury (never assume settlement)
      push(row?.key, row?.label, 'treasury', row);
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
      enabled: true,
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
    let mode = String(row?.mode || '')
      .trim()
      .toLowerCase();
    if (mode !== 'instant' && mode !== 'settlement') {
      const inferredAcc = accMap.get(normalizeKey(row?.accountKey)) || accMap.get(method);
      if (
        inferredAcc?.kind === 'settlement' ||
        SETTLEMENT_DEFAULT_KEYS.has(normalizeKey(row?.accountKey)) ||
        SETTLEMENT_DEFAULT_KEYS.has(method)
      ) {
        mode = 'settlement';
      } else {
        mode = 'instant';
      }
    }
    if (method === 'cash') mode = 'instant';

    let accountKey = normalizeKey(row?.accountKey);
    if (method === 'cash') accountKey = 'cash';
    if (mode === 'settlement') accountKey = method;
    if (!accountKey) continue;
    if (valid.size > 0 && !valid.has(accountKey)) continue;

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
    } else if (settlementBankAccountKey) {
      const bankAcc = accMap.get(settlementBankAccountKey);
      if (bankAcc && bankAcc.kind !== 'cash' && bankAcc.kind !== 'treasury') {
        settlementBankAccountKey = '';
      }
    }
    if (mode === 'settlement' && !settlementBankAccountKey) {
      settlementBankAccountKey = resolveDefaultSettlementBank(valid, accMap, accountKey);
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

/**
 * Mongoose subdocuments don't copy schema paths via object spread (`{...row}`),
 * so always read fields explicitly (or toObject) before syncing the payment map.
 */
function plainPaymentMapRow(row) {
  if (!row || typeof row !== 'object') return null;
  const src = typeof row.toObject === 'function' ? row.toObject() : row;
  const method = normalizeKey(src.method);
  if (!method) return null;
  return {
    method,
    accountKey: normalizeKey(src.accountKey),
    mode: String(src.mode || '')
      .trim()
      .toLowerCase(),
    settlementBankAccountKey: normalizeKey(src.settlementBankAccountKey),
  };
}

/** Catalog effectMode wins: settlement methods always post to a hidden home with the same key. */
export function syncPaymentMapWithCatalog(mapRows, catalog, validAccountKeys, accounts) {
  const byMethod = new Map();
  for (const row of mapRows || []) {
    const plain = plainPaymentMapRow(row);
    if (plain) byMethod.set(plain.method, plain);
  }
  for (const row of catalog || []) {
    const method = normalizeKey(row?.key);
    if (!method || method === 'credit' || method === 'mixed') continue;
    const prev = byMethod.get(method);
    if (row.effectMode === 'settlement') {
      byMethod.set(method, {
        method,
        accountKey: method,
        mode: 'settlement',
        settlementBankAccountKey:
          prev?.settlementBankAccountKey || DEFAULT_SETTLEMENT_BANK_KEY,
      });
    } else if (row.effectMode === 'none') {
      byMethod.delete(method);
    } else if (row.effectMode === 'instant' && prev?.mode === 'settlement') {
      byMethod.set(method, {
        method,
        accountKey: method === 'cash' ? 'cash' : prev.accountKey === method ? '' : prev.accountKey || '',
        mode: 'instant',
        settlementBankAccountKey: '',
      });
    }
  }
  return normalizePaymentMethodAccountMap([...byMethod.values()], validAccountKeys, accounts);
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
  const {
    normalizePaymentMethodsCatalog,
    mergeMoneyAccountsFromCatalog,
  } = await import('./paymentMethodsCatalog.js');

  const doc = await StoreSettings.findOne()
    .sort({ updatedAt: -1 })
    .select(
      'purchaseTreasuryMethods moneyAccounts paymentMethodAccountMap paymentMethodsCatalog paymentAppFeePercents'
    )
    .lean();

  const catalog = normalizePaymentMethodsCatalog({
    paymentMethodsCatalog: doc?.paymentMethodsCatalog,
    paymentAppFeePercents: doc?.paymentAppFeePercents,
    purchaseTreasuryMethods: doc?.purchaseTreasuryMethods,
  });

  let moneyAccounts = normalizeMoneyAccounts({
    purchaseTreasuryMethods: doc?.purchaseTreasuryMethods,
    moneyAccounts: doc?.moneyAccounts,
  });
  moneyAccounts = normalizeMoneyAccounts({
    purchaseTreasuryMethods: moneyAccountsToPurchaseTreasuries(moneyAccounts),
    moneyAccounts: mergeMoneyAccountsFromCatalog(moneyAccounts, catalog),
  });

  const keys = new Set(moneyAccounts.map((a) => a.key));
  const paymentMethodAccountMap = syncPaymentMapWithCatalog(
    doc?.paymentMethodAccountMap,
    catalog,
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
