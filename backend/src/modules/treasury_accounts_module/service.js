import mongoose from 'mongoose';
import moment from 'moment-timezone';
import User from '../../DB/models/user.model.js';
import Branch from '../../DB/models/branch.model.js';
import TreasuryLedgerEntry from '../../DB/models/treasuryLedgerEntry.model.js';
import TreasuryAccountOpening from '../../DB/models/treasuryAccountOpening.model.js';
import { getEffectiveMoneyAccountsFromDb } from '../settings_module/moneyAccounts.js';
import {
  computeAccountExpectedBalance,
  recordTreasuryTransfer,
  round2,
  businessDateStr,
} from '../../utils/treasury-ledger.js';

const ADMIN_ROLES = ['Super Admin', 'Co Admin'];
const BUSINESS_TZ = 'Africa/Cairo';

async function loadActor(userId) {
  if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) return null;
  return User.findById(userId).select('role branch name').lean();
}

function canViewTreasury(actor) {
  if (!actor) return false;
  return (
    ADMIN_ROLES.includes(actor.role) ||
    actor.role === 'Branch Manager' ||
    actor.role === 'Cashier'
  );
}

function canSetOpening(actor) {
  if (!actor) return false;
  return ADMIN_ROLES.includes(actor.role) || actor.role === 'Branch Manager';
}

function actorMayUseBranch(actor, branchIdStr) {
  if (!actor || !branchIdStr) return false;
  if (ADMIN_ROLES.includes(actor.role)) return true;
  if (!actor.branch) return false;
  return String(actor.branch) === String(branchIdStr);
}

async function resolveBranchParam(actor, branchRaw) {
  const explicit = String(branchRaw || '').trim();
  if (explicit && mongoose.Types.ObjectId.isValid(explicit)) {
    if (!actorMayUseBranch(actor, explicit)) return { error: 'Cannot access this branch' };
    const exists = await Branch.findById(explicit).select('_id').lean();
    if (!exists) return { error: 'Branch not found' };
    return { branchId: new mongoose.Types.ObjectId(explicit) };
  }
  if (!ADMIN_ROLES.includes(actor.role) && actor.branch) {
    return { branchId: new mongoose.Types.ObjectId(String(actor.branch)) };
  }
  return { error: 'Valid branch is required' };
}

export const listTreasuryAccounts = async (req, res) => {
  try {
    const userId = req.query.userId || req.body?.userId;
    const actor = await loadActor(userId);
    if (!canViewTreasury(actor)) {
      return res.status(403).json({ error: 'Not allowed' });
    }
    const resolved = await resolveBranchParam(actor, req.query.branch);
    if (resolved.error) return res.status(400).json({ error: resolved.error });

    const until = String(req.query.until || '').trim() || undefined;
    if (until && !/^\d{4}-\d{2}-\d{2}$/.test(until)) {
      return res.status(400).json({ error: 'until must be YYYY-MM-DD' });
    }

    const { moneyAccounts } = await getEffectiveMoneyAccountsFromDb();
    const accounts = [];
    for (const acc of moneyAccounts) {
      const bal = await computeAccountExpectedBalance(resolved.branchId, acc.key, until);
      const last = await TreasuryLedgerEntry.findOne({
        branch: resolved.branchId,
        accountKey: acc.key,
      })
        .sort({ occurredAt: -1 })
        .select('occurredAt direction amount sourceType')
        .lean();
      accounts.push({
        key: acc.key,
        label: acc.label,
        kind: acc.kind,
        ...bal,
        lastMovement: last
          ? {
              occurredAt: last.occurredAt,
              direction: last.direction,
              amount: last.amount,
              sourceType: last.sourceType,
            }
          : null,
      });
    }

    res.status(200).json({
      branch: String(resolved.branchId),
      until: until || businessDateStr(),
      accounts,
    });
  } catch (error) {
    console.error('listTreasuryAccounts:', error);
    res.status(500).json({ error: 'Failed to list treasury accounts' });
  }
};

export const getTreasuryAccount = async (req, res) => {
  try {
    const userId = req.query.userId || req.body?.userId;
    const actor = await loadActor(userId);
    if (!canViewTreasury(actor)) {
      return res.status(403).json({ error: 'Not allowed' });
    }
    const resolved = await resolveBranchParam(actor, req.query.branch);
    if (resolved.error) return res.status(400).json({ error: resolved.error });

    const key = String(req.params.key || '')
      .trim()
      .toLowerCase();
    const { moneyAccounts } = await getEffectiveMoneyAccountsFromDb();
    const acc = moneyAccounts.find((a) => a.key === key);
    if (!acc) return res.status(404).json({ error: 'Account not found' });

    const until = String(req.query.until || '').trim() || undefined;
    const bal = await computeAccountExpectedBalance(resolved.branchId, key, until);

    res.status(200).json({
      branch: String(resolved.branchId),
      account: acc,
      ...bal,
    });
  } catch (error) {
    console.error('getTreasuryAccount:', error);
    res.status(500).json({ error: 'Failed to load account' });
  }
};

