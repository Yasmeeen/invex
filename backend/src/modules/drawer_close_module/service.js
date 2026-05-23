import mongoose from 'mongoose';
import moment from 'moment-timezone';
import Order from '../../DB/models/order.model.js';
import DailyExpense from '../../DB/models/dailyExpense.model.js';
import ProductPurchaseRequest from '../../DB/models/productPurchaseRequest.model.js';
import DrawerClose from '../../DB/models/drawerClose.model.js';
import Branch from '../../DB/models/branch.model.js';
import User from '../../DB/models/user.model.js';
import {
  aggregateTreasuryAmountsFromPurchases,
  resolvePurchaseTreasurySplits,
  sumCashDrawerOutflowFromExpenses,
  sumCashDrawerOutflowFromPurchases,
} from '../../utils/purchase-treasury-splits.js';
import { sumVendorCashDrawerOutflows } from '../../utils/vendor-cash-drawer.js';

const ADMIN_ROLES = ['Super Admin', 'Co Admin'];
/** Business day boundaries for drawer close (store operations). */
const DRAWER_BUSINESS_TZ = 'Africa/Cairo';

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function normalizePayMethod(m) {
  const s = String(m ?? '').trim().toLowerCase();
  return s || 'cash';
}

/** Physical cash in drawer only — literal cash payments. */
function isPhysicalCashMethod(m) {
  return normalizePayMethod(m) === 'cash';
}

function parseBusinessDay(yyyyMmDd) {
  const raw = String(yyyyMmDd || '').trim();
  const m = moment.tz(raw, 'YYYY-MM-DD', DRAWER_BUSINESS_TZ);
  if (!m.isValid()) return null;
  return {
    start: m.clone().startOf('day').utc().toDate(),
    end: m.clone().endOf('day').utc().toDate(),
    dateStr: raw,
  };
}

/** Inclusive calendar range from startStr through endStr (YYYY-MM-DD). */
function parseBusinessPeriod(startStr, endStr) {
  const startRaw = String(startStr || '').trim();
  const endRaw = String(endStr || '').trim();
  if (!startRaw || !endRaw || startRaw > endRaw) return null;
  const startDay = parseBusinessDay(startRaw);
  const endDay = parseBusinessDay(endRaw);
  if (!startDay || !endDay) return null;
  return {
    start: startDay.start,
    end: endDay.end,
    periodStartDate: startRaw,
    periodEndDate: endRaw,
  };
}

function dayAfter(dateStr) {
  return moment.tz(String(dateStr), 'YYYY-MM-DD', DRAWER_BUSINESS_TZ).add(1, 'day').format('YYYY-MM-DD');
}

function countDaysInclusive(startStr, endStr) {
  const s = moment.tz(String(startStr), 'YYYY-MM-DD', DRAWER_BUSINESS_TZ);
  const e = moment.tz(String(endStr), 'YYYY-MM-DD', DRAWER_BUSINESS_TZ);
  if (!s.isValid() || !e.isValid()) return 1;
  return Math.max(1, e.diff(s, 'days') + 1);
}

const CASH_DISPOSITIONS = ['deposit_all', 'retain_all', 'retain_partial'];

async function getLastDrawerCloseBefore(branchOid, targetDateStr) {
  const rows = await DrawerClose.find({
    branch: branchOid,
    $or: [
      { periodEndDate: { $lt: targetDateStr } },
      { periodEndDate: { $exists: false }, businessDate: { $lt: targetDateStr } },
    ],
  })
    .sort({ periodEndDate: -1, businessDate: -1, createdAt: -1 })
    .limit(1)
    .lean();
  return rows[0] || null;
}

async function resolveClosePeriod(branchOid, targetDateStr) {
  const lastClose = await getLastDrawerCloseBefore(branchOid, targetDateStr);
  const openingCashBalance = round2(Number(lastClose?.retainedCash ?? 0));
  let periodStartDate = targetDateStr;
  if (lastClose) {
    const lastEnd = lastClose.periodEndDate || lastClose.businessDate;
    periodStartDate = dayAfter(lastEnd);
  }
  const periodEndDate = targetDateStr;
  const bounds = parseBusinessPeriod(periodStartDate, periodEndDate);
  const missedDaysCount = countDaysInclusive(periodStartDate, periodEndDate);
  return { openingCashBalance, periodStartDate, periodEndDate, bounds, missedDaysCount };
}

