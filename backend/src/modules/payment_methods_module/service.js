import {
  getOrCreateStoreSettings,
  patchStoreSettings,
} from '../settings_module/storeSettingsDoc.js';
import {
  moneyAccountsToPurchaseTreasuries,
  normalizeMoneyAccounts,
  syncPaymentMapWithCatalog,
  DEFAULT_SETTLEMENT_BANK_KEY,
} from '../settings_module/moneyAccounts.js';
import {
  catalogToPaymentAppFeePercents,
  mergeMoneyAccountsFromCatalog,
  normalizePaymentMethodsCatalog,
} from '../settings_module/paymentMethodsCatalog.js';
import { allocateKey, isValidKey } from '../settings_module/allocateKey.js';

function catalogFrom(doc) {
  return normalizePaymentMethodsCatalog({
    paymentMethodsCatalog: doc?.paymentMethodsCatalog,
    paymentAppFeePercents: doc?.paymentAppFeePercents,
    purchaseTreasuryMethods: doc?.purchaseTreasuryMethods,
  });
}

function accountsFrom(doc, catalog) {
  let accounts = normalizeMoneyAccounts({
    purchaseTreasuryMethods: doc?.purchaseTreasuryMethods,
    moneyAccounts: doc?.moneyAccounts,
  });
  return normalizeMoneyAccounts({
    purchaseTreasuryMethods: moneyAccountsToPurchaseTreasuries(accounts),
    moneyAccounts: mergeMoneyAccountsFromCatalog(accounts, catalog || catalogFrom(doc)),
  });
}

function mapFrom(doc, accounts, catalog) {
  return syncPaymentMapWithCatalog(
    doc?.paymentMethodAccountMap,
    catalog,
    new Set((accounts || []).map((a) => a.key)),
    accounts
  );
}

function serializeMethod(row, mapRow, accountsByKey) {
  const accountKey =
    row.key === 'cash' ? 'cash' : mapRow?.accountKey || '';
  const acc = accountKey ? accountsByKey.get(accountKey) : null;
  return {
    key: row.key,
    label: row.label,
    showIn: row.showIn,
    effectMode: row.effectMode,
    feePercent: row.feePercent || 0,
    accountKey,
    settlementBankAccountKey: mapRow?.settlementBankAccountKey || '',
    linkedAccount: acc
      ? {
          key: acc.key,
          label: acc.label,
          kind: acc.kind,
          channel: acc.channel || '',
        }
      : null,
  };
}

function serializeList(doc) {
  const catalog = catalogFrom(doc);
  const accounts = accountsFrom(doc, catalog);
  const map = mapFrom(doc, accounts, catalog);
  const mapByMethod = new Map(map.map((r) => [r.method, r]));
  const accountsByKey = new Map(accounts.map((a) => [a.key, a]));
  return catalog.map((row) => serializeMethod(row, mapByMethod.get(row.key), accountsByKey));
}

function isSpendableAccount(accounts, key) {
  const acc = (accounts || []).find((a) => a.key === key);
  return acc && (acc.kind === 'cash' || acc.kind === 'treasury');
}

function isSettlementAccount(accounts, key) {
  const acc = (accounts || []).find((a) => a.key === key);
  return !!(acc && acc.kind === 'settlement');
}

function buildMapRow(method, effectMode, accountKey, settlementBankAccountKey, accounts) {
  if (method === 'credit' || effectMode === 'none') return null;
  const mode = effectMode === 'settlement' ? 'settlement' : 'instant';
  const validKeys = new Set((accounts || []).map((a) => a.key));
  let acc =
    method === 'cash' ? 'cash' : String(accountKey || '').trim().toLowerCase();
  if (mode === 'settlement') {
    if (!isSettlementAccount(accounts, acc)) return null;
  } else {
    if (!acc) return null;
    if (validKeys.size && !validKeys.has(acc)) {
      if (method === 'cash') acc = 'cash';
      else return null;
    }
  }
  let bank = mode === 'settlement' ? String(settlementBankAccountKey || '').trim().toLowerCase() : '';
  if (bank && (!isSpendableAccount(accounts, bank) || bank === acc)) bank = '';
  if (mode === 'settlement' && !bank) {
    const preferred = DEFAULT_SETTLEMENT_BANK_KEY;
    if (preferred && preferred !== acc && isSpendableAccount(accounts, preferred)) {
      bank = preferred;
    }
  }
  return {
    method,
    accountKey: acc,
    mode,
    settlementBankAccountKey: bank,
  };
}