export const listAccountLedger = async (req, res) => {
  try {
    const userId = req.query.userId || req.body?.userId;
    const actor = await loadActor(userId);
    if (!canViewTreasury(actor)) {
      return res.status(403).json({ error: 'Not allowed' });
    }
    const resolved = await resolveBranchParam(actor, req.query.branch);
    if (resolved.error) return res.status(400).json({ error: resolved.error });

    const key = String(req.params.key || '')
      .trim()
      .toLowerCase();
    const { moneyAccounts } = await getEffectiveMoneyAccountsFromDb();
    if (!moneyAccounts.some((a) => a.key === key)) {
      return res.status(404).json({ error: 'Account not found' });
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 30));
    const skip = (page - 1) * limit;

    const match = {
      branch: resolved.branchId,
      accountKey: key,
    };
    const from = String(req.query.from || '').trim();
    const to = String(req.query.to || '').trim();
    if (from || to) {
      match.occurredAt = {};
      if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) {
        match.occurredAt.$gte = moment.tz(from, 'YYYY-MM-DD', BUSINESS_TZ).startOf('day').utc().toDate();
      }
      if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
        match.occurredAt.$lte = moment.tz(to, 'YYYY-MM-DD', BUSINESS_TZ).endOf('day').utc().toDate();
      }
    }

    const [total, rows] = await Promise.all([
      TreasuryLedgerEntry.countDocuments(match),
      TreasuryLedgerEntry.find(match)
        .sort({ occurredAt: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('createdBy', 'name')
        .lean(),
    ]);

    res.status(200).json({
      branch: String(resolved.branchId),
      accountKey: key,
      page,
      limit,
      total,
      entries: rows,
    });
  } catch (error) {
    console.error('listAccountLedger:', error);
    res.status(500).json({ error: 'Failed to load ledger' });
  }
};

export const createTreasuryTransfer = async (req, res) => {
  try {
    const {
      userId,
      branch,
      fromAccountKey,
      toAccountKey,
      amount,
      note,
      isSettlement,
    } = req.body || {};

    const actor = await loadActor(userId);
    if (!canViewTreasury(actor)) {
      return res.status(403).json({ error: 'Not allowed' });
    }
    const resolved = await resolveBranchParam(actor, branch);
    if (resolved.error) return res.status(400).json({ error: resolved.error });

    const result = await recordTreasuryTransfer({
      branchId: resolved.branchId,
      fromAccountKey,
      toAccountKey,
      amount,
      sourceType: isSettlement ? 'settlement' : 'transfer',
      note: String(note || '').trim().slice(0, 2000),
      createdBy: userId,
    });

    if (result.error) {
      return res.status(400).json({ error: result.error });
    }

    res.status(201).json({
      transferGroupId: result.transferGroupId,
      fromAccountKey: String(fromAccountKey).trim().toLowerCase(),
      toAccountKey: String(toAccountKey).trim().toLowerCase(),
      amount: round2(amount),
      outEntryId: result.outEntry?._id,
      inEntryId: result.inEntry?._id,
    });
  } catch (error) {
    console.error('createTreasuryTransfer:', error);
    res.status(500).json({ error: 'Failed to create transfer' });
  }
};

export const setAccountOpeningBalance = async (req, res) => {
  try {
    const { userId, branch, amount, note } = req.body || {};
    const actor = await loadActor(userId);
    if (!canSetOpening(actor)) {
      return res.status(403).json({ error: 'Not allowed to set opening balance' });
    }
    const resolved = await resolveBranchParam(actor, branch);
    if (resolved.error) return res.status(400).json({ error: resolved.error });

    const key = String(req.params.key || '')
      .trim()
      .toLowerCase();
    const { moneyAccounts } = await getEffectiveMoneyAccountsFromDb();
    if (!moneyAccounts.some((a) => a.key === key)) {
      return res.status(404).json({ error: 'Account not found' });
    }

    const amt = round2(amount);
    if (!Number.isFinite(amt)) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    const doc = await TreasuryAccountOpening.findOneAndUpdate(
      { branch: resolved.branchId, accountKey: key },
      {
        $set: {
          amount: amt,
          note: String(note || '').trim().slice(0, 500),
          setBy: userId,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const bal = await computeAccountExpectedBalance(resolved.branchId, key);

    res.status(200).json({
      accountKey: key,
      openingBalance: doc.amount,
      expectedBalance: bal.expectedBalance,
    });
  } catch (error) {
    console.error('setAccountOpeningBalance:', error);
    res.status(500).json({ error: 'Failed to set opening balance' });
  }
};