async function periodOverlapsExisting(branchOid, periodStartDate, periodEndDate) {
  return DrawerClose.findOne({
    branch: branchOid,
    $or: [
      {
        periodStartDate: { $lte: periodEndDate },
        periodEndDate: { $gte: periodStartDate },
      },
      {
        periodStartDate: { $exists: false },
        businessDate: { $gte: periodStartDate, $lte: periodEndDate },
      },
    ],
  })
    .select('_id businessDate periodStartDate periodEndDate')
    .lean();
}

function resolveCashDisposition(actual, cashDisposition, retainedCashRaw) {
  const disposition = String(cashDisposition || 'deposit_all').trim();
  if (!CASH_DISPOSITIONS.includes(disposition)) {
    return { error: 'Invalid cashDisposition' };
  }

  const actualR = round2(actual);
  let retained = 0;
  let deposited = actualR;

  if (disposition === 'deposit_all') {
    retained = 0;
    deposited = actualR;
  } else if (disposition === 'retain_all') {
    retained = actualR;
    deposited = 0;
  } else {
    retained = round2(retainedCashRaw);
    if (!Number.isFinite(retained) || retained <= 0 || retained >= actualR) {
      return {
        error:
          'For retain_partial, retainedCash must be greater than 0 and less than actualCashCounted',
      };
    }
    deposited = round2(actualR - retained);
  }

  return { disposition, retained, deposited };
}

function normalizeDrawerCloseRow(row) {
  if (!row) return row;
  const businessDate = row.businessDate;
  const actual = round2(Number(row.actualCashCounted ?? 0));
  return {
    ...row,
    periodStartDate: row.periodStartDate || businessDate,
    periodEndDate: row.periodEndDate || businessDate,
    openingCashBalance: round2(Number(row.openingCashBalance ?? 0)),
    periodNetCashMovements: round2(
      Number(row.periodNetCashMovements ?? row.expectedCashInDrawer ?? 0)
    ),
    cashDisposition: row.cashDisposition || 'deposit_all',
    retainedCash: round2(Number(row.retainedCash ?? 0)),
    depositedCash: round2(Number(row.depositedCash ?? actual)),
  };
}

async function computeDrawerPreviewWithPeriod(branchOid, targetDateStr) {
  const period = await resolveClosePeriod(branchOid, targetDateStr);
  if (!period.bounds) {
    throw new Error('Invalid close period');
  }

  const raw = await computeDrawerPreview(branchOid, period.bounds);
  const periodNetCashMovements = round2(raw.periodNetCashMovements);
  const expectedCashInDrawer = round2(period.openingCashBalance + periodNetCashMovements);

  return {
    ...raw,
    periodNetCashMovements,
    expectedCashInDrawer,
    openingCashBalance: period.openingCashBalance,
    periodStartDate: period.periodStartDate,
    periodEndDate: period.periodEndDate,
    missedDaysCount: period.missedDaysCount,
  };
}

async function loadActor(userId) {
  if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) return null;
  return User.findById(userId).select('role branch name').lean();
}

function canUseDrawerClose(actor) {
  if (!actor) return false;
  const r = actor.role;
  return ADMIN_ROLES.includes(r) || r === 'Branch Manager' || r === 'Cashier';
}

function actorMayUseBranch(actor, branchIdStr) {
  if (!actor || !branchIdStr) return false;
  if (ADMIN_ROLES.includes(actor.role)) return true;
  if (!actor.branch) return false;
  return String(actor.branch) === String(branchIdStr);
}

function mergeAmounts(target, map) {
  const out = { ...target };
  for (const [k, v] of Object.entries(map || {})) {
    out[k] = round2((out[k] || 0) + Number(v || 0));
  }
  return out;
}

