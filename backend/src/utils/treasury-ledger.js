import mongoose from 'mongoose';
import moment from 'moment-timezone';
import TreasuryLedgerEntry from '../DB/models/treasuryLedgerEntry.model.js';
import TreasuryAccountOpening from '../DB/models/treasuryAccountOpening.model.js';
import {
  getEffectiveMoneyAccountsFromDb,
  paymentMethodToAccountMap,
  settlementPaymentMethods,
} from '../modules/settings_module/moneyAccounts.js';
import { isDeferredPurchaseTreasury } from '../modules/settings_module/treasuryMethods.js';

const BUSINESS_TZ = 'Africa/Cairo';

export function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

/**
 * Company-wide opening: identical amounts across branches count once (not per branch).
 * Zero is ignored as "unset". Different non-zero amounts are summed.
 */
export function combineCompanyOpening(amounts) {
  const vals = (amounts || []).map((a) => round2(a ?? 0));
  const nonzero = vals.filter((v) => v !== 0);
  if (!nonzero.length) return 0;
  const first = nonzero[0];
  if (nonzero.every((v) => v === first)) return first;
  return round2(nonzero.reduce((s, v) => s + v, 0));
}

export function isCashDrawerAccount(accountKey) {
  return String(accountKey || '').trim().toLowerCase() === 'cash';
}

/** Cash drawers sum per branch; bank/wallet/settlement identical openings count once. */
export function companyOpeningForAccount(accountKey, amounts) {
  if (isCashDrawerAccount(accountKey)) {
    return round2((amounts || []).reduce((s, a) => s + round2(a ?? 0), 0));
  }
  return combineCompanyOpening(amounts);
}

export function businessDateStr(date = new Date()) {
  return moment(date).tz(BUSINESS_TZ).format('YYYY-MM-DD');
}

/**
 * Resolve which money account receives a cashier payment method.
 * Returns null if unmapped / credit / mixed / empty.
 */
export async function resolveAccountKeyForPaymentMethod(method) {
  const m = String(method || '')
    .trim()
    .toLowerCase();
  if (!m || m === 'credit' || m === 'mixed') return null;
  if (m === 'cash') return 'cash';
  const { paymentMethodAccountMap } = await getEffectiveMoneyAccountsFromDb();
  const map = paymentMethodToAccountMap(paymentMethodAccountMap);
  return map.get(m) || null;
}

/**
 * Write one ledger line. Skips zero/negative amounts and invalid branch.
 */
export async function recordTreasuryLedgerEntry({
  branchId,
  accountKey,
  direction,
  amount,
  occurredAt,
  sourceType,
  sourceId,
  counterAccountKey,
  transferGroupId,
  note,
  createdBy,
  session,
} = {}) {
  const key = String(accountKey || '')
    .trim()
    .toLowerCase();
  if (!key) return null;
  if (!branchId || !mongoose.Types.ObjectId.isValid(String(branchId))) {
    console.warn('⚠️ treasury ledger skipped: invalid branch', { accountKey: key, sourceType });
    return null;
  }
  const amt = round2(amount);
  if (!Number.isFinite(amt) || amt <= 0) return null;
  const dir = direction === 'out' ? 'out' : 'in';
  const when = occurredAt instanceof Date ? occurredAt : new Date(occurredAt || Date.now());

  const doc = {
    branch: new mongoose.Types.ObjectId(String(branchId)),
    accountKey: key,
    direction: dir,
    amount: amt,
    occurredAt: when,
    businessDate: businessDateStr(when),
    sourceType: sourceType || 'other',
    sourceId:
      sourceId && mongoose.Types.ObjectId.isValid(String(sourceId))
        ? new mongoose.Types.ObjectId(String(sourceId))
        : null,
    counterAccountKey: String(counterAccountKey || '')
      .trim()
      .toLowerCase()
      .slice(0, 40),
    transferGroupId:
      transferGroupId && mongoose.Types.ObjectId.isValid(String(transferGroupId))
        ? new mongoose.Types.ObjectId(String(transferGroupId))
        : null,
    note: String(note || '').trim().slice(0, 2000),
    createdBy:
      createdBy && mongoose.Types.ObjectId.isValid(String(createdBy))
        ? new mongoose.Types.ObjectId(String(createdBy))
        : null,
  };

  const opts = session ? { session } : {};
  const [created] = await TreasuryLedgerEntry.create([doc], opts);
  return created;
}

