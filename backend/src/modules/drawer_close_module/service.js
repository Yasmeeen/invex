import mongoose from 'mongoose';
import Order from '../../DB/models/order.model.js';
import DailyExpense from '../../DB/models/dailyExpense.model.js';
import ProductPurchaseRequest from '../../DB/models/productPurchaseRequest.model.js';
import DrawerClose from '../../DB/models/drawerClose.model.js';
import Branch from '../../DB/models/branch.model.js';
import User from '../../DB/models/user.model.js';

const ADMIN_ROLES = ['Super Admin', 'Co Admin'];

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
  const parts = raw.split('-');
  if (parts.length !== 3) return null;
  const y = Number(parts[0]);
  const mo = Number(parts[1]);
  const d = Number(parts[2]);
  if (!y || !mo || !d) return null;
  const start = new Date(y, mo - 1, d, 0, 0, 0, 0);
  const end = new Date(y, mo - 1, d, 23, 59, 59, 999);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return { start, end };
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
      const m = normalizePayMethod(p.method);
      byMethod[m] = round2((byMethod[m] || 0) + Number(p.amount || 0));
    }
  }
  return byMethod;
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

async function sumDailyExpenses(branchOid, start, end) {
  const [agg] = await DailyExpense.aggregate([
    {
      $match: {
        branch: branchOid,
        createdAt: { $gte: start, $lte: end },
      },
    },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ]);
  return round2(agg?.total || 0);
}

/** Desk purchase / trade-in intake — assumed paid from drawer (cost × qty). */
async function deskPurchaseCashOut(branchOid, start, end) {
  const rows = await ProductPurchaseRequest.find({
    branch: branchOid,
    createdAt: { $gte: start, $lte: end },
  })
    .select('quantity productPayload')
    .lean();

  let total = 0;
  for (const r of rows) {
    const q = Math.max(1, Math.floor(Number(r.quantity) || 1));
    const net = round2(Number(r.productPayload?.netPrice || 0));
    total = round2(total + net * q);
  }
  return { total, intakeCount: rows.length };
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
  ] = await Promise.all([
    paymentsReceivedByMethod(branchOid, start, end),
    refundsByMethod(branchOid, start, end),
    invoiceCountForDay(branchOid, start, end),
    sumDailyExpenses(branchOid, start, end),
    deskPurchaseCashOut(branchOid, start, end),
  ]);

  const cashReceived = sumMethods(paymentsIn, isPhysicalCashMethod);
  const cashRefunded = sumMethods(refundInfo.merged, isPhysicalCashMethod);

  const expectedCashInDrawer = round2(cashReceived - cashRefunded - expenseTotal - deskInfo.total);

  return {
    paymentsReceivedByMethod: paymentsIn,
    refundsByMethod: refundInfo.merged,
    restoredInvoiceCount: refundInfo.count,
    invoiceCount: invoices,
    dailyExpenseTotal: expenseTotal,
    deskPurchaseCashOutTotal: deskInfo.total,
    deskPurchaseIntakeCount: deskInfo.intakeCount,
    cashReceivedTotal: cashReceived,
    cashRefundedTotal: cashRefunded,
    expectedCashInDrawer,
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

    const bounds = parseBusinessDay(date || '');
    if (!bounds) {
      return res.status(400).json({ error: 'Valid date (YYYY-MM-DD) is required' });
    }

    const branchDoc = await Branch.findById(branch).select('_id').lean();
    if (!branchDoc) {
      return res.status(400).json({ error: 'Branch not found' });
    }

    const branchOid = new mongoose.Types.ObjectId(String(branch));
    const preview = await computeDrawerPreview(branchOid, bounds);

    res.json({
      businessDate: String(date || '').trim(),
      branchId: String(branch),
      ...preview,
    });
  } catch (err) {
    console.error('❌ previewDrawerClose:', err.message);
    res.status(500).json({ error: 'Failed to preview drawer close' });
  }
};

const VARIANCE_EPS = 0.02;

export const closeDrawer = async (req, res) => {
  try {
    const { branch, businessDate, userId, actualCashCounted, shortageReason } = req.body || {};

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
    const bounds = parseBusinessDay(dateStr);
    if (!bounds) {
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

    const branchOid = new mongoose.Types.ObjectId(String(branch));
    const preview = await computeDrawerPreview(branchOid, bounds);
    const expected = preview.expectedCashInDrawer;
    const variance = round2(actual - expected);

    const shortage = variance < -VARIANCE_EPS;
    const reasonTrim = String(shortageReason || '').trim();
    if (shortage && !reasonTrim) {
      return res.status(400).json({ error: 'Shortage reason is required when counted cash is below expected' });
    }

    const existing = await DrawerClose.findOne({ branch: branchOid, businessDate: dateStr }).select('_id').lean();
    if (existing) {
      return res.status(409).json({ error: 'Drawer already closed for this day' });
    }

    let doc;
    try {
      doc = await DrawerClose.create({
        branch: branchOid,
        businessDate: dateStr,
        snapshot: {
          ...preview,
          businessDate: dateStr,
          branchId: String(branch),
        },
        expectedCashInDrawer: expected,
        actualCashCounted: actual,
        variance,
        shortageReason: shortage ? reasonTrim.slice(0, 2000) : '',
        closedBy: userId,
      });
    } catch (e) {
      if (e?.code === 11000) {
        return res.status(409).json({ error: 'Drawer already closed for this day' });
      }
      throw e;
    }

    const populated = await DrawerClose.findById(doc._id)
      .populate('branch', 'name')
      .populate('closedBy', 'name email role')
      .lean();

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
      closes: rows,
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
