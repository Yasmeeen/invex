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
import { sumVendorCashDrawerInflows } from '../../utils/vendor-cash-drawer-inflow.js';
import { sumClientCashDrawerInflows } from '../../utils/client-cash-drawer.js';
import { refundAllocationFromReturnRecord, salesReturnTreasuryRefundLines } from '../../utils/order-return.js';
import { refundTreasuryCashFromReturnRecord } from '../../utils/purchase-return.js';
import { sumCashTransferNet } from '../../utils/treasury-ledger.js';

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

async function getLatestDrawerClose(branchOid) {
  return DrawerClose.findOne({ branch: branchOid })
    .sort({ periodEndDate: -1, businessDate: -1, createdAt: -1 })
    .lean();
}

/** Drawer close record whose period includes targetDateStr (YYYY-MM-DD). */
async function findCloseCoveringDate(branchOid, targetDateStr) {
  return DrawerClose.findOne({
    branch: branchOid,
    $or: [
      {
        periodStartDate: { $lte: targetDateStr },
        periodEndDate: { $gte: targetDateStr },
      },
      {
        periodStartDate: { $exists: false },
        businessDate: targetDateStr,
      },
    ],
  })
    .sort({ periodEndDate: -1, businessDate: -1, createdAt: -1 })
    .lean();
}

function todayBusinessDateStr() {
  return moment.tz(DRAWER_BUSINESS_TZ).format('YYYY-MM-DD');
}