/**
 * One-sided inflow from outside the system (owner/capital deposit).
 */
export async function recordTreasuryDeposit({
  branchId,
  accountKey,
  amount,
  occurredAt,
  note,
  createdBy,
  session,
} = {}) {
  const key = String(accountKey || '')
    .trim()
    .toLowerCase();
  if (!key) return { error: 'Account is required' };

  const amt = round2(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    return { error: 'Amount must be greater than zero' };
  }

  const { moneyAccounts } = await getEffectiveMoneyAccountsFromDb();
  const acc = (moneyAccounts || []).find((a) => a.key === key);
  if (!acc) return { error: 'Unknown account key' };
  if (acc.kind === 'settlement') {
    return { error: 'Cannot deposit into a settlement account' };
  }

  const entry = await recordTreasuryLedgerEntry({
    branchId,
    accountKey: key,
    direction: 'in',
    amount: amt,
    occurredAt,
    sourceType: 'deposit',
    note,
    createdBy,
    session,
  });
  if (!entry) {
    return { error: 'Failed to record deposit' };
  }
  return { entry };
}

/**
 * Double-entry transfer / settlement between two accounts.
 */
export async function recordTreasuryTransfer({
  branchId,
  fromAccountKey,
  toAccountKey,
  amount,
  occurredAt,
  sourceType = 'transfer',
  sourceId,
  note,
  createdBy,
  session,
  sufficiency = 'branch',
} = {}) {
  const from = String(fromAccountKey || '')
    .trim()
    .toLowerCase();
  const to = String(toAccountKey || '')
    .trim()
    .toLowerCase();
  if (!from || !to || from === to) {
    return { error: 'from and to accounts must differ' };
  }
  const amt = round2(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    return { error: 'Amount must be greater than zero' };
  }

  const { moneyAccounts } = await getEffectiveMoneyAccountsFromDb();
  const keys = new Set(moneyAccounts.map((a) => a.key));
  if (!keys.has(from) || !keys.has(to)) {
    return { error: 'Unknown account key' };
  }

  const fromBal =
    sufficiency === 'company'
      ? await computeAccountExpectedBalanceAllBranches(from)
      : await computeAccountExpectedBalance(branchId, from);
  const available = round2(fromBal.expectedBalance);
  const availableCents = Math.round(available * 100);
  const amtCents = Math.round(amt * 100);
  if (availableCents <= 0) {
    return { error: 'INSUFFICIENT_FUNDS', available };
  }
  if (amtCents > availableCents) {
    return { error: 'AMOUNT_EXCEEDS_BALANCE', available };
  }

  const groupId = new mongoose.Types.ObjectId();
  const when = occurredAt instanceof Date ? occurredAt : new Date();
  const common = {
    branchId,
    amount: amt,
    occurredAt: when,
    sourceType,
    sourceId: sourceId || groupId,
    transferGroupId: groupId,
    note,
    createdBy,
    session,
  };

  const outEntry = await recordTreasuryLedgerEntry({
    ...common,
    accountKey: from,
    direction: 'out',
    counterAccountKey: to,
  });
  const inEntry = await recordTreasuryLedgerEntry({
    ...common,
    accountKey: to,
    direction: 'in',
    counterAccountKey: from,
  });

  return { transferGroupId: groupId, outEntry, inEntry };
}

/**
 * Expected balance per branch for one account (positive only).
 * Used to allocate app settlements across branches without a branch picker.
 */
export async function expectedPositiveByBranch(accountKey) {
  const key = String(accountKey || '')
    .trim()
    .toLowerCase();
  if (!key) return [];
  const [openings, rows] = await Promise.all([
    TreasuryAccountOpening.find({ accountKey: key }).select('branch amount').lean(),
    TreasuryLedgerEntry.aggregate([
      { $match: { accountKey: key } },
      {
        $group: {
          _id: { branch: '$branch', direction: '$direction' },
          total: { $sum: '$amount' },
        },
      },
    ]),
  ]);
  const byBranch = new Map();
  const ensure = (id) => {
    const s = String(id || '');
    if (!s || s === 'undefined' || s === 'null') return null;
    if (!byBranch.has(s)) byBranch.set(s, { branchId: s, opening: 0, inn: 0, out: 0 });
    return byBranch.get(s);
  };
  for (const o of openings || []) {
    const rec = ensure(o.branch);
    if (rec) rec.opening = round2(o.amount);
  }
  for (const r of rows || []) {
    const rec = ensure(r?._id?.branch);
    if (!rec) continue;
    if (r._id.direction === 'in') rec.inn = round2(r.total);
    if (r._id.direction === 'out') rec.out = round2(r.total);
  }
  return [...byBranch.values()]
    .map((r) => ({
      branchId: r.branchId,
      expected: round2(r.opening + r.inn - r.out),
    }))
    .filter((r) => r.expected > 0)
    .sort((a, b) => b.expected - a.expected);
}