async function persistCatalogAndMap(doc, catalog, mapRows, accounts) {
  let nextAccounts = mergeMoneyAccountsFromCatalog(accounts, catalog);
  nextAccounts = normalizeMoneyAccounts({
    purchaseTreasuryMethods: moneyAccountsToPurchaseTreasuries(nextAccounts),
    moneyAccounts: nextAccounts,
  });
  const keys = new Set(nextAccounts.map((a) => a.key));
  const map = syncPaymentMapWithCatalog(mapRows, catalog, keys, nextAccounts);
  const fees = catalogToPaymentAppFeePercents(catalog);
  return patchStoreSettings(doc, {
    paymentMethodsCatalog: catalog,
    paymentMethodAccountMap: map,
    paymentAppFeePercents: fees,
    moneyAccounts: nextAccounts,
    purchaseTreasuryMethods: moneyAccountsToPurchaseTreasuries(nextAccounts),
  });
}

export const listPaymentMethods = async (req, res) => {
  try {
    let doc = await getOrCreateStoreSettings();
    const catalog = catalogFrom(doc);
    const accounts = accountsFrom(doc, catalog);
    const map = mapFrom(doc, accounts, catalog);
    const prevRaw = Array.isArray(doc.paymentMethodAccountMap) ? doc.paymentMethodAccountMap : [];
    const needsPersist = map.some((row) => {
      if (row.mode !== 'settlement' || !row.settlementBankAccountKey) return false;
      const prev = prevRaw.find((r) => String(r?.method || '').toLowerCase() === row.method);
      return !prev?.settlementBankAccountKey;
    });
    if (needsPersist) {
      doc = await patchStoreSettings(doc, { paymentMethodAccountMap: map });
    }
    res.status(200).json({ paymentMethods: serializeList(doc) });
  } catch (error) {
    console.error('listPaymentMethods:', error);
    res.status(500).json({ error: 'Failed to list payment methods' });
  }
};

export const createPaymentMethod = async (req, res) => {
  try {
    const label = String(req.body?.label || '').trim().slice(0, 120);
    if (!label) return res.status(400).json({ error: 'label is required' });

    const doc = await getOrCreateStoreSettings();
    const catalog = catalogFrom(doc);
    const accounts = accountsFrom(doc, catalog);
    const map = mapFrom(doc, accounts, catalog);
    const used = new Set(catalog.map((r) => r.key));
    const key = allocateKey(label, used);

    let showIn = String(req.body?.showIn || 'sale').trim().toLowerCase();
    if (showIn !== 'sale' && showIn !== 'purchase' && showIn !== 'both') showIn = 'sale';
    let effectMode = String(req.body?.effectMode || 'instant').trim().toLowerCase();
    if (effectMode !== 'instant' && effectMode !== 'settlement' && effectMode !== 'none') {
      effectMode = 'instant';
    }
    let feePercent = Number(req.body?.feePercent);
    if (!Number.isFinite(feePercent)) feePercent = 0;
    feePercent = Math.max(0, Math.min(100, feePercent));
    if (effectMode === 'none') feePercent = 0;

    const created = { key, label, showIn, effectMode, feePercent };
    catalog.push(created);

    const mapRow = buildMapRow(
      key,
      effectMode,
      req.body?.accountKey,
      req.body?.settlementBankAccountKey,
      accounts
    );
    const nextMap = map.filter((r) => r.method !== key);
    if (mapRow) nextMap.push(mapRow);

    const saved = await persistCatalogAndMap(doc, catalog, nextMap, accounts);
    const list = serializeList(saved);
    res.status(201).json({ paymentMethod: list.find((r) => r.key === key) });
  } catch (error) {
    console.error('createPaymentMethod:', error);
    res.status(500).json({ error: 'Failed to create payment method' });
  }
};

