import mongoose from 'mongoose';
import Branch from '../../DB/models/branch.model.js';
import {
  getOrCreateStoreSettings,
  patchStoreSettings,
} from '../settings_module/storeSettingsDoc.js';
import {
  isAvailableForBranch,
  moneyAccountAlwaysAllBranches,
  moneyAccountsToPurchaseTreasuries,
  normalizeBranchIds,
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
  return list.filter((a) => a.kind === 'cash' || a.kind === 'treasury' || a.kind === 'vault');
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
    branchIds: Array.isArray(a.branchIds) ? a.branchIds.map((id) => String(id)) : [],
  };
}

function parseChannel(kind, key, raw) {
  if (key === 'cash' || kind === 'cash' || kind === 'settlement' || kind === 'vault') return '';
  const c = String(raw || '')
    .trim()
    .toLowerCase();
  return c === 'wallet' ? 'wallet' : 'bank';
}

function parseCreateKind(raw) {
  const k = String(raw || '')
    .trim()
    .toLowerCase();
  if (k === 'settlement') return 'settlement';
  if (k === 'vault') return 'vault';
  return 'treasury';
}

async function resolveBranchIdsForAccount(kind, key, raw, { requireNonEmpty = false } = {}) {
  if (moneyAccountAlwaysAllBranches(kind, key)) {
    return { branchIds: [] };
  }
  const branchIds = normalizeBranchIds(raw);
  if (requireNonEmpty && !branchIds.length) {
    return { error: 'Select at least one branch for this account' };
  }
  if (!branchIds.length) {
    return { branchIds: [] };
  }
  const count = await Branch.countDocuments({
    _id: { $in: branchIds.map((id) => new mongoose.Types.ObjectId(id)) },
  });
  if (count !== branchIds.length) {
    return { error: 'One or more branches are invalid' };
  }
  return { branchIds };
}

async function persistAccounts(doc, accounts) {
  const catalog = normalizePaymentMethodsCatalog({
    paymentMethodsCatalog: doc?.paymentMethodsCatalog,
    paymentAppFeePercents: doc?.paymentAppFeePercents,
    purchaseTreasuryMethods: doc?.purchaseTreasuryMethods,
  });
  let next = mergeMoneyAccountsFromCatalog(accounts, catalog, doc?.paymentMethodAccountMap);
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
    const branch = String(req.query.branch || '').trim();
    let accounts = publicAccounts(allAccounts(doc), includeSettlement);
    if (branch && mongoose.Types.ObjectId.isValid(branch)) {
      accounts = accounts.filter((a) =>
        isAvailableForBranch(a.branchIds, branch, {
          alwaysAll: moneyAccountAlwaysAllBranches(a.kind, a.key),
        })
      );
    }
    res.status(200).json({ accounts: accounts.map(serializeAccount) });
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
    const kind = parseCreateKind(req.body?.kind);
    const channel = parseChannel(kind, key, req.body?.channel);
    const branchResolved = await resolveBranchIdsForAccount(kind, key, req.body?.branchIds, {
      requireNonEmpty: !moneyAccountAlwaysAllBranches(kind, key),
    });
    if (branchResolved.error) {
      return res.status(400).json({ error: branchResolved.error });
    }
    const created = {
      key,
      label,
      kind,
      channel,
      accountNumber:
        kind === 'treasury' && channel === 'bank'
          ? String(req.body?.accountNumber || '').trim().slice(0, 80)
          : '',
      phone:
        kind === 'treasury' && channel === 'wallet'
          ? String(req.body?.phone || '').trim().slice(0, 40)
          : '',
      enabled: req.body?.enabled !== false && req.body?.enabled !== 'false',
      branchIds: branchResolved.branchIds,
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
      accounts[idx] = {
        ...prev,
        label,
        kind: 'cash',
        channel: '',
        accountNumber: '',
        phone: '',
        enabled: true,
        branchIds: [],
      };
    } else if (prev.kind === 'settlement') {
      let enabled = prev.enabled !== false;
      if (req.body?.enabled !== undefined) {
        enabled = req.body.enabled !== false && req.body.enabled !== 'false' && req.body.enabled !== 0;
      }
      accounts[idx] = {
        ...prev,
        label,
        kind: 'settlement',
        channel: '',
        accountNumber: '',
        phone: '',
        enabled,
        branchIds: [],
      };
    } else if (prev.kind === 'vault') {
      let enabled = prev.enabled !== false;
      if (req.body?.enabled !== undefined) {
        enabled = req.body.enabled !== false && req.body.enabled !== 'false' && req.body.enabled !== 0;
      }
      let branchIds = prev.branchIds || [];
      if (req.body?.branchIds !== undefined) {
        const branchResolved = await resolveBranchIdsForAccount('vault', key, req.body.branchIds, {
          requireNonEmpty: true,
        });
        if (branchResolved.error) {
          return res.status(400).json({ error: branchResolved.error });
        }
        branchIds = branchResolved.branchIds;
      }
      accounts[idx] = {
        ...prev,
        label,
        kind: 'vault',
        channel: '',
        accountNumber: '',
        phone: '',
        enabled,
        branchIds,
      };
    } else {
      const channel = parseChannel(prev.kind, key, req.body?.channel ?? prev.channel);
      let enabled = prev.enabled !== false;
      if (req.body?.enabled !== undefined) {
        enabled = req.body.enabled !== false && req.body.enabled !== 'false' && req.body.enabled !== 0;
      }
      let branchIds = prev.branchIds || [];
      if (req.body?.branchIds !== undefined) {
        const branchResolved = await resolveBranchIdsForAccount('treasury', key, req.body.branchIds, {
          requireNonEmpty: true,
        });
        if (branchResolved.error) {
          return res.status(400).json({ error: branchResolved.error });
        }
        branchIds = branchResolved.branchIds;
      }
      accounts[idx] = {
        ...prev,
        label,
        kind: 'treasury',
        channel,
        accountNumber:
          channel === 'bank'
            ? String(req.body?.accountNumber ?? prev.accountNumber ?? '').trim().slice(0, 80)
            : '',
        phone:
          channel === 'wallet'
            ? String(req.body?.phone ?? prev.phone ?? '').trim().slice(0, 40)
            : '',
        enabled,
        branchIds,
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