/**
 * Split a settlement/transfer across branches that hold the from-account balance.
 */
export async function recordTreasuryTransferAcrossBranches({
  fromAccountKey,
  toAccountKey,
  amount,
  sourceType = 'settlement',
  note,
  createdBy,
} = {}) {
  const slices = await expectedPositiveByBranch(fromAccountKey);
  const total = round2(slices.reduce((s, r) => s + r.expected, 0));
  const amt = round2(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    return { error: 'Amount must be greater than zero' };
  }
  if (Math.round(total * 100) <= 0) {
    return { error: 'INSUFFICIENT_FUNDS', available: 0 };
  }
  if (Math.round(amt * 100) > Math.round(total * 100)) {
    return { error: 'AMOUNT_EXCEEDS_BALANCE', available: total };
  }

  let remaining = amt;
  const created = [];
  for (const slice of slices) {
    if (remaining <= 0) break;
    const take = round2(Math.min(remaining, slice.expected));
    if (take <= 0) continue;
    const result = await recordTreasuryTransfer({
      branchId: slice.branchId,
      fromAccountKey,
      toAccountKey,
      amount: take,
      sourceType,
      note,
      createdBy,
    });
    if (result.error) return result;
    created.push(result);
    remaining = round2(remaining - take);
  }
  return { transfers: created, amount: amt, available: total };
}

/**
 * Post payment-method amounts as ledger outflows (vendor prepaid deposit paid from store accounts).
 */
export async function postPaymentMethodOutflows({
  branchId,
  methodAmounts,
  occurredAt,
  sourceType,
  sourceId,
  note,
  createdBy,
  session,
} = {}) {
  if (!Array.isArray(methodAmounts) || !methodAmounts.length) return [];
  const { paymentMethodAccountMap } = await getEffectiveMoneyAccountsFromDb();
  const map = paymentMethodToAccountMap(paymentMethodAccountMap);
  const created = [];
  for (const row of methodAmounts) {
    const method = String(row?.method || '')
      .trim()
      .toLowerCase();
    const amt = round2(row?.amount);
    if (!method || method === 'credit' || method === 'mixed' || amt <= 0) continue;
    const accountKey = method === 'cash' ? 'cash' : map.get(method);
    if (!accountKey) continue;
    const entry = await recordTreasuryLedgerEntry({
      branchId,
      accountKey,
      direction: 'out',
      amount: amt,
      occurredAt,
      sourceType,
      sourceId,
      note: note || method,
      createdBy,
      session,
    });
    if (entry) created.push(entry);
  }
  return created;
}

function normalizeMethodKey(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase();
}

function feeAllocationsFromPaymentLines(payments) {
  const out = [];
  for (const p of payments || []) {
    const forMethod = normalizeMethodKey(p?.feeForMethod);
    const paidVia = normalizeMethodKey(p?.method);
    const collected = round2(p?.amount);
    const feeNet = round2(p?.feeNet) > 0 ? round2(p.feeNet) : collected;
    const feeGrossOnPaidVia =
      round2(p?.feeGrossOnPaidVia) > 0 ? round2(p.feeGrossOnPaidVia) : collected;
    if (!forMethod || !paidVia || feeNet <= 0) continue;
    out.push({ forMethod, feeNet, paidVia, feeGrossOnPaidVia });
  }
  return out;
}

function invoiceMethodAmountsFromPaymentLines(payments) {
  const out = [];
  for (const p of payments || []) {
    if (p?.feeForMethod || p?.countsTowardInvoice === false) continue;
    const method = normalizeMethodKey(p?.method || 'cash');
    const amount = round2(p?.amount);
    if (!method || method === 'credit' || amount <= 0) continue;
    out.push({ method, amount });
  }
  return out;
}

/**
 * Settlement apps withhold their % from the payout.
 * The fee can be collected in cash or via another method (including another
 * settlement app). If paidVia also has a %, the customer pays feeGross there
 * and that app withholds (feeGross − feeNet) too.
 */
