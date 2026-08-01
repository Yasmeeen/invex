import mongoose from 'mongoose';
import DailyExpense from '../../DB/models/dailyExpense.model.js';
import User from '../../DB/models/user.model.js';
import Branch from '../../DB/models/branch.model.js';
import {
  getEffectivePurchaseTreasuryMethodsFromDb,
  treasuryMethodMap,
} from '../settings_module/treasuryMethods.js';
import { normalizeTreasurySplitsInput } from '../../utils/purchase-treasury-splits.js';
import { postTreasurySplitOutflows, safeTreasuryPost } from '../../utils/treasury-ledger.js';
import { dailyExpenseCategoryMatch } from '../../utils/daily-expense-categories.js';

const ADMIN_ROLES = ['Super Admin', 'Co Admin'];

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

async function loadActor(userId) {
  if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) return null;
  return User.findById(userId).select('role branch name').lean();
}

/** Cashier + admins + branch manager may record desk expenses (matches cashier route roles). */
function canCreateExpense(actor) {
  if (!actor) return false;
  const r = actor.role;
  return (
    ADMIN_ROLES.includes(r) ||
    r === 'Branch Manager' ||
    r === 'Cashier'
  );
}

function actorMayUseBranch(actor, branchIdStr) {
  if (!actor || !branchIdStr) return false;
  if (ADMIN_ROLES.includes(actor.role)) return true;
  if (!actor.branch) return false;
  return String(actor.branch) === String(branchIdStr);
}

/** List expenses: Super Admin / Co Admin (optional branch filter); Branch Manager — own branch only. */
function canListExpenses(actor) {
  if (!actor) return false;
  return ADMIN_ROLES.includes(actor.role) || actor.role === 'Branch Manager';
}

export const createDailyExpense = async (req, res) => {
  try {
    const {
      branch,
      amount: amountRaw,
      expenseType,
      notes,
      userId,
      expenseTreasurySplits: splitsRaw,
      expenseTreasuryKey: treasuryKeyRaw,
    } = req.body || {};

    const actor = await loadActor(userId);
    if (!canCreateExpense(actor)) {
      return res.status(403).json({ error: 'Not allowed to record expenses' });
    }

    if (!branch || !mongoose.Types.ObjectId.isValid(String(branch))) {
      return res.status(400).json({ error: 'Valid branch is required' });
    }

    if (!actorMayUseBranch(actor, String(branch))) {
      return res.status(403).json({ error: 'Cannot record expense for this branch' });
    }

    const typeTrim = String(expenseType || '').trim();
    if (!typeTrim) {
      return res.status(400).json({ error: 'Expense type is required' });
    }

    const treasuryMethods = await getEffectivePurchaseTreasuryMethodsFromDb();
    const tMap = treasuryMethodMap(treasuryMethods);

    let lineTotal = round2(amountRaw);
    if (Array.isArray(splitsRaw) && splitsRaw.length) {
      lineTotal = round2(
        splitsRaw.reduce((acc, row) => acc + (Number(row?.amount) || 0), 0)
      );
    }
    if (!Number.isFinite(lineTotal) || lineTotal <= 0) {
      return res.status(400).json({ error: 'Amount must be greater than zero' });
    }

    const treasuryNorm = normalizeTreasurySplitsInput({
      purchaseTreasurySplits: splitsRaw,
      purchaseTreasuryKey: treasuryKeyRaw,
      lineTotal,
      treasuryMethods,
      tMap,
    });
    if (treasuryNorm.error) {
      return res.status(400).json({ error: treasuryNorm.error });
    }

    const {
      splits: expenseTreasurySplits,
      treasuryKey: expenseTreasuryKey,
      treasuryLabel: expenseTreasuryLabel,
    } = treasuryNorm;

    const branchDoc = await Branch.findById(branch).select('_id').lean();
    if (!branchDoc) {
      return res.status(400).json({ error: 'Branch not found' });
    }

    const doc = await DailyExpense.create({
      branch,
      amount: lineTotal,
      expenseType: typeTrim,
      notes: String(notes || '').trim().slice(0, 2000),
      recordedBy: userId,
      expenseTreasuryKey,
      expenseTreasuryLabel,
      expenseTreasurySplits,
    });

    await safeTreasuryPost('daily_expense', async () => {
      await postTreasurySplitOutflows({
        branchId: branch,
        splits: expenseTreasurySplits,
        sourceType: 'daily_expense',
        sourceId: doc._id,
        note: typeTrim,
        createdBy: userId,
      });
    });

    const populated = await DailyExpense.findById(doc._id)
      .populate('branch', 'name')
      .populate('recordedBy', 'name email role')
      .lean();

    res.status(201).json(populated);
  } catch (err) {
    console.error('❌ createDailyExpense:', err.message);
    res.status(500).json({ error: 'Failed to record expense' });
  }
};

export const listDailyExpenses = async (req, res) => {
  try {
    const {
      viewerUserId,
      page = 1,
      limit = 20,
      branch_id: branchIdRaw,
      dateFrom,
      dateTo,
      category: categoryRaw,
    } = req.query;

    if (!viewerUserId || !mongoose.Types.ObjectId.isValid(String(viewerUserId))) {
      return res.status(400).json({ error: 'viewerUserId is required' });
    }

    const viewer = await User.findById(viewerUserId).select('role branch').lean();
    if (!canListExpenses(viewer)) {
      return res.status(403).json({ error: 'Not allowed to view expenses' });
    }

    const query = {
      ...dailyExpenseCategoryMatch(categoryRaw),
    };

    if (ADMIN_ROLES.includes(viewer.role)) {
      if (branchIdRaw && mongoose.Types.ObjectId.isValid(String(branchIdRaw))) {
        query.branch = new mongoose.Types.ObjectId(String(branchIdRaw));
      }
    } else if (viewer.role === 'Branch Manager' && viewer.branch) {
      query.branch = viewer.branch;
    } else {
      return res.status(403).json({ error: 'Not allowed to view expenses' });
    }

    if (dateFrom || dateTo) {
      const range = {};
      if (dateFrom) {
        const d = new Date(String(dateFrom));
        if (!Number.isNaN(d.getTime())) {
          d.setHours(0, 0, 0, 0);
          range.$gte = d;
        }
      }
      if (dateTo) {
        const d = new Date(String(dateTo));
        if (!Number.isNaN(d.getTime())) {
          d.setHours(23, 59, 59, 999);
          range.$lte = d;
        }
      }
      if (Object.keys(range).length) {
        query.createdAt = range;
      }
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [rows, total, sumRows] = await Promise.all([
      DailyExpense.find(query)
        .populate('branch', 'name')
        .populate('recordedBy', 'name email role')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      DailyExpense.countDocuments(query),
      DailyExpense.aggregate([
        { $match: query },
        { $group: { _id: null, totalAmount: { $sum: '$amount' } } },
      ]),
    ]);

    const totalPages = Math.ceil(total / Number(limit)) || 1;
    const totalAmount = round2(sumRows?.[0]?.totalAmount ?? 0);

    res.json({
      expenses: rows,
      meta: {
        currentPage: Number(page),
        totalCount: total,
        totalAmount,
        totalPages,
        nextPage: Number(page) < totalPages ? Number(page) + 1 : null,
        prevPage: Number(page) > 1 ? Number(page) - 1 : null,
      },
    });
  } catch (err) {
    console.error('❌ listDailyExpenses:', err.message);
    res.status(500).json({ error: 'Failed to list expenses' });
  }
};
