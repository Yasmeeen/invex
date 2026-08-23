import mongoose from 'mongoose';
import moment from 'moment-timezone';
import User from '../../DB/models/user.model.js';
import Branch from '../../DB/models/branch.model.js';
import TreasuryLedgerEntry from '../../DB/models/treasuryLedgerEntry.model.js';
import TreasuryAccountOpening from '../../DB/models/treasuryAccountOpening.model.js';
import {
  getEffectiveMoneyAccountsFromDb,
  settlementBankForAccount,
  treasuryLabelByKey,
  prettyTreasuryText,
} from '../settings_module/moneyAccounts.js';
import {
  computeAccountExpectedBalance,
  computeAccountExpectedBalanceAllBranches,
  computeAccountsExpectedBalances,
  computeAccountsExpectedBalancesAllBranches,
  recordTreasuryTransfer,
  recordTreasuryDeposit,
  recordTreasuryTransferAcrossBranches,
  pickLedgerPostingBranch,
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

/** Super/Co Admin may omit branch to mean all branches. */
async function resolveOptionalBranchParam(actor, branchRaw) {
  const explicit = String(branchRaw || '').trim();
  if (explicit && mongoose.Types.ObjectId.isValid(explicit)) {
    if (!actorMayUseBranch(actor, explicit)) return { error: 'Cannot access this branch' };
    const exists = await Branch.findById(explicit).select('_id').lean();
    if (!exists) return { error: 'Branch not found' };
    return { branchId: new mongoose.Types.ObjectId(explicit), allBranches: false };
  }
  if (!ADMIN_ROLES.includes(actor.role) && actor.branch) {
    return {
      branchId: new mongoose.Types.ObjectId(String(actor.branch)),
      allBranches: false,
    };
  }
  if (ADMIN_ROLES.includes(actor.role)) {
    return { branchId: null, allBranches: true };
  }
  return { error: 'Valid branch is required' };
}

async function computeAccountBalanceAllBranches(accountKey, untilDate) {
  return computeAccountExpectedBalanceAllBranches(accountKey, untilDate);
}

export const listTreasuryAccounts = async (req, res) => {
  try {
    const userId = req.query.userId || req.body?.userId;
    const actor = await loadActor(userId);
    if (!canViewTreasury(actor)) {
      return res.status(403).json({ error: 'Not allowed' });
    }
    const resolved = await resolveOptionalBranchParam(actor, req.query.branch);
    if (resolved.error) return res.status(400).json({ error: resolved.error });

    const until = String(req.query.until || '').trim() || undefined;
    if (until && !/^\d{4}-\d{2}-\d{2}$/.test(until)) {
      return res.status(400).json({ error: 'until must be YYYY-MM-DD' });
    }

    const includeSettlement =
      String(req.query.includeSettlement || '').toLowerCase() === '1' ||
      String(req.query.includeSettlement || '').toLowerCase() === 'true';
    let { moneyAccounts } = await getEffectiveMoneyAccountsFromDb();
    if (!includeSettlement) {
      moneyAccounts = (moneyAccounts || []).filter((a) => a.kind !== 'settlement');
    }
    const keys = (moneyAccounts || []).map((a) => a.key);
    const cashKeys = (moneyAccounts || [])
      .filter((a) => a.kind === 'cash' || a.key === 'cash')
      .map((a) => a.key);
    const companyKeys = (moneyAccounts || [])
      .filter((a) => a.kind !== 'cash' && a.key !== 'cash')
      .map((a) => a.key);
    const adminCompanyWideNonCash =
      ADMIN_ROLES.includes(actor.role) && !resolved.allBranches;

    let balances;
    if (resolved.allBranches) {
      balances = await computeAccountsExpectedBalancesAllBranches(keys, until);
    } else if (adminCompanyWideNonCash) {
      const [cashBal, companyBal] = await Promise.all([
        computeAccountsExpectedBalances(resolved.branchId, cashKeys, until),
        computeAccountsExpectedBalancesAllBranches(companyKeys, until),
      ]);
      balances = new Map([...cashBal, ...companyBal]);
    } else {
      balances = await computeAccountsExpectedBalances(resolved.branchId, keys, until);
    }
    const accounts = (moneyAccounts || []).map((acc) => {
      const bal = balances.get(acc.key) || {
        openingBalance: 0,
        inTotal: 0,
        outTotal: 0,
        periodNet: 0,
        expectedBalance: 0,
      };
      return {
        key: acc.key,
        label: acc.label,
        kind: acc.kind,
        channel: acc.channel || '',
        accountNumber: acc.accountNumber || '',
        phone: acc.phone || '',
        enabled: acc.key === 'cash' ? true : acc.enabled !== false,
        ...bal,
      };
    });

    res.status(200).json({
      branch: resolved.allBranches ? null : String(resolved.branchId),
      allBranches: !!resolved.allBranches,
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
    const resolved = await resolveOptionalBranchParam(actor, req.query.branch);
    if (resolved.error) return res.status(400).json({ error: resolved.error });

    const key = String(req.params.key || '')
      .trim()
      .toLowerCase();
    const { moneyAccounts, paymentMethodAccountMap, paymentMethodsCatalog } =
      await getEffectiveMoneyAccountsFromDb();
    const acc = moneyAccounts.find((a) => a.key === key);
    if (!acc) return res.status(404).json({ error: 'Account not found' });
    const catalogByKey = new Map(
      (paymentMethodsCatalog || []).map((row) => [String(row.key || '').toLowerCase(), row])
    );
    const linkedMap = new Map();
    for (const row of paymentMethodAccountMap || []) {
      const method = String(row?.method || '').trim().toLowerCase();
      const accountKey = String(row?.accountKey || '').trim().toLowerCase();
      if (!method || !accountKey || accountKey !== key) continue;
      const cat = catalogByKey.get(method);
      const label = String(cat?.label || method).trim() || method;
      linkedMap.set(method, { key: method, label });
    }
    if (key === 'cash' && !linkedMap.has('cash')) {
      linkedMap.set('cash', { key: 'cash', label: 'Cash' });
    }
    const linkedPaymentMethods = [...linkedMap.values()].sort((a, b) =>
      String(a.label || a.key).localeCompare(String(b.label || b.key), 'ar')
    );

    const until = String(req.query.until || '').trim() || undefined;
    const isCash = acc.kind === 'cash' || key === 'cash';
    const companyWide =
      resolved.allBranches || (ADMIN_ROLES.includes(actor.role) && !isCash);
    const bal = companyWide
      ? await computeAccountBalanceAllBranches(key, until)
      : await computeAccountExpectedBalance(resolved.branchId, key, until);

    res.status(200).json({
      branch: resolved.allBranches ? null : String(resolved.branchId),
      allBranches: !!resolved.allBranches,
      account: acc,
      linkedPaymentMethods,
      ...bal,
    });
  } catch (error) {
    console.error('getTreasuryAccount:', error);
    res.status(500).json({ error: 'Failed to load account' });
  }
};

export const listRecentLedger = async (req, res) => {
  try {
    const userId = req.query.userId || req.body?.userId;
    const actor = await loadActor(userId);
    if (!canViewTreasury(actor)) {
      return res.status(403).json({ error: 'Not allowed' });
    }
    const resolved = await resolveOptionalBranchParam(actor, req.query.branch);
    if (resolved.error) return res.status(400).json({ error: resolved.error });

    const limit = Math.min(30, Math.max(1, parseInt(req.query.limit, 10) || 8));
    const { moneyAccounts, paymentMethodsCatalog } = await getEffectiveMoneyAccountsFromDb();
    const labelByKey = treasuryLabelByKey(moneyAccounts, paymentMethodsCatalog);

    const match = resolved.allBranches ? {} : { branch: resolved.branchId };
    const rows = await TreasuryLedgerEntry.find(match)
      .sort({ occurredAt: -1, createdAt: -1 })
      .limit(limit)
      .select(
        'accountKey direction amount occurredAt sourceType sourceId counterAccountKey note'
      )
      .lean();

    res.status(200).json({
      branch: resolved.allBranches ? null : String(resolved.branchId),
      entries: (rows || []).map((row) => ({
        _id: row._id,
        accountKey: row.accountKey,
        accountLabel: labelByKey[row.accountKey] || row.accountKey,
        counterAccountKey: row.counterAccountKey || '',
        counterAccountLabel: row.counterAccountKey
          ? prettyTreasuryText(row.counterAccountKey, labelByKey)
          : '',
        direction: row.direction,
        amount: row.amount,
        occurredAt: row.occurredAt,
        sourceType: row.sourceType,
        sourceId: row.sourceId || null,
        note: prettyTreasuryText(row.note, labelByKey),
      })),
    });
  } catch (error) {
    console.error('listRecentLedger:', error);
    res.status(500).json({ error: 'Failed to load recent ledger' });
  }
};

export const listAccountLedger = async (req, res) => {
  try {
    const userId = req.query.userId || req.body?.userId;
    const actor = await loadActor(userId);
    if (!canViewTreasury(actor)) {
      return res.status(403).json({ error: 'Not allowed' });
    }
    const resolved = await resolveOptionalBranchParam(actor, req.query.branch);
    if (resolved.error) return res.status(400).json({ error: resolved.error });

    const key = String(req.params.key || '')
      .trim()
      .toLowerCase();
    const { moneyAccounts, paymentMethodAccountMap, paymentMethodsCatalog } =
      await getEffectiveMoneyAccountsFromDb();
    if (!moneyAccounts.some((a) => a.key === key)) {
      return res.status(404).json({ error: 'Account not found' });
    }
    const labelByKey = treasuryLabelByKey(moneyAccounts, paymentMethodsCatalog);

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 30));
    const skip = (page - 1) * limit;
    const linkedMethodMap = new Map();
    const catalogByKey = new Map(
      (paymentMethodsCatalog || []).map((row) => [String(row.key || '').toLowerCase(), row])
    );
    for (const row of paymentMethodAccountMap || []) {
      const method = String(row?.method || '').trim().toLowerCase();
      const accountKey = String(row?.accountKey || '').trim().toLowerCase();
      if (!method || accountKey !== key) continue;
      const cat = catalogByKey.get(method);
      linkedMethodMap.set(method, {
        key: method,
        label: String(cat?.label || method).trim() || method,
      });
    }
    if (key === 'cash' && !linkedMethodMap.has('cash')) {
      linkedMethodMap.set('cash', { key: 'cash', label: 'Cash' });
    }
    const linkedPaymentMethods = [...linkedMethodMap.values()].sort((a, b) =>
      String(a.label || a.key).localeCompare(String(b.label || b.key), 'ar')
    );

    const match = { accountKey: key };
    if (!resolved.allBranches) match.branch = resolved.branchId;
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
    const methodsRaw = String(req.query.methods || '').trim();
    const methodFilter = methodsRaw
      ? [
          ...new Set(
            methodsRaw
              .split(',')
              .map((m) => String(m || '').trim().toLowerCase())
              .filter(Boolean)
          ),
        ]
      : [];
    if (methodFilter.length) {
      match.note = { $in: methodFilter };
    }

    const methodTotalsMatch = { ...match };
    delete methodTotalsMatch.note;
    const linkedKeys = linkedPaymentMethods.map((x) => x.key);
    if (linkedKeys.length) {
      methodTotalsMatch.note = { $in: linkedKeys };
    } else {
      methodTotalsMatch.note = { $in: [] };
    }

    const [total, rows, methodRows] = await Promise.all([
      TreasuryLedgerEntry.countDocuments(match),
      TreasuryLedgerEntry.find(match)
        .sort({ occurredAt: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('createdBy', 'name')
        .populate('branch', 'name')
        .lean(),
      TreasuryLedgerEntry.aggregate([
        { $match: methodTotalsMatch },
        {
          $group: {
            _id: { note: '$note', direction: '$direction' },
            total: { $sum: '$amount' },
          },
        },
      ]),
    ]);
    const totalsByMethod = new Map();
    for (const row of linkedPaymentMethods) {
      totalsByMethod.set(row.key, {
        key: row.key,
        label: row.label,
        inTotal: 0,
        outTotal: 0,
        net: 0,
      });
    }
    for (const r of methodRows || []) {
      const mKey = String(r?._id?.note || '').trim().toLowerCase();
      if (!totalsByMethod.has(mKey)) continue;
      const rec = totalsByMethod.get(mKey);
      if (r?._id?.direction === 'in') rec.inTotal = round2(r.total);
      if (r?._id?.direction === 'out') rec.outTotal = round2(r.total);
      rec.net = round2(rec.inTotal - rec.outTotal);
    }

    res.status(200).json({
      branch: resolved.allBranches ? null : String(resolved.branchId),
      allBranches: !!resolved.allBranches,
      accountKey: key,
      linkedPaymentMethods,
      methodTotals: [...totalsByMethod.values()],
      page,
      limit,
      total,
      entries: (rows || []).map((row) => ({
        ...row,
        branchId: row.branch?._id ? String(row.branch._id) : String(row.branch || ''),
        branchName: row.branch?.name || '',
        counterAccountLabel: row.counterAccountKey
          ? prettyTreasuryText(row.counterAccountKey, labelByKey)
          : '',
        note: prettyTreasuryText(row.note, labelByKey) || row.note || '',
      })),
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

    const from = String(fromAccountKey || '')
      .trim()
      .toLowerCase();
    const to = String(toAccountKey || '')
      .trim()
      .toLowerCase();
    if (!from || !to || from === to) {
      return res.status(400).json({ error: 'from and to accounts must differ' });
    }

    const cashInvolved = from === 'cash' || to === 'cash';
    const isAdmin = ADMIN_ROLES.includes(actor.role);
    const { moneyAccounts } = await getEffectiveMoneyAccountsFromDb();
    const fromKind = moneyAccounts.find((a) => a.key === from)?.kind;
    const settlementMove = !!isSettlement || fromKind === 'settlement';
    const sourceType = settlementMove ? 'settlement' : 'transfer';
    const transferNote = String(note || '').trim().slice(0, 2000);

    let result;
    if (settlementMove && isAdmin && !cashInvolved) {
      result = await recordTreasuryTransferAcrossBranches({
        fromAccountKey: from,
        toAccountKey: to,
        amount,
        sourceType,
        note: transferNote,
        createdBy: userId,
      });
    } else if (cashInvolved) {
      const resolved = await resolveBranchParam(actor, isAdmin ? branch : branch || actor.branch);
      if (resolved.error) return res.status(400).json({ error: resolved.error });
      result = await recordTreasuryTransfer({
        branchId: resolved.branchId,
        fromAccountKey: from,
        toAccountKey: to,
        amount,
        sourceType,
        note: transferNote,
        createdBy: userId,
        sufficiency: from === 'cash' ? 'branch' : 'company',
      });
    } else if (isAdmin) {
      let postingBranch = await pickLedgerPostingBranch(from);
      if (!postingBranch) {
        const any = await Branch.findOne().select('_id').lean();
        postingBranch = any?._id;
      }
      if (!postingBranch) {
        return res.status(400).json({ error: 'No branch found' });
      }
      result = await recordTreasuryTransfer({
        branchId: postingBranch,
        fromAccountKey: from,
        toAccountKey: to,
        amount,
        sourceType,
        note: transferNote,
        createdBy: userId,
        sufficiency: 'company',
      });
    } else {
      const resolved = await resolveBranchParam(actor, actor.branch);
      if (resolved.error) return res.status(400).json({ error: resolved.error });
      result = await recordTreasuryTransfer({
        branchId: resolved.branchId,
        fromAccountKey: from,
        toAccountKey: to,
        amount,
        sourceType,
        note: transferNote,
        createdBy: userId,
      });
    }

    if (result.error) {
      const body = { error: result.error };
      if (result.available != null) body.available = result.available;
      return res.status(400).json(body);
    }

    const first = result.transfers?.[0] || result;
    res.status(201).json({
      transferGroupId: first.transferGroupId,
      fromAccountKey: from,
      toAccountKey: to,
      amount: round2(amount),
      outEntryId: first.outEntry?._id,
      inEntryId: first.inEntry?._id,
      appliedBranches: result.transfers?.length || 1,
    });
  } catch (error) {
    console.error('createTreasuryTransfer:', error);
    res.status(500).json({ error: 'Failed to create transfer' });
  }
};

export const createTreasuryDeposit = async (req, res) => {
  try {
    const { userId, branch, accountKey, amount, note } = req.body || {};

    const actor = await loadActor(userId);
    if (!canSetOpening(actor)) {
      return res.status(403).json({ error: 'Not allowed to deposit' });
    }
    const resolved = await resolveBranchParam(actor, branch);
    if (resolved.error) return res.status(400).json({ error: resolved.error });

    const result = await recordTreasuryDeposit({
      branchId: resolved.branchId,
      accountKey,
      amount,
      note: String(note || '').trim().slice(0, 2000),
      createdBy: userId,
    });

    if (result.error) {
      return res.status(400).json({ error: result.error });
    }

    const key = String(accountKey || '')
      .trim()
      .toLowerCase();
    const bal = await computeAccountExpectedBalance(resolved.branchId, key);

    res.status(201).json({
      accountKey: key,
      amount: round2(amount),
      expectedBalance: bal.expectedBalance,
      entryId: result.entry?._id,
    });
  } catch (error) {
    console.error('createTreasuryDeposit:', error);
    res.status(500).json({ error: 'Failed to create deposit' });
  }
};

/**
 * Settlement shortcut: move amount from settlement receivable → linked bank
 * (settlementBankAccountKey from paymentMethodAccountMap).
 */
export const settleSettlementAccount = async (req, res) => {
  try {
    const { userId, amount, note } = req.body || {};
    const actor = await loadActor(userId);
    if (!canViewTreasury(actor)) {
      return res.status(403).json({ error: 'Not allowed' });
    }

    const key = String(req.params.key || '')
      .trim()
      .toLowerCase();
    const { moneyAccounts, paymentMethodAccountMap } = await getEffectiveMoneyAccountsFromDb();
    const account = moneyAccounts.find((a) => a.key === key);
    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }
    if (account.kind !== 'settlement') {
      return res.status(400).json({ error: 'Only settlement accounts can use quick settle' });
    }

    const toAccountKey = settlementBankForAccount(paymentMethodAccountMap, key);
    if (!toAccountKey) {
      return res.status(400).json({
        error: 'No settlement bank linked for this app. Set it in payment method → account map.',
      });
    }

    const settleNote = String(note || '').trim().slice(0, 2000) || `تسوية ${account.label}`;
    const companyWide = ADMIN_ROLES.includes(actor.role);

    let result;
    if (companyWide) {
      result = await recordTreasuryTransferAcrossBranches({
        fromAccountKey: key,
        toAccountKey,
        amount,
        sourceType: 'settlement',
        note: settleNote,
        createdBy: userId,
      });
    } else {
      const resolved = await resolveBranchParam(actor, actor.branch);
      if (resolved.error) return res.status(400).json({ error: resolved.error });
      result = await recordTreasuryTransfer({
        branchId: resolved.branchId,
        fromAccountKey: key,
        toAccountKey,
        amount,
        sourceType: 'settlement',
        note: settleNote,
        createdBy: userId,
      });
    }

    if (result.error) {
      const body = { error: result.error };
      if (result.available != null) body.available = result.available;
      return res.status(400).json(body);
    }

    const fromBal = await computeAccountBalanceAllBranches(key);
    const toBal = await computeAccountBalanceAllBranches(toAccountKey);
    const first = result.transfers?.[0] || result;

    res.status(201).json({
      fromAccountKey: key,
      toAccountKey,
      amount: round2(amount),
      fromExpectedBalance: fromBal.expectedBalance,
      toExpectedBalance: toBal.expectedBalance,
      transferGroupId: first.transferGroupId,
      appliedBranches: result.transfers?.length || 1,
    });
  } catch (error) {
    console.error('settleSettlementAccount:', error);
    res.status(500).json({ error: 'Failed to settle account' });
  }
};

export const setAccountOpeningBalance = async (req, res) => {
  try {
    const { userId, branch, amount, note, allBranches } = req.body || {};
    const actor = await loadActor(userId);
    if (!canSetOpening(actor)) {
      return res.status(403).json({ error: 'Not allowed to set opening balance' });
    }

    const key = String(req.params.key || '')
      .trim()
      .toLowerCase();
    if (key === 'cash') {
      return res.status(400).json({
        error:
          'Cash follows the branch drawer. Close the drawer (and retain counted cash) instead of setting a cash opening.',
      });
    }
    const { moneyAccounts } = await getEffectiveMoneyAccountsFromDb();
    if (!moneyAccounts.some((a) => a.key === key)) {
      return res.status(404).json({ error: 'Account not found' });
    }

    const amt = round2(amount);
    if (!Number.isFinite(amt)) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    const openingNote = String(note || '').trim().slice(0, 500);
    const applyAll =
      ADMIN_ROLES.includes(actor.role) &&
      (allBranches === true ||
        String(allBranches || '').toLowerCase() === 'true' ||
        !String(branch || '').trim());

    if (applyAll) {
      const branches = await Branch.find({}).select('_id').lean();
      await Promise.all(
        (branches || []).map((b) =>
          TreasuryAccountOpening.findOneAndUpdate(
            { branch: b._id, accountKey: key },
            {
              $set: {
                amount: amt,
                note: openingNote,
                setBy: userId,
              },
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
          )
        )
      );
      const bal = await computeAccountBalanceAllBranches(key);
      return res.status(200).json({
        accountKey: key,
        openingBalance: amt,
        expectedBalance: bal.expectedBalance,
        appliedBranches: (branches || []).length,
      });
    }

    const resolved = await resolveBranchParam(actor, branch);
    if (resolved.error) return res.status(400).json({ error: resolved.error });

    const doc = await TreasuryAccountOpening.findOneAndUpdate(
      { branch: resolved.branchId, accountKey: key },
      {
        $set: {
          amount: amt,
          note: openingNote,
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