export function applySettlementFeeNetting(methodAmounts, feeAllocations, settlementMethods) {
  const byMethod = new Map();
  for (const row of methodAmounts || []) {
    const method = normalizeMethodKey(row?.method);
    const amt = round2(row?.amount);
    if (!method || method === 'credit' || method === 'mixed' || amt <= 0) continue;
    byMethod.set(method, round2((byMethod.get(method) || 0) + amt));
  }

  for (const fee of feeAllocations || []) {
    const forMethod = normalizeMethodKey(fee?.forMethod);
    const viaRaw = normalizeMethodKey(fee?.paidVia);
    const feeNet = round2(fee?.feeNet);
    if (!forMethod || feeNet <= 0) continue;
    if (!settlementMethods?.has?.(forMethod)) continue;

    const current = byMethod.get(forMethod) || 0;
    byMethod.set(forMethod, round2(Math.max(0, current - feeNet)));

    const paidVia = !viaRaw || viaRaw === 'same' ? forMethod : viaRaw;
    if (paidVia === forMethod) continue;

    const feeGross =
      round2(fee?.feeGrossOnPaidVia) > 0 ? round2(fee.feeGrossOnPaidVia) : feeNet;
    byMethod.set(paidVia, round2((byMethod.get(paidVia) || 0) + feeGross));
    if (settlementMethods.has(paidVia)) {
      const nestedFee = round2(Math.max(0, feeGross - feeNet));
      if (nestedFee > 0) {
        byMethod.set(paidVia, round2(Math.max(0, (byMethod.get(paidVia) || 0) - nestedFee)));
      }
    }
  }

  return [...byMethod.entries()]
    .filter(([, amount]) => amount > 0)
    .map(([method, amount]) => ({ method, amount }));
}

/** Scale original settlement fees to this refund slice, then net receivable vs paidVia. */
export function applySettlementFeeNettingToSplits(splits, originalPayments, settlementMethods) {
  const origInvoice = new Map();
  for (const row of invoiceMethodAmountsFromPaymentLines(originalPayments)) {
    origInvoice.set(row.method, round2((origInvoice.get(row.method) || 0) + row.amount));
  }
  const proportionalFees = [];
  for (const fee of feeAllocationsFromPaymentLines(originalPayments)) {
    const orig = origInvoice.get(fee.forMethod) || 0;
    if (orig <= 0) continue;
    const refunded = round2(
      (splits || [])
        .filter((s) => normalizeMethodKey(s?.method) === fee.forMethod)
        .reduce((sum, s) => sum + round2(s?.amount), 0)
    );
    if (refunded <= 0) continue;
    const slice = round2(fee.feeNet * (refunded / orig));
    if (slice <= 0) continue;
    const origGross =
      round2(fee.feeGrossOnPaidVia) > 0 ? round2(fee.feeGrossOnPaidVia) : fee.feeNet;
    const sliceGross = round2(origGross * (refunded / orig));
    proportionalFees.push({
      ...fee,
      feeNet: slice,
      feeGrossOnPaidVia: sliceGross,
    });
  }
  return applySettlementFeeNetting(splits, proportionalFees, settlementMethods);
}

async function loadSettlementPaymentMethods() {
  const { paymentMethodAccountMap, moneyAccounts } = await getEffectiveMoneyAccountsFromDb();
  return settlementPaymentMethods(paymentMethodAccountMap, moneyAccounts);
}

export async function netSettlementFeesOnPaymentSplits(splits, originalPayments) {
  if (!Array.isArray(splits) || !splits.length) return splits || [];
  const settlementMethods = await loadSettlementPaymentMethods();
  if (!settlementMethods.size) return splits;
  return applySettlementFeeNettingToSplits(splits, originalPayments, settlementMethods);
}

/**
 * Post payment-method amounts (order / deposit / fee) as ledger inflows.
 * @param {{ method: string, amount: number }[]} methodAmounts
 * @param {Array<{ forMethod: string, feeNet: number, paidVia: string }>} [feeAllocations]
 */