/** Payments received into the branch today (split lines), grouped by method. */
async function paymentsReceivedByMethod(branchOid, start, end) {
  const orders = await Order.find({
    branch: branchOid,
    payments: { $elemMatch: { paidAt: { $gte: start, $lte: end } } },
  })
    .select('payments')
    .lean();

  const byMethod = {};
  for (const o of orders) {
    for (const p of o.payments || []) {
      const t = p.paidAt ? new Date(p.paidAt).getTime() : NaN;
      if (Number.isNaN(t) || t < start.getTime() || t > end.getTime()) continue;
      const splits = Array.isArray(p.paymentTreasurySplits) ? p.paymentTreasurySplits : [];
      if (splits.length) {
        for (const s of splits) {
          const m = normalizePayMethod(s.key);
          byMethod[m] = round2((byMethod[m] || 0) + Number(s.amount || 0));
        }
      } else {
        const m = normalizePayMethod(p.method);
        byMethod[m] = round2((byMethod[m] || 0) + Number(p.amount || 0));
      }
    }
  }
  return byMethod;
}

/** Cash collected today on client credit sales (pay-later installments) — subset of paymentsIn. */
async function sumClientCreditOrderCashPayments(branchOid, start, end) {
  const orders = await Order.find({
    branch: branchOid,
    paymentMethod: 'credit',
    partyType: { $ne: 'supplier' },
    payments: { $elemMatch: { paidAt: { $gte: start, $lte: end } } },
  })
    .select('payments')
    .lean();

  let total = 0;
  let count = 0;
  for (const o of orders) {
    for (const p of o.payments || []) {
      const t = p.paidAt ? new Date(p.paidAt).getTime() : NaN;
      if (Number.isNaN(t) || t < start.getTime() || t > end.getTime()) continue;
      if (!isPhysicalCashMethod(p.method)) continue;
      const amt = Number(p.amount || 0);
      if (!Number.isFinite(amt) || amt <= 0) continue;
      total = round2(total + amt);
      count += 1;
    }
  }

  return {
    clientOrderCashDrawerTotal: total,
    clientOrderCashDrawerPaymentCount: count,
  };
}

/** Refund allocation for restored invoices (same split as original payments when possible). */
function refundAllocationFromOrder(order) {
  const pays = order.payments || [];
  const map = {};
  if (pays.length) {
    for (const p of pays) {
      const m = normalizePayMethod(p.method);
      map[m] = round2((map[m] || 0) + Number(p.amount || 0));
    }
    return map;
  }
  const m = normalizePayMethod(order.paymentMethod);
  map[m] = round2(Number(order.amountPaid || 0));
  return map;
}

async function refundsByMethod(branchOid, start, end) {
  const restored = await Order.find({
    branch: branchOid,
    status: 'restored',
    restoredAt: { $gte: start, $lte: end },
  })
    .select('payments amountPaid paymentMethod orderNumber')
    .lean();

  let merged = {};
  for (const o of restored) {
    merged = mergeAmounts(merged, refundAllocationFromOrder(o));
  }
  return { merged, count: restored.length };
}

async function invoiceCountForDay(branchOid, start, end) {
  return Order.countDocuments({
    branch: branchOid,
    status: 'completed',
    createdAt: { $gte: start, $lte: end },
  });
}

/** Daily expenses: only cash-treasury portions reduce expected drawer cash. */
async function sumDailyExpensesCashDrawer(branchOid, start, end) {
  const rows = await DailyExpense.find({
    branch: branchOid,
    createdAt: { $gte: start, $lte: end },
  })
    .select('amount expenseTreasuryKey expenseTreasuryLabel expenseTreasurySplits')
    .lean();
  return sumCashDrawerOutflowFromExpenses(rows);
}

/**
 * Desk purchase / trade-in — cost × qty split by purchase treasury.
 * Only `cash` bucket reduces physical drawer expected balance.
 */
async function deskPurchaseTreasuryBreakdown(branchOid, start, end) {
  const rows = await ProductPurchaseRequest.find({
    branch: branchOid,
    createdAt: { $gte: start, $lte: end },
    status: { $ne: 'rejected' },
  })
    .select(
      'quantity productPayload purchaseTreasuryKey purchaseTreasuryLabel purchaseTreasurySplits status'
    )
    .lean();

  const byKey = aggregateTreasuryAmountsFromPurchases(rows);
  let grandTotal = 0;
  for (const r of rows) {
    for (const s of resolvePurchaseTreasurySplits(r)) {
      grandTotal = round2(grandTotal + s.amount);
    }
  }
  const cashDrawerTotal = sumCashDrawerOutflowFromPurchases(rows);

  const deskPurchaseByTreasuryMethod = Object.values(byKey).sort((a, b) =>
    String(a.key).localeCompare(String(b.key))
  );

  return {
    deskPurchaseCashDrawerTotal: cashDrawerTotal,
    deskPurchaseGrandTotal: grandTotal,
    deskPurchaseByTreasuryMethod,
    deskPurchaseIntakeCount: rows.length,
  };
}