export const updatePaymentMethod = async (req, res) => {
  try {
    const key = String(req.params.key || '')
      .trim()
      .toLowerCase();
    if (!isValidKey(key)) return res.status(400).json({ error: 'Invalid payment method key' });

    const doc = await getOrCreateStoreSettings();
    const catalog = catalogFrom(doc);
    const idx = catalog.findIndex((r) => r.key === key);
    if (idx < 0) return res.status(404).json({ error: 'Payment method not found' });

    const prev = catalog[idx];
    const label =
      req.body?.label !== undefined
        ? String(req.body.label || '').trim().slice(0, 120)
        : prev.label;
    if (!label) return res.status(400).json({ error: 'label is required' });

    let showIn = req.body?.showIn !== undefined
      ? String(req.body.showIn || '').trim().toLowerCase()
      : prev.showIn;
    if (showIn !== 'sale' && showIn !== 'purchase' && showIn !== 'both') showIn = prev.showIn || 'sale';

    let effectMode = req.body?.effectMode !== undefined
      ? String(req.body.effectMode || '').trim().toLowerCase()
      : prev.effectMode;
    if (key === 'cash') effectMode = 'instant';
    else if (key === 'credit') effectMode = 'none';
    else if (effectMode !== 'instant' && effectMode !== 'settlement' && effectMode !== 'none') {
      effectMode = prev.effectMode || 'instant';
    }

    let feePercent = req.body?.feePercent !== undefined ? Number(req.body.feePercent) : prev.feePercent;
    if (!Number.isFinite(feePercent)) feePercent = 0;
    feePercent = Math.max(0, Math.min(100, feePercent));
    if (key === 'cash') feePercent = 0;
    else if (key !== 'credit' && effectMode === 'none') feePercent = 0;

    catalog[idx] = { key, label, showIn, effectMode, feePercent };

    const accounts = accountsFrom(doc, catalog);
    const map = mapFrom(doc, accounts, catalog);
    const nextMap = map.filter((r) => r.method !== key);
    const mapRow = buildMapRow(
      key,
      effectMode,
      req.body?.accountKey !== undefined ? req.body.accountKey : map.find((r) => r.method === key)?.accountKey,
      req.body?.settlementBankAccountKey !== undefined
        ? req.body.settlementBankAccountKey
        : map.find((r) => r.method === key)?.settlementBankAccountKey,
      accounts
    );
    if (mapRow) nextMap.push(mapRow);

    const saved = await persistCatalogAndMap(doc, catalog, nextMap, accounts);
    const list = serializeList(saved);
    res.status(200).json({ paymentMethod: list.find((r) => r.key === key) });
  } catch (error) {
    console.error('updatePaymentMethod:', error);
    res.status(500).json({ error: 'Failed to update payment method' });
  }
};

export const deletePaymentMethod = async (req, res) => {
  try {
    const key = String(req.params.key || '')
      .trim()
      .toLowerCase();
    if (!isValidKey(key)) return res.status(400).json({ error: 'Invalid payment method key' });
    if (key === 'cash' || key === 'credit') {
      return res.status(400).json({ error: 'Cash and credit methods cannot be deleted' });
    }

    const doc = await getOrCreateStoreSettings();
    const catalog = catalogFrom(doc);
    if (!catalog.some((r) => r.key === key)) {
      return res.status(404).json({ error: 'Payment method not found' });
    }
    const nextCatalog = catalog.filter((r) => r.key !== key);
    const accounts = accountsFrom(doc, catalog);
    const map = mapFrom(doc, accounts, catalog).filter((r) => r.method !== key);
    await persistCatalogAndMap(doc, nextCatalog, map, accounts);
    res.status(200).json({ deleted: true, key });
  } catch (error) {
    console.error('deletePaymentMethod:', error);
    res.status(500).json({ error: 'Failed to delete payment method' });
  }
};