export async function postPaymentMethodInflows({
  branchId,
  methodAmounts,
  feeAllocations,
  occurredAt,
  sourceType,
  sourceId,
  note,
  createdBy,
  session,
} = {}) {
  if (!Array.isArray(methodAmounts) || !methodAmounts.length) return [];
  const { paymentMethodAccountMap, moneyAccounts } = await getEffectiveMoneyAccountsFromDb();
  const map = paymentMethodToAccountMap(paymentMethodAccountMap);
  const settlementMethods = settlementPaymentMethods(paymentMethodAccountMap, moneyAccounts);
  const netted = applySettlementFeeNetting(methodAmounts, feeAllocations, settlementMethods);
  const created = [];
  for (const row of netted) {
    const method = String(row?.method || '')
      .trim()
      .toLowerCase();
    const amt = round2(row?.amount);
    if (!method || method === 'credit' || method === 'mixed' || amt <= 0) continue;
    const accountKey = method === 'cash' ? 'cash' : map.get(method);
    if (!accountKey) continue;
    const entry = await recordTreasuryLedgerEntry({
      branchId,
      accountKey,
      direction: 'in',
      amount: amt,
      occurredAt,
      sourceType,
      sourceId,
      note: note || method,
      createdBy,
      session,
    });
    if (entry) created.push(entry);
  }
  return created;
}

function spendAccountKeyForSplit(splitKey, moneyAccounts, paymentMethodAccountMap) {
  const key = String(splitKey || '')
    .trim()
    .toLowerCase();
  if (!key || isDeferredPurchaseTreasury(key)) return null;
  if (key === 'cash') return 'cash';
  const spendable = new Set(
    (moneyAccounts || [])
      .filter((a) => a && (a.kind === 'cash' || a.kind === 'treasury'))
      .map((a) => String(a.key || '').trim().toLowerCase())
      .filter(Boolean)
  );
  const map = paymentMethodToAccountMap(paymentMethodAccountMap);
  const mapped = map.get(key);
  if (mapped && spendable.has(mapped)) return mapped;
  if (spendable.has(key)) return key;
  return null;
}

/**
 * Post purchase-treasury split outflows (expenses, desk purchase, vendor pay).
 * Skips deferred. Cash and non-cash both go to ledger (linked wallet/bank account).
 */
export async function postTreasurySplitOutflows({
  branchId,
  splits,
  occurredAt,
  sourceType,
  sourceId,
  note,
  createdBy,
  session,
} = {}) {
  if (!Array.isArray(splits) || !splits.length) return [];
  const { moneyAccounts, paymentMethodAccountMap } = await getEffectiveMoneyAccountsFromDb();
  const created = [];
  for (const row of splits) {
    const accountKey = spendAccountKeyForSplit(row?.key, moneyAccounts, paymentMethodAccountMap);
    if (!accountKey) continue;
    const amt = round2(row?.amount);
    if (amt <= 0) continue;
    const entry = await recordTreasuryLedgerEntry({
      branchId,
      accountKey,
      direction: 'out',
      amount: amt,
      occurredAt,
      sourceType,
      sourceId,
      note,
      createdBy,
      session,
    });
    if (entry) created.push(entry);
  }
  return created;
}

/**
 * Post purchase-treasury split inflows (vendor receipts, purchase returns as cash to treasury).
 */
export async function postTreasurySplitInflows({
  branchId,
  splits,
  occurredAt,
  sourceType,
  sourceId,
  note,
  createdBy,
  session,
} = {}) {
  if (!Array.isArray(splits) || !splits.length) return [];
  const { moneyAccounts, paymentMethodAccountMap } = await getEffectiveMoneyAccountsFromDb();
  const created = [];
  for (const row of splits) {
    const accountKey = spendAccountKeyForSplit(row?.key, moneyAccounts, paymentMethodAccountMap);
    if (!accountKey) continue;
    const amt = round2(row?.amount);
    if (amt <= 0) continue;
    const entry = await recordTreasuryLedgerEntry({
      branchId,
      accountKey,
      direction: 'in',
      amount: amt,
      occurredAt,
      sourceType,
      sourceId,
      note,
      createdBy,
      session,
    });
    if (entry) created.push(entry);
  }
  return created;
}

/** Opening balance for one account (0 if unset). */
export async function getOpeningBalance(branchId, accountKey) {
  if (!branchId || !accountKey) return 0;
  const doc = await TreasuryAccountOpening.findOne({
    branch: branchId,
    accountKey: String(accountKey).trim().toLowerCase(),
  })
    .select('amount')
    .lean();
  return round2(doc?.amount ?? 0);
}