function sumMethods(map, filterFn) {
  let s = 0;
  for (const [method, amt] of Object.entries(map || {})) {
    if (filterFn(method)) s = round2(s + Number(amt || 0));
  }
  return s;
}

export async function computeDrawerPreview(branchOid, bounds) {
  const { start, end } = bounds;

  const [
    paymentsIn,
    refundInfo,
    invoices,
    expenseTotal,
    deskInfo,
    vendorCashInfo,
    clientCashInfo,
  ] = await Promise.all([
    paymentsReceivedByMethod(branchOid, start, end),
    refundsByMethod(branchOid, start, end),
    invoiceCountForDay(branchOid, start, end),
    sumDailyExpensesCashDrawer(branchOid, start, end),
    deskPurchaseTreasuryBreakdown(branchOid, start, end),
    sumVendorCashDrawerOutflows(branchOid, start, end),
    sumClientCreditOrderCashPayments(branchOid, start, end),
  ]);

  const cashReceived = sumMethods(paymentsIn, isPhysicalCashMethod);
  const cashRefunded = sumMethods(refundInfo.merged, isPhysicalCashMethod);

  const deskCashFromDrawer = deskInfo.deskPurchaseCashDrawerTotal;
  const vendorCashFromDrawer = vendorCashInfo.vendorCashDrawerTotal;
  const periodNetCashMovements = round2(
    cashReceived - cashRefunded - expenseTotal - deskCashFromDrawer - vendorCashFromDrawer
  );

  return {
    paymentsReceivedByMethod: paymentsIn,
    refundsByMethod: refundInfo.merged,
    restoredInvoiceCount: refundInfo.count,
    invoiceCount: invoices,
    dailyExpenseTotal: expenseTotal,
    /** @deprecated use deskPurchaseCashDrawerTotal — kept as alias (cash drawer portion only). */
    deskPurchaseCashOutTotal: deskCashFromDrawer,
    deskPurchaseCashDrawerTotal: deskCashFromDrawer,
    deskPurchaseGrandTotal: deskInfo.deskPurchaseGrandTotal,
    deskPurchaseByTreasuryMethod: deskInfo.deskPurchaseByTreasuryMethod,
    deskPurchaseIntakeCount: deskInfo.deskPurchaseIntakeCount,
    vendorCashDrawerTotal: vendorCashFromDrawer,
    vendorCashDrawerPaymentCount: vendorCashInfo.vendorCashDrawerPaymentCount,
    clientOrderCashDrawerTotal: clientCashInfo.clientOrderCashDrawerTotal,
    clientOrderCashDrawerPaymentCount: clientCashInfo.clientOrderCashDrawerPaymentCount,
    cashReceivedTotal: cashReceived,
    cashRefundedTotal: cashRefunded,
    periodNetCashMovements,
    /** Net movements only (no opening balance); use computeDrawerPreviewWithPeriod for full expected. */
    expectedCashInDrawer: periodNetCashMovements,
  };
}

export const previewDrawerClose = async (req, res) => {
  try {
    const { userId, branch, date } = req.query;

    const actor = await loadActor(userId);
    if (!canUseDrawerClose(actor)) {
      return res.status(403).json({ error: 'Not allowed to preview drawer close' });
    }

    if (!branch || !mongoose.Types.ObjectId.isValid(String(branch))) {
      return res.status(400).json({ error: 'Valid branch is required' });
    }

    if (!actorMayUseBranch(actor, String(branch))) {
      return res.status(403).json({ error: 'Cannot preview drawer for this branch' });
    }

    const dateStr = String(date || '').trim();
    if (!parseBusinessDay(dateStr)) {
      return res.status(400).json({ error: 'Valid date (YYYY-MM-DD) is required' });
    }

    const branchDoc = await Branch.findById(branch).select('_id').lean();
    if (!branchDoc) {
      return res.status(400).json({ error: 'Branch not found' });
    }

    const branchOid = new mongoose.Types.ObjectId(String(branch));
    const preview = await computeDrawerPreviewWithPeriod(branchOid, dateStr);

    res.json({
      businessDate: dateStr,
      branchId: String(branch),
      ...preview,
    });
  } catch (err) {
    console.error('❌ previewDrawerClose:', err.message);
    res.status(500).json({ error: 'Failed to preview drawer close' });
  }
};