async function resolveClosePeriod(branchOid, targetDateStr) {
  const covering = await findCloseCoveringDate(branchOid, targetDateStr);
  const lastClose = await getLatestDrawerClose(branchOid);
  let openingCashBalance = 0;
  let periodStartDate = targetDateStr;
  const periodAlreadyClosed = Boolean(covering);

  if (lastClose) {
    const lastEnd = lastClose.periodEndDate || lastClose.businessDate;
    openingCashBalance = round2(Number(lastClose.retainedCash ?? 0));
    periodStartDate = dayAfter(lastEnd);
  }

  const periodEndDate = targetDateStr;
  const bounds =
    periodAlreadyClosed || periodStartDate > periodEndDate
      ? null
      : parseBusinessPeriod(periodStartDate, periodEndDate);
  const missedDaysCount =
    bounds && !periodAlreadyClosed ? countDaysInclusive(periodStartDate, periodEndDate) : 0;

  return {
    openingCashBalance,
    periodStartDate,
    periodEndDate,
    bounds,
    missedDaysCount,
    periodAlreadyClosed,
  };
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
    const partialOk =
      actualR > 0
        ? Number.isFinite(retained) && retained > 0 && retained < actualR
        : actualR < 0
          ? Number.isFinite(retained) && retained < 0 && retained > actualR
          : false;
    if (!partialOk) {
      return {
        error:
          'For retain_partial, retainedCash must be between 0 and actualCashCounted (same sign as actual)',
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

/** Drawer branch for a payment line: explicit collection branch, else invoice branch. */
function paymentDrawerBranch(payment, order) {
  return payment?.branch || order?.branch || null;
}

function paymentBelongsToBranch(payment, order, branchOid) {
  const b = paymentDrawerBranch(payment, order);
  return b && String(b) === String(branchOid);
}

/** Payments received into the branch today (split lines), grouped by method. */
async function paymentsReceivedByMethod(branchOid, start, end) {
  const orders = await Order.find({
    payments: { $elemMatch: { paidAt: { $gte: start, $lte: end } } },
  })
    .select('payments branch')
    .lean();

  const byMethod = {};
  for (const o of orders) {
    for (const p of o.payments || []) {
      const t = p.paidAt ? new Date(p.paidAt).getTime() : NaN;
      if (Number.isNaN(t) || t < start.getTime() || t > end.getTime()) continue;
      if (!paymentBelongsToBranch(p, o, branchOid)) continue;
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
    paymentMethod: 'credit',
    partyType: { $ne: 'supplier' },
    payments: { $elemMatch: { paidAt: { $gte: start, $lte: end } } },
  })
    .select('payments branch')
    .lean();

  let total = 0;
  let count = 0;
  for (const o of orders) {
    for (const p of o.payments || []) {
      const t = p.paidAt ? new Date(p.paidAt).getTime() : NaN;
      if (Number.isNaN(t) || t < start.getTime() || t > end.getTime()) continue;
      if (!paymentBelongsToBranch(p, o, branchOid)) continue;
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
  const [legacyRestored, withReturns] = await Promise.all([
    Order.find({
      branch: branchOid,
      status: 'restored',
      restoredAt: { $gte: start, $lte: end },
      $or: [{ returns: { $exists: false } }, { returns: { $size: 0 } }],
    })
      .select('payments amountPaid paymentMethod orderNumber')
      .lean(),
    Order.find({
      branch: branchOid,
      'returns.returnedAt': { $gte: start, $lte: end },
    })
      .select('returns orderNumber')
      .lean(),
  ]);

  let merged = {};
  let count = 0;

  for (const o of legacyRestored) {
    merged = mergeAmounts(merged, refundAllocationFromOrder(o));
    count += 1;
  }

  for (const o of withReturns) {
    for (const ret of o.returns || []) {
      const t = ret.returnedAt ? new Date(ret.returnedAt).getTime() : NaN;
      if (Number.isNaN(t) || t < start.getTime() || t > end.getTime()) continue;
      merged = mergeAmounts(merged, refundAllocationFromReturnRecord(ret));
      count += 1;
    }
  }

  return { merged, count };
}

/** Sales returns refunded via purchase treasury (informational — does not reduce drawer cash). */
async function salesReturnRefundsByTreasury(branchOid, start, end) {
  const orders = await Order.find({
    branch: branchOid,
    'returns.returnedAt': { $gte: start, $lte: end },
  })
    .select('returns')
    .lean();

  const byKey = {};
  for (const o of orders) {
    for (const ret of o.returns || []) {
      const t = ret.returnedAt ? new Date(ret.returnedAt).getTime() : NaN;
      if (Number.isNaN(t) || t < start.getTime() || t > end.getTime()) continue;
      for (const line of salesReturnTreasuryRefundLines(ret)) {
        if (!byKey[line.key]) {
          byKey[line.key] = { key: line.key, label: line.label, total: 0, count: 0 };
        }
        byKey[line.key].total = round2(byKey[line.key].total + line.amount);
        byKey[line.key].count += 1;
      }
    }
  }

  return Object.values(byKey).sort((a, b) => String(a.key).localeCompare(String(b.key)));
}

async function sumPurchaseReturnCashDrawerInflow(branchOid, start, end) {
  const rows = await ProductPurchaseRequest.find({
    branch: branchOid,
    'returns.returnedAt': { $gte: start, $lte: end },
  })
    .select('returns')
    .lean();

  let total = 0;
  let count = 0;
  for (const r of rows) {
    for (const ret of r.returns || []) {
      const t = ret.returnedAt ? new Date(ret.returnedAt).getTime() : NaN;
      if (Number.isNaN(t) || t < start.getTime() || t > end.getTime()) continue;
      const cash = refundTreasuryCashFromReturnRecord(ret);
      if (cash > 0) {
        total = round2(total + cash);
        count += 1;
      }
    }
  }
  return { purchaseReturnCashDrawerTotal: total, purchaseReturnCashDrawerCount: count };
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
      'quantity productPayload purchaseTreasuryKey purchaseTreasuryLabel purchaseTreasurySplits exchangeSettlementSplits isExchangeTradeIn status'
    )
    .lean();

  const byKey = aggregateTreasuryAmountsFromPurchases(rows);
  let grandTotal = 0;
  for (const r of rows) {
    const q = Math.max(1, Math.floor(Number(r?.quantity) || 1));
    const net = Number(r?.productPayload?.netPrice) || 0;
    grandTotal = round2(grandTotal + net * q);
  }
  const cashDrawerTotal = sumCashDrawerOutflowFromPurchases(rows);

  const deskPurchaseByTreasuryMethod = Object.values(byKey).sort((a, b) =>
    String(a.key).localeCompare(String(b.key))
  );

  const deskPurchaseDevices = rows.map((r) => {
    const pp = r.productPayload || {};
    const q = Math.max(1, Math.floor(Number(r.quantity) || 1));
    const net = round2(Number(pp.netPrice) || 0);
    const codes = Array.isArray(pp.unitCodes) && pp.unitCodes.length
      ? pp.unitCodes.map((c) => String(c || '').trim()).filter(Boolean)
      : [String(pp.code || '').trim()].filter(Boolean);
    return {
      name: String(pp.name || '').trim(),
      codes,
      quantity: q,
      unitNetPrice: net,
      lineTotal: round2(net * q),
      isExchangeTradeIn: !!r.isExchangeTradeIn,
    };
  });

  return {
    deskPurchaseCashDrawerTotal: cashDrawerTotal,
    deskPurchaseGrandTotal: grandTotal,
    deskPurchaseByTreasuryMethod,
    deskPurchaseIntakeCount: rows.length,
    deskPurchaseDevices,
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
    salesTreasuryRefunds,
    invoices,
    expenseTotal,
    deskInfo,
    vendorCashInfo,
    vendorCashInflowInfo,
    clientCashInfo,
    clientDepositCashInfo,
    purchaseReturnInfo,
  ] = await Promise.all([
    paymentsReceivedByMethod(branchOid, start, end),
    refundsByMethod(branchOid, start, end),
    salesReturnRefundsByTreasury(branchOid, start, end),
    invoiceCountForDay(branchOid, start, end),
    sumDailyExpensesCashDrawer(branchOid, start, end),
    deskPurchaseTreasuryBreakdown(branchOid, start, end),
    sumVendorCashDrawerOutflows(branchOid, start, end),
    sumVendorCashDrawerInflows(branchOid, start, end),
    sumClientCreditOrderCashPayments(branchOid, start, end),
    sumClientCashDrawerInflows(branchOid, start, end),
    sumPurchaseReturnCashDrawerInflow(branchOid, start, end),
  ]);

  const cashTransferNet = await sumCashTransferNet({
    branchId: branchOid,
    start,
    end,
  });

  const cashReceived = sumMethods(paymentsIn, isPhysicalCashMethod);
  const cashRefunded = sumMethods(refundInfo.merged, isPhysicalCashMethod);

  const deskCashFromDrawer = deskInfo.deskPurchaseCashDrawerTotal;
  const vendorCashFromDrawer = vendorCashInfo.vendorCashDrawerTotal;
  const vendorCashInDrawer = vendorCashInflowInfo.vendorCashDrawerInflowTotal;
  const clientDepositCashIn = clientDepositCashInfo.clientDepositCashDrawerTotal;
  const purchaseReturnCashIn = purchaseReturnInfo.purchaseReturnCashDrawerTotal;
  const periodNetCashMovements = round2(
    cashReceived -
      cashRefunded -
      expenseTotal -
      deskCashFromDrawer -
      vendorCashFromDrawer +
      vendorCashInDrawer +
      clientDepositCashIn +
      purchaseReturnCashIn +
      cashTransferNet
  );

  return {
    paymentsReceivedByMethod: paymentsIn,
    refundsByMethod: refundInfo.merged,
    salesReturnRefundsByTreasury: salesTreasuryRefunds,
    restoredInvoiceCount: refundInfo.count,
    invoiceCount: invoices,
    dailyExpenseTotal: expenseTotal,
    /** @deprecated use deskPurchaseCashDrawerTotal — kept as alias (cash drawer portion only). */
    deskPurchaseCashOutTotal: deskCashFromDrawer,
    deskPurchaseCashDrawerTotal: deskCashFromDrawer,
    deskPurchaseGrandTotal: deskInfo.deskPurchaseGrandTotal,
    deskPurchaseByTreasuryMethod: deskInfo.deskPurchaseByTreasuryMethod,
    deskPurchaseIntakeCount: deskInfo.deskPurchaseIntakeCount,
    deskPurchaseDevices: deskInfo.deskPurchaseDevices || [],
    vendorCashDrawerTotal: vendorCashFromDrawer,
    vendorCashDrawerPaymentCount: vendorCashInfo.vendorCashDrawerPaymentCount,
    vendorCashDrawerInflowTotal: vendorCashInDrawer,
    vendorCashDrawerInflowCount: vendorCashInflowInfo.vendorCashDrawerInflowCount,
    clientOrderCashDrawerTotal: clientCashInfo.clientOrderCashDrawerTotal,
    clientOrderCashDrawerPaymentCount: clientCashInfo.clientOrderCashDrawerPaymentCount,
    clientDepositCashDrawerTotal: clientDepositCashInfo.clientDepositCashDrawerTotal,
    clientDepositCashDrawerCount: clientDepositCashInfo.clientDepositCashDrawerCount,
    cashReceivedTotal: cashReceived,
    cashRefundedTotal: cashRefunded,
    /** Net of cash↔account transfers / settlements in the period. */
    cashTransferNet,
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
    const period = await resolveClosePeriod(branchOid, dateStr);

    if (period.periodAlreadyClosed) {
      return res.json({
        businessDate: dateStr,
        branchId: String(branch),
        periodStartDate: period.periodStartDate,
        periodEndDate: period.periodEndDate,
        missedDaysCount: 0,
        openingCashBalance: 0,
        periodNetCashMovements: 0,
        expectedCashInDrawer: 0,
        paymentsReceivedByMethod: {},
        refundsByMethod: {},
        salesReturnRefundsByTreasury: [],
        restoredInvoiceCount: 0,
        invoiceCount: 0,
        dailyExpenseTotal: 0,
        deskPurchaseCashOutTotal: 0,
        deskPurchaseCashDrawerTotal: 0,
        deskPurchaseIntakeCount: 0,
        deskPurchaseDevices: [],
        cashReceivedTotal: 0,
        cashRefundedTotal: 0,
        cashTransferNet: 0,
        periodAlreadyClosed: true,
      });
    }

    const preview = await computeDrawerPreviewWithPeriod(branchOid, dateStr);

    res.json({
      businessDate: dateStr,
      branchId: String(branch),
      periodAlreadyClosed: false,
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
    const covering = await findCloseCoveringDate(branchOid, dateStr);

    res.json({
      branchId: String(branch),
      businessDate: dateStr,
      openingCashBalance: covering ? 0 : period.openingCashBalance,
      periodStartDate: period.periodStartDate,
      periodEndDate: period.periodEndDate,
      missedDaysCount: period.missedDaysCount,
      periodAlreadyClosed: Boolean(covering),
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
    if (!Number.isFinite(actual)) {
      return res.status(400).json({ error: 'Valid actualCashCounted is required' });
    }

    const cashResult = resolveCashDisposition(actual, cashDisposition, retainedCashRaw);
    if (cashResult.error) {
      return res.status(400).json({ error: cashResult.error });
    }

    const branchOid = new mongoose.Types.ObjectId(String(branch));
    const period = await resolveClosePeriod(branchOid, dateStr);

    if (period.periodAlreadyClosed) {
      return res.status(409).json({
        error: 'Drawer already closed for this business day',
      });
    }

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

export const reopenLastDrawerClose = async (req, res) => {
  try {
    const { userId, branch, date: dateRaw } = req.query;

    const actor = await loadActor(userId);
    if (!canUseDrawerClose(actor)) {
      return res.status(403).json({ error: 'Not allowed to reopen drawer' });
    }

    if (!branch || !mongoose.Types.ObjectId.isValid(String(branch))) {
      return res.status(400).json({ error: 'Valid branch is required' });
    }

    if (!actorMayUseBranch(actor, String(branch))) {
      return res.status(403).json({ error: 'Cannot reopen drawer for this branch' });
    }

    const dateStr = String(dateRaw || '').trim() || todayBusinessDateStr();
    if (!parseBusinessDay(dateStr)) {
      return res.status(400).json({ error: 'Valid date (YYYY-MM-DD) is required' });
    }

    const branchOid = new mongoose.Types.ObjectId(String(branch));
    const covering = await findCloseCoveringDate(branchOid, dateStr);
    const latest = covering || (await getLatestDrawerClose(branchOid));
    if (!latest) {
      return res.status(404).json({ error: 'No drawer close found for this branch' });
    }

    const removed = normalizeDrawerCloseRow(latest);
    await DrawerClose.findByIdAndDelete(latest._id);

    res.json({
      success: true,
      removed,
    });
  } catch (err) {
    console.error('❌ reopenLastDrawerClose:', err.message);
    res.status(500).json({ error: 'Failed to reopen drawer' });
  }
};

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