/** Net ledger movements (in − out) for account/branch, optional date bounds inclusive. */
export async function sumLedgerNet({ branchId, accountKey, untilDate, fromDate } = {}) {
  const match = {
    accountKey: String(accountKey).trim().toLowerCase(),
  };
  if (branchId) {
    match.branch = new mongoose.Types.ObjectId(String(branchId));
  }
  if (fromDate || untilDate) {
    match.occurredAt = {};
    if (fromDate) {
      match.occurredAt.$gte = moment
        .tz(String(fromDate), 'YYYY-MM-DD', BUSINESS_TZ)
        .startOf('day')
        .utc()
        .toDate();
    }
    if (untilDate) {
      match.occurredAt.$lte = moment
        .tz(String(untilDate), 'YYYY-MM-DD', BUSINESS_TZ)
        .endOf('day')
        .utc()
        .toDate();
    }
  }
  const rows = await TreasuryLedgerEntry.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$direction',
        total: { $sum: '$amount' },
      },
    },
  ]);
  let inn = 0;
  let out = 0;
  for (const r of rows) {
    if (r._id === 'in') inn = round2(r.total);
    if (r._id === 'out') out = round2(r.total);
  }
  return { inTotal: inn, outTotal: out, net: round2(inn - out) };
}

async function overlayCashFromDrawer(bal, { branchId, untilDate, allBranches } = {}) {
  if (!bal) return bal;
  try {
    const drawerMod = await import('../modules/drawer_close_module/service.js');
    const drawerCash = allBranches
      ? await drawerMod.sumCurrentDrawerCashAllBranches(untilDate)
      : await drawerMod.getCurrentDrawerCash(branchId, untilDate);
    return {
      ...bal,
      openingBalance: round2(drawerCash - (bal.periodNet || 0)),
      expectedBalance: round2(drawerCash),
    };
  } catch (err) {
    console.warn('overlayCashFromDrawer:', err?.message || err);
    return bal;
  }
}

async function overlayCashRowInBalanceMap(result, untilDate, { branchId, allBranches } = {}) {
  if (!result?.has?.('cash')) return result;
  const row = result.get('cash');
  result.set('cash', await overlayCashFromDrawer(row, { branchId, untilDate, allBranches }));
  return result;
}

export async function computeAccountExpectedBalance(branchId, accountKey, untilDate) {
  const opening = await getOpeningBalance(branchId, accountKey);
  const { inTotal, outTotal, net } = await sumLedgerNet({ branchId, accountKey, untilDate });
  const bal = {
    openingBalance: opening,
    inTotal,
    outTotal,
    periodNet: net,
    expectedBalance: round2(opening + net),
  };
  if (isCashDrawerAccount(accountKey)) {
    return overlayCashFromDrawer(bal, { branchId, untilDate, allBranches: false });
  }
  return bal;
}

/** Company-wide expected. Cash openings sum by drawer; other accounts share one opening. */
export async function computeAccountExpectedBalanceAllBranches(accountKey, untilDate) {
  const key = String(accountKey || '')
    .trim()
    .toLowerCase();
  if (!key) return emptyBalance();
  const openings = await TreasuryAccountOpening.find({ accountKey: key }).select('amount').lean();
  const openingBalance = companyOpeningForAccount(
    key,
    (openings || []).map((d) => d.amount)
  );
  const match = { accountKey: key };
  if (untilDate) {
    match.occurredAt = {
      $lte: moment
        .tz(String(untilDate), 'YYYY-MM-DD', BUSINESS_TZ)
        .endOf('day')
        .utc()
        .toDate(),
    };
  }
  const rows = await TreasuryLedgerEntry.aggregate([
    { $match: match },
    { $group: { _id: '$direction', total: { $sum: '$amount' } } },
  ]);
  let inn = 0;
  let out = 0;
  for (const r of rows) {
    if (r._id === 'in') inn = round2(r.total);
    if (r._id === 'out') out = round2(r.total);
  }
  const periodNet = round2(inn - out);
  const bal = {
    openingBalance,
    inTotal: inn,
    outTotal: out,
    periodNet,
    expectedBalance: round2(openingBalance + periodNet),
  };
  if (isCashDrawerAccount(key)) {
    return overlayCashFromDrawer(bal, { untilDate, allBranches: true });
  }
  return bal;
}

export async function pickLedgerPostingBranch(accountKey) {
  const key = String(accountKey || '')
    .trim()
    .toLowerCase();
  if (!key) return null;
  const last = await TreasuryLedgerEntry.findOne({ accountKey: key })
    .sort({ occurredAt: -1 })
    .select('branch')
    .lean();
  if (last?.branch) return last.branch;
  const opening = await TreasuryAccountOpening.findOne({ accountKey: key }).select('branch').lean();
  return opening?.branch || null;
}