const VARIANCE_EPS = 0.02;

export const getDrawerOpeningBalance = async (req, res) => {
  try {
    const { userId, branch, date } = req.query;

    const actor = await loadActor(userId);
    if (!canUseDrawerClose(actor)) {
      return res.status(403).json({ error: 'Not allowed to view drawer opening balance' });
    }

    if (!branch || !mongoose.Types.ObjectId.isValid(String(branch))) {
      return res.status(400).json({ error: 'Valid branch is required' });
    }

    if (!actorMayUseBranch(actor, String(branch))) {
      return res.status(403).json({ error: 'Cannot view opening balance for this branch' });
    }

    const dateStr = String(date || '').trim();
    if (!parseBusinessDay(dateStr)) {
      return res.status(400).json({ error: 'Valid date (YYYY-MM-DD) is required' });
    }

    const branchOid = new mongoose.Types.ObjectId(String(branch));
    const period = await resolveClosePeriod(branchOid, dateStr);
    const overlap = await periodOverlapsExisting(
      branchOid,
      period.periodStartDate,
      period.periodEndDate
    );

    res.json({
      branchId: String(branch),
      businessDate: dateStr,
      openingCashBalance: period.openingCashBalance,
      periodStartDate: period.periodStartDate,
      periodEndDate: period.periodEndDate,
      missedDaysCount: period.missedDaysCount,
      periodAlreadyClosed: Boolean(overlap),
    });
  } catch (err) {
    console.error('❌ getDrawerOpeningBalance:', err.message);
    res.status(500).json({ error: 'Failed to get drawer opening balance' });
  }
};

export const closeDrawer = async (req, res) => {
  try {
    const {
      branch,
      businessDate,
      userId,
      actualCashCounted,
      shortageReason,
      cashDisposition,
      retainedCash: retainedCashRaw,
    } = req.body || {};

    const actor = await loadActor(userId);
    if (!canUseDrawerClose(actor)) {
      return res.status(403).json({ error: 'Not allowed to close drawer' });
    }

    if (!branch || !mongoose.Types.ObjectId.isValid(String(branch))) {
      return res.status(400).json({ error: 'Valid branch is required' });
    }

    if (!actorMayUseBranch(actor, String(branch))) {
      return res.status(403).json({ error: 'Cannot close drawer for this branch' });
    }

    const dateStr = String(businessDate || '').trim();
    if (!parseBusinessDay(dateStr)) {
      return res.status(400).json({ error: 'Valid businessDate (YYYY-MM-DD) is required' });
    }

    const branchDoc = await Branch.findById(branch).select('_id').lean();
    if (!branchDoc) {
      return res.status(400).json({ error: 'Branch not found' });
    }

    const actual = round2(actualCashCounted);
    if (!Number.isFinite(actual) || actual < 0) {
      return res.status(400).json({ error: 'Valid actualCashCounted is required' });
    }

    const cashResult = resolveCashDisposition(actual, cashDisposition, retainedCashRaw);
    if (cashResult.error) {
      return res.status(400).json({ error: cashResult.error });
    }

    const branchOid = new mongoose.Types.ObjectId(String(branch));
    const period = await resolveClosePeriod(branchOid, dateStr);

    const overlap = await periodOverlapsExisting(
      branchOid,
      period.periodStartDate,
      period.periodEndDate
    );
    if (overlap) {
      return res.status(409).json({
        error: 'Drawer already closed for one or more days in this period',
        conflictingDate: overlap.businessDate,
      });
    }

    const preview = await computeDrawerPreviewWithPeriod(branchOid, dateStr);
    const expected = preview.expectedCashInDrawer;
    const variance = round2(actual - expected);

    const shortage = variance < -VARIANCE_EPS;
    const surplus = variance > VARIANCE_EPS;
    const reasonTrim = String(shortageReason || '').trim();
    if (shortage && !reasonTrim) {
      return res.status(400).json({ error: 'Shortage reason is required when counted cash is below expected' });
    }
    if (surplus && !reasonTrim) {
      return res.status(400).json({ error: 'Surplus reason is required when counted cash is above expected' });
    }

    let doc;
    try {
      doc = await DrawerClose.create({
        branch: branchOid,
        businessDate: dateStr,
        periodStartDate: preview.periodStartDate,
        periodEndDate: preview.periodEndDate,
        openingCashBalance: preview.openingCashBalance,
        periodNetCashMovements: preview.periodNetCashMovements,
        snapshot: {
          ...preview,
          businessDate: dateStr,
          branchId: String(branch),
        },
        expectedCashInDrawer: expected,
        actualCashCounted: actual,
        variance,
        shortageReason: shortage || surplus ? reasonTrim.slice(0, 2000) : '',
        cashDisposition: cashResult.disposition,
        retainedCash: cashResult.retained,
        depositedCash: cashResult.deposited,
        closedBy: userId,
      });
    } catch (e) {
      if (e?.code === 11000) {
        return res.status(409).json({ error: 'Drawer already closed for this day' });
      }
      throw e;
    }

    const populated = normalizeDrawerCloseRow(
      await DrawerClose.findById(doc._id)
        .populate('branch', 'name')
        .populate('closedBy', 'name email role')
        .lean()
    );

    res.status(201).json(populated);
  } catch (err) {
    console.error('❌ closeDrawer:', err.message);
    res.status(500).json({ error: 'Failed to close drawer' });
  }
};

