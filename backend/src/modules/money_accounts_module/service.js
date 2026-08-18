import {
  getOrCreateStoreSettings,
  patchStoreSettings,
} from '../settings_module/storeSettingsDoc.js';
import {
  moneyAccountsToPurchaseTreasuries,
  normalizeMoneyAccounts,
  syncPaymentMapWithCatalog,
} from '../settings_module/moneyAccounts.js';
import {
  mergeMoneyAccountsFromCatalog,
  normalizePaymentMethodsCatalog,
} from '../settings_module/paymentMethodsCatalog.js';
import { allocateKey, isValidKey } from '../settings_module/allocateKey.js';

function allAccounts(doc) {
  return normalizeMoneyAccounts({
    purchaseTreasuryMethods: doc?.purchaseTreasuryMethods,
    moneyAccounts: doc?.moneyAccounts,
  });
}

function publicAccounts(accounts, includeSettlement) {
  const list = Array.isArray(accounts) ? accounts : [];
  if (includeSettlement) return list;
  return list.filter((a) => a.kind === 'cash' || a.kind === 'treasury');
}

function serializeAccount(a) {
  return {
    key: a.key,
    label: a.label,
    kind: a.kind,
    channel: a.channel || '',
    accountNumber: a.accountNumber || '',
    phone: a.phone || '',
    enabled: a.key === 'cash' ? true : a.enabled !== false,
  };
}

function parseChannel(kind, key, raw) {
  if (key === 'cash' || kind === 'cash' || kind === 'settlement') return '';
  const c = String(raw || '')
    .trim()
    .toLowerCase();
  return c === 'wallet' ? 'wallet' : 'bank';
}

async function persistAccounts(doc, accounts) {
  const catalog = normalizePaymentMethodsCatalog({
    paymentMethodsCatalog: doc?.paymentMethodsCatalog,
    paymentAppFeePercents: doc?.paymentAppFeePercents,
    purchaseTreasuryMethods: doc?.purchaseTreasuryMethods,
  });
  let next = mergeMoneyAccountsFromCatalog(accounts, catalog);
  next = normalizeMoneyAccounts({
    purchaseTreasuryMethods: moneyAccountsToPurchaseTreasuries(next),
    moneyAccounts: next,
  });
  const keys = new Set(next.map((a) => a.key));
  const map = syncPaymentMapWithCatalog(doc.paymentMethodAccountMap, catalog, keys, next);
  const saved = await patchStoreSettings(doc, {
    moneyAccounts: next,
    purchaseTreasuryMethods: moneyAccountsToPurchaseTreasuries(next),
    paymentMethodAccountMap: map,
  });
  return allAccounts(saved);
}

export const listMoneyAccounts = async (req, res) => {
  try {
    const doc = await getOrCreateStoreSettings();
    const includeSettlement =
      String(req.query.includeSettlement || '').toLowerCase() === '1' ||
      String(req.query.includeSettlement || '').toLowerCase() === 'true';
    const accounts = publicAccounts(allAccounts(doc), includeSettlement).map(serializeAccount);
    res.status(200).json({ accounts });
  } catch (error) {
    console.error('listMoneyAccounts:', error);
    res.status(500).json({ error: 'Failed to list money accounts' });
  }
};

export const createMoneyAccount = async (req, res) => {
  try {
    const label = String(req.body?.label || '').trim().slice(0, 120);
    if (!label) return res.status(400).json({ error: 'label is required' });

    const doc = await getOrCreateStoreSettings();
    const accounts = allAccounts(doc);
    const used = new Set(accounts.map((a) => a.key));
    const key = allocateKey(label, used);
    const kind =
      String(req.body?.kind || '')
        .trim()
        .toLowerCase() === 'settlement'
        ? 'settlement'
        : 'treasury';
    const channel = parseChannel(kind, key, req.body?.channel);
    const created = {
      key,
      label,
      kind,
      channel,
      accountNumber:
        kind !== 'settlement' && channel === 'bank'
          ? String(req.body?.accountNumber || '').trim().slice(0, 80)
          : '',
      phone:
        kind !== 'settlement' && channel === 'wallet'
          ? String(req.body?.phone || '').trim().slice(0, 40)
          : '',
      enabled: req.body?.enabled !== false && req.body?.enabled !== 'false',
    };
    const next = [...accounts, created];
    await persistAccounts(doc, next);
    res.status(201).json({ account: serializeAccount(created) });
  } catch (error) {
    console.error('createMoneyAccount:', error);
    res.status(500).json({ error: 'Failed to create money account' });
  }
};

export const updateMoneyAccount = async (req, res) => {
  try {
    const key = String(req.params.key || '')
      .trim()
      .toLowerCase();
    if (!isValidKey(key)) return res.status(400).json({ error: 'Invalid account key' });

    const doc = await getOrCreateStoreSettings();
    const accounts = allAccounts(doc);
    const idx = accounts.findIndex((a) => a.key === key);
    if (idx < 0) return res.status(404).json({ error: 'Account not found' });

    const prev = accounts[idx];
    const label =
      req.body?.label !== undefined
        ? String(req.body.label || '').trim().slice(0, 120)
        : prev.label;
    if (!label) return res.status(400).json({ error: 'label is required' });

    if (key === 'cash' || prev.kind === 'cash') {
      accounts[idx] = { ...prev, label, kind: 'cash', channel: '', accountNumber: '', phone: '', enabled: true };
    } else {
      const channel = parseChannel(prev.kind, key, req.body?.channel ?? prev.channel);
      let enabled = prev.enabled !== false;
      if (req.body?.enabled !== undefined) {
        enabled = req.body.enabled !== false && req.body.enabled !== 'false' && req.body.enabled !== 0;
      }
      accounts[idx] = {
        ...prev,
        label,
        kind: prev.kind === 'settlement' ? 'settlement' : 'treasury',
        channel: prev.kind === 'settlement' ? '' : channel,
        accountNumber:
          prev.kind !== 'settlement' && channel === 'bank'
            ? String(req.body?.accountNumber ?? prev.accountNumber ?? '').trim().slice(0, 80)
            : '',
        phone:
          prev.kind !== 'settlement' && channel === 'wallet'
            ? String(req.body?.phone ?? prev.phone ?? '').trim().slice(0, 40)
            : '',
        enabled: prev.kind === 'settlement' ? enabled : enabled,
      };
    }

    const saved = await persistAccounts(doc, accounts);
    const updated = saved.find((a) => a.key === key);
    res.status(200).json({ account: serializeAccount(updated) });
  } catch (error) {
    console.error('updateMoneyAccount:', error);
    res.status(500).json({ error: 'Failed to update money account' });
  }
};

export const deleteMoneyAccount = async (req, res) => {
  try {
    const key = String(req.params.key || '')
      .trim()
      .toLowerCase();
    if (!isValidKey(key)) return res.status(400).json({ error: 'Invalid account key' });
    if (key === 'cash') return res.status(400).json({ error: 'Cash account cannot be deleted' });

    const doc = await getOrCreateStoreSettings();
    const accounts = allAccounts(doc);
    const existing = accounts.find((a) => a.key === key);
    if (!existing) return res.status(404).json({ error: 'Account not found' });
    if (existing.kind === 'cash') {
      return res.status(400).json({ error: 'Cash account cannot be deleted' });
    }

    const next = accounts.filter((a) => a.key !== key);
    await persistAccounts(doc, next);
    res.status(200).json({ deleted: true, key });
  } catch (error) {
    console.error('deleteMoneyAccount:', error);
    res.status(500).json({ error: 'Failed to delete money account' });
  }
};