function emptyBalance() {
  return {
    openingBalance: 0,
    inTotal: 0,
    outTotal: 0,
    periodNet: 0,
    expectedBalance: 0,
  };
}

/** Batch opening + ledger net for many accounts (avoids N+1 on the accounts list). */
export async function computeAccountsExpectedBalances(branchId, accountKeys, untilDate) {
  const keys = [
    ...new Set(
      (accountKeys || [])
        .map((k) => String(k || '').trim().toLowerCase())
        .filter(Boolean)
    ),
  ];
  const result = new Map(keys.map((k) => [k, emptyBalance()]));
  if (!branchId || !keys.length) return result;

  const branchObj = new mongoose.Types.ObjectId(String(branchId));
  const openings = await TreasuryAccountOpening.find({
    branch: branchObj,
    accountKey: { $in: keys },
  })
    .select('accountKey amount')
    .lean();
  for (const doc of openings) {
    const row = result.get(String(doc.accountKey || '').toLowerCase());
    if (row) row.openingBalance = round2(doc.amount ?? 0);
  }

  const match = {
    branch: branchObj,
    accountKey: { $in: keys },
  };
  if (untilDate) {
    match.occurredAt = {
      $lte: moment.tz(String(untilDate), 'YYYY-MM-DD', BUSINESS_TZ).endOf('day').utc().toDate(),
    };
  }
  const rows = await TreasuryLedgerEntry.aggregate([
    { $match: match },
    {
      $group: {
        _id: { accountKey: '$accountKey', direction: '$direction' },
        total: { $sum: '$amount' },
      },
    },
  ]);
  for (const r of rows) {
    const key = String(r?._id?.accountKey || '').toLowerCase();
    const row = result.get(key);
    if (!row) continue;
    if (r._id.direction === 'in') row.inTotal = round2(r.total);
    if (r._id.direction === 'out') row.outTotal = round2(r.total);
  }
  for (const row of result.values()) {
    row.periodNet = round2(row.inTotal - row.outTotal);
    row.expectedBalance = round2(row.openingBalance + row.periodNet);
  }
  return overlayCashRowInBalanceMap(result, untilDate, { branchId, allBranches: false });
}

/** Company-wide balances: cash openings are summed; other accounts share one opening. */
export async function computeAccountsExpectedBalancesAllBranches(accountKeys, untilDate) {
  const keys = [
    ...new Set(
      (accountKeys || [])
        .map((k) => String(k || '').trim().toLowerCase())
        .filter(Boolean)
    ),
  ];
  const result = new Map(keys.map((k) => [k, emptyBalance()]));
  if (!keys.length) return result;

  const openings = await TreasuryAccountOpening.find({ accountKey: { $in: keys } })
    .select('accountKey amount')
    .lean();
  const amountsByKey = new Map();
  for (const doc of openings || []) {
    const key = String(doc.accountKey || '').toLowerCase();
    if (!result.has(key)) continue;
    const list = amountsByKey.get(key) || [];
    list.push(doc.amount);
    amountsByKey.set(key, list);
  }
  for (const [key, amounts] of amountsByKey) {
    const row = result.get(key);
    if (row) row.openingBalance = companyOpeningForAccount(key, amounts);
  }

  const match = { accountKey: { $in: keys } };
  if (untilDate) {
    match.occurredAt = {
      $lte: moment.tz(String(untilDate), 'YYYY-MM-DD', BUSINESS_TZ).endOf('day').utc().toDate(),
    };
  }
  const rows = await TreasuryLedgerEntry.aggregate([
    { $match: match },
    {
      $group: {
        _id: { accountKey: '$accountKey', direction: '$direction' },
        total: { $sum: '$amount' },
      },
    },
  ]);
  for (const r of rows) {
    const key = String(r?._id?.accountKey || '').toLowerCase();
    const row = result.get(key);
    if (!row) continue;
    if (r._id.direction === 'in') row.inTotal = round2(r.total);
    if (r._id.direction === 'out') row.outTotal = round2(r.total);
  }
  for (const row of result.values()) {
    row.periodNet = round2(row.inTotal - row.outTotal);
    row.expectedBalance = round2(row.openingBalance + row.periodNet);
  }
  return overlayCashRowInBalanceMap(result, untilDate, { allBranches: true });
}