function canListDrawerHistory(actor) {
  if (!actor) return false;
  return ADMIN_ROLES.includes(actor.role) || actor.role === 'Branch Manager' || actor.role === 'Cashier';
}

export const listDrawerCloses = async (req, res) => {
  try {
    const {
      viewerUserId,
      page = 1,
      limit = 20,
      branch_id: branchIdRaw,
      dateFrom,
      dateTo,
    } = req.query;

    if (!viewerUserId || !mongoose.Types.ObjectId.isValid(String(viewerUserId))) {
      return res.status(400).json({ error: 'viewerUserId is required' });
    }

    const viewer = await User.findById(viewerUserId).select('role branch').lean();
    if (!canListDrawerHistory(viewer)) {
      return res.status(403).json({ error: 'Not allowed to view drawer history' });
    }

    const query = {};

    if (ADMIN_ROLES.includes(viewer.role)) {
      if (branchIdRaw && mongoose.Types.ObjectId.isValid(String(branchIdRaw))) {
        query.branch = new mongoose.Types.ObjectId(String(branchIdRaw));
      }
    } else if ((viewer.role === 'Branch Manager' || viewer.role === 'Cashier') && viewer.branch) {
      query.branch = viewer.branch;
    } else {
      return res.status(403).json({ error: 'Not allowed to view drawer history' });
    }

    if (dateFrom || dateTo) {
      const bd = {};
      if (dateFrom) bd.$gte = String(dateFrom).trim();
      if (dateTo) bd.$lte = String(dateTo).trim();
      query.businessDate = bd;
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [rows, total] = await Promise.all([
      DrawerClose.find(query)
        .populate('branch', 'name')
        .populate('closedBy', 'name email role')
        .sort({ businessDate: -1, createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      DrawerClose.countDocuments(query),
    ]);

    const totalPages = Math.ceil(total / Number(limit)) || 1;

    res.json({
      closes: rows.map(normalizeDrawerCloseRow),
      meta: {
        currentPage: Number(page),
        totalCount: total,
        totalPages,
        nextPage: Number(page) < totalPages ? Number(page) + 1 : null,
        prevPage: Number(page) > 1 ? Number(page) - 1 : null,
      },
    });
  } catch (err) {
    console.error('❌ listDrawerCloses:', err.message);
    res.status(500).json({ error: 'Failed to list drawer closes' });
  }
};
