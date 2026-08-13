import mongoose from 'mongoose';
import moment from 'moment-timezone';
import TreasuryLedgerEntry from '../DB/models/treasuryLedgerEntry.model.js';
import TreasuryAccountOpening from '../DB/models/treasuryAccountOpening.model.js';
import {
  getEffectiveMoneyAccountsFromDb,
  paymentMethodToAccountMap,
} from '../modules/settings_module/moneyAccounts.js';
import { isDeferredPurchaseTreasury } from '../modules/settings_module/treasuryMethods.js';

const BUSINESS_TZ = 'Africa/Cairo';

export function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
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

  const fromBal = await computeAccountExpectedBalance(branchId, from);
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

/**
 * Post payment-method amounts (order / deposit) as ledger inflows.
 * Only invoice-counting amounts should be passed (exclude pure fee lines if desired).
 * @param {{ method: string, amount: number }[]} methodAmounts
 */
export async function postPaymentMethodInflows({
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

/**
 * Post purchase-treasury split outflows (expenses, desk purchase, vendor pay).
 * Skips deferred. Cash and non-cash both go to ledger.
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
  const created = [];
  for (const row of splits) {
    const key = String(row?.key || '')
      .trim()
      .toLowerCase();
    if (!key || isDeferredPurchaseTreasury(key)) continue;
    const amt = round2(row?.amount);
    if (amt <= 0) continue;
    const entry = await recordTreasuryLedgerEntry({
      branchId,
      accountKey: key,
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
  const created = [];
  for (const row of splits) {
    const key = String(row?.key || '')
      .trim()
      .toLowerCase();
    if (!key || isDeferredPurchaseTreasury(key)) continue;
    const amt = round2(row?.amount);
    if (amt <= 0) continue;
    const entry = await recordTreasuryLedgerEntry({
      branchId,
      accountKey: key,
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

/** Net ledger movements (in − out) for account/branch, optional date upper bound inclusive. */
export async function sumLedgerNet({ branchId, accountKey, untilDate } = {}) {
  const match = {
    branch: new mongoose.Types.ObjectId(String(branchId)),
    accountKey: String(accountKey).trim().toLowerCase(),
  };
  if (untilDate) {
    const end = moment
      .tz(String(untilDate), 'YYYY-MM-DD', BUSINESS_TZ)
      .endOf('day')
      .utc()
      .toDate();
    match.occurredAt = { $lte: end };
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

export async function computeAccountExpectedBalance(branchId, accountKey, untilDate) {
  const opening = await getOpeningBalance(branchId, accountKey);
  const { inTotal, outTotal, net } = await sumLedgerNet({ branchId, accountKey, untilDate });
  return {
    openingBalance: opening,
    inTotal,
    outTotal,
    periodNet: net,
    expectedBalance: round2(opening + net),
  };
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
  return result;
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
  if (!branchId || !keys.length) return result;
  const rows = await TreasuryLedgerEntry.aggregate([
    {
      $match: {
        branch: new mongoose.Types.ObjectId(String(branchId)),
        accountKey: { $in: keys },
      },
    },
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

/** Sum cash ledger net for transfers only (for drawer sync of transfer movements). */
export async function sumCashTransferNet({ branchId, start, end } = {}) {
  if (!branchId || !start || !end) return 0;
  const rows = await TreasuryLedgerEntry.aggregate([
    {
      $match: {
        branch: new mongoose.Types.ObjectId(String(branchId)),
        accountKey: 'cash',
        sourceType: { $in: ['transfer', 'settlement'] },
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
 * Post invoice-counting order payment lines to money accounts.
 */
export async function postOrderPaymentLinesToLedger({
  branchId,
  payments,
  orderId,
  createdBy,
  sourceType = 'order_payment',
} = {}) {
  if (!branchId || !Array.isArray(payments) || !payments.length) return [];
  const methodAmounts = [];
  for (const p of payments) {
    if (p?.countsTowardInvoice === false) continue;
    const method = String(p?.method || 'cash')
      .trim()
      .toLowerCase();
    if (!method || method === 'credit') continue;
    const amt = round2(p?.amount);
    if (amt <= 0) continue;
    methodAmounts.push({ method, amount: amt });
  }
  return postPaymentMethodInflows({
    branchId,
    methodAmounts,
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