/** Latest ledger row per account in one query. */
export async function lastMovementsByAccount(branchId, accountKeys) {
  const keys = [
    ...new Set(
      (accountKeys || [])
        .map((k) => String(k || '').trim().toLowerCase())
        .filter(Boolean)
    ),
  ];
  const result = new Map();
  if (!keys.length) return result;
  const match = { accountKey: { $in: keys } };
  if (branchId) {
    match.branch = new mongoose.Types.ObjectId(String(branchId));
  }
  const rows = await TreasuryLedgerEntry.aggregate([
    { $match: match },
    { $sort: { occurredAt: -1 } },
    {
      $group: {
        _id: '$accountKey',
        occurredAt: { $first: '$occurredAt' },
        direction: { $first: '$direction' },
        amount: { $first: '$amount' },
        sourceType: { $first: '$sourceType' },
      },
    },
  ]);
  for (const r of rows) {
    result.set(String(r._id || '').toLowerCase(), {
      occurredAt: r.occurredAt,
      direction: r.direction,
      amount: r.amount,
      sourceType: r.sourceType,
    });
  }
  return result;
}

/** Sum cash ledger net for transfers, settlements, and owner deposits (drawer sync). */
export async function sumCashTransferNet({ branchId, start, end } = {}) {
  if (!branchId || !start || !end) return 0;
  const rows = await TreasuryLedgerEntry.aggregate([
    {
      $match: {
        branch: new mongoose.Types.ObjectId(String(branchId)),
        accountKey: 'cash',
        sourceType: { $in: ['transfer', 'settlement', 'deposit'] },
        occurredAt: { $gte: start, $lte: end },
      },
    },
    {
      $group: {
        _id: '$direction',
        total: { $sum: '$amount' },
      },
    },
  ]);
  let inn = 0;
  let out = 0;
  for (const r of rows) {
    if (r._id === 'in') inn = round2(r.total);
    if (r._id === 'out') out = round2(r.total);
  }
  return round2(inn - out);
}

/**
 * Safe fire-and-forget style posting: never throws to callers.
 * Logs and swallows errors so operational flows are not blocked.
 */
export async function safeTreasuryPost(label, fn) {
  try {
    return await fn();
  } catch (err) {
    console.warn(`⚠️ treasury ledger (${label}):`, err?.message || err);
    return null;
  }
}

/**
 * Post order payment lines (invoice + surcharge/fee) to money accounts.
 * Settlement-app receivable is invoice net minus the fee when the customer
 * paid that fee via another method (usually cash).
 */
export async function postOrderPaymentLinesToLedger({
  branchId,
  payments,
  orderId,
  createdBy,
  sourceType = 'order_payment',
} = {}) {
  if (!branchId || !Array.isArray(payments) || !payments.length) return [];
  const invoiceAmounts = invoiceMethodAmountsFromPaymentLines(payments);
  const feeAllocations = feeAllocationsFromPaymentLines(payments);
  if (!invoiceAmounts.length) return [];
  return postPaymentMethodInflows({
    branchId,
    methodAmounts: invoiceAmounts,
    feeAllocations,
    occurredAt: payments[0]?.paidAt || new Date(),
    sourceType,
    sourceId: orderId,
    createdBy,
  });
}

/**
 * Post refund payment splits as outflows (sale return).
 */
export async function postRefundPaymentLinesToLedger({
  branchId,
  refundPaymentSplits,
  orderId,
  createdBy,
  occurredAt,
} = {}) {
  if (!branchId || !Array.isArray(refundPaymentSplits) || !refundPaymentSplits.length) return [];
  const { paymentMethodAccountMap } = await getEffectiveMoneyAccountsFromDb();
  const map = paymentMethodToAccountMap(paymentMethodAccountMap);
  const created = [];
  for (const s of refundPaymentSplits) {
    const method = String(s?.method || '')
      .trim()
      .toLowerCase();
    const amt = round2(s?.amount);
    if (!method || method === 'credit' || amt <= 0) continue;
    const accountKey = method === 'cash' ? 'cash' : map.get(method);
    if (!accountKey) continue;
    const entry = await recordTreasuryLedgerEntry({
      branchId,
      accountKey,
      direction: 'out',
      amount: amt,
      occurredAt: occurredAt || new Date(),
      sourceType: 'order_refund',
      sourceId: orderId,
      note: method,
      createdBy,
    });
    if (entry) created.push(entry);
  }
  return created;
}
