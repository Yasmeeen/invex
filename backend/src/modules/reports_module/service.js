import mongoose from 'mongoose';
import moment from 'moment-timezone';
import Order from '../../DB/models/order.model.js';
import Product from '../../DB/models/product.model.js';
import PurchasingRequest from '../../DB/models/purchasingRequest.model.js';
import StockMovement from '../../DB/models/stockMovement.model.js';
import ProductBooking from '../../DB/models/productBooking.model.js';
import ProductPurchaseRequest from '../../DB/models/productPurchaseRequest.model.js';
import Branch from '../../DB/models/branch.model.js';
import Vendor from '../../DB/models/vendor.model.js';
import Client from '../../DB/models/client.model.js';
import User from '../../DB/models/user.model.js';
import DailyExpense from '../../DB/models/dailyExpense.model.js';
import TreasuryLedgerEntry from '../../DB/models/treasuryLedgerEntry.model.js';
import TreasuryAccountOpening from '../../DB/models/treasuryAccountOpening.model.js';
import { getEffectiveMoneyAccountsFromDb } from '../settings_module/moneyAccounts.js';
import { buildPhoneSearchCandidates, digitsOnly } from '../../utils/phone-utils.js';
import {
  aggregateTreasuryAmountsFromPurchases,
  deskPurchaseLineTotal,
  expandDeskPurchaseDetailLines,
  resolvePurchaseTreasurySplits,
} from '../../utils/purchase-treasury-splits.js';
import { NON_OPERATING_DAILY_EXPENSE_TYPES } from '../../utils/daily-expense-categories.js';
import { companyOpeningForAccount, isCashDrawerAccount } from '../../utils/treasury-ledger.js';
import { getCurrentDrawerCash, sumCurrentDrawerCashAllBranches } from '../drawer_close_module/service.js';
import {
  deferredPurchaseRemaining,
  unpaidInstallmentsTotal,
} from '../../utils/vendor-purchase-ledger.js';

/** Business calendar for report date filters (matches orders/dashboard). */
const REPORT_TZ = 'Africa/Cairo';

/** Monthly branch fixed costs (rent + salaries + invoices + expenses) spread over this many days for daily rate. */
const BRANCH_OVERHEAD_MONTHLY_DAYS = 30;

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

function branchMonthlyFixed(doc) {
  if (!doc) {
    return { total: 0, rent: 0, employeesSalary: 0, branchInvoices: 0, expenses: 0 };
  }
  const rent = Number(doc.rent) || 0;
  const employeesSalary = Number(doc.employeesSalary) || 0;
  const branchInvoices = Number(doc.branchInvoices) || 0;
  const expenses = Number(doc.expenses) || 0;
  return {
    total: rent + employeesSalary + branchInvoices + expenses,
    rent,
    employeesSalary,
    branchInvoices,
    expenses,
  };
}

async function getBranchOverheadForReport(branchIdFilter) {
  let branches = [];
  if (branchIdFilter) {
    const b = await Branch.findById(branchIdFilter).lean();
    if (b) branches = [b];
  } else {
    branches = await Branch.find({}).lean();
  }
  const breakdown = { rent: 0, employeesSalary: 0, branchInvoices: 0, expenses: 0 };
  let monthlyTotal = 0;
  for (const br of branches) {
    const m = branchMonthlyFixed(br);
    monthlyTotal += m.total;
    breakdown.rent += m.rent;
    breakdown.employeesSalary += m.employeesSalary;
    breakdown.branchInvoices += m.branchInvoices;
    breakdown.expenses += m.expenses;
  }
  const dailyRate = monthlyTotal / BRANCH_OVERHEAD_MONTHLY_DAYS;
  return { monthlyTotal, dailyRate, breakdown, branchCount: branches.length };
}

/** Operating daily expenses in range (optional branch). Returns total + map period → amount. */
async function getOperatingDailyExpensesForReport({ from, to, branchId, groupBy }) {
  const match = {
    createdAt: { $gte: from, $lte: to },
    expenseType: { $nin: NON_OPERATING_DAILY_EXPENSE_TYPES },
    accountingTreatment: { $nin: ['cash_movement', 'overhead_payment'] },
  };
  if (branchId) match.branch = branchId;

  const [summaryRow] = await DailyExpense.aggregate([
    { $match: match },
    { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
  ]);

  const byPeriodRows = await DailyExpense.aggregate([
    { $match: match },
    {
      $group: {
        _id: getDateGroupExpr(groupBy),
        total: { $sum: '$amount' },
      },
    },
    { $project: { _id: 0, period: '$_id', total: { $round: ['$total', 2] } } },
  ]);

  const byPeriod = new Map();
  for (const row of byPeriodRows || []) {
    byPeriod.set(String(row.period), round2(row.total));
  }

  return {
    total: round2(summaryRow?.total ?? 0),
    count: Number(summaryRow?.count) || 0,
    byPeriod,
  };
}

/** Inclusive calendar days between two dates (local). */
function calendarDaysInclusive(from, to) {
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  const diff = Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
  return Math.max(1, diff);
}

/** Days of a YYYY-MM month overlapping [rangeFrom, rangeTo] (inclusive). */
function daysInMonthOverlappingRange(periodKey, rangeFrom, rangeTo) {
  const parts = String(periodKey).split('-');
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (!y || !m) return 0;
  const monthLastDay = new Date(y, m, 0).getDate();
  const monthStart = new Date(y, m - 1, 1);
  const monthEnd = new Date(y, m - 1, monthLastDay, 23, 59, 59, 999);
  const rf = new Date(rangeFrom.getFullYear(), rangeFrom.getMonth(), rangeFrom.getDate());
  const rt = new Date(rangeTo.getFullYear(), rangeTo.getMonth(), rangeTo.getDate(), 23, 59, 59, 999);
  const overlapFrom = monthStart > rf ? monthStart : rf;
  const overlapEnd = monthEnd < rt ? monthEnd : rt;
  if (overlapFrom > overlapEnd) return 0;
  return calendarDaysInclusive(overlapFrom, overlapEnd);
}

/**
 * Parse a calendar day in Africa/Cairo.
 * IMPORTANT: `new Date('YYYY-MM-DD')` is UTC midnight and shifts the day in Egypt (UTC+2/+3),
 * which drops early-morning sales from “today” filters used by reports and Vixa.
 */
const toDate = (value, fallback, { endOfDay = false } = {}) => {
  const raw = value != null ? String(value).trim() : '';
  if (raw) {
    const day = moment.tz(raw, ['YYYY-MM-DD', moment.ISO_8601], true, REPORT_TZ);
    if (day.isValid()) {
      return (endOfDay ? day.endOf('day') : day.startOf('day')).utc().toDate();
    }
  }
  return fallback;
};

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const parseCustomerPhone = (query) => {
  const v = String(query.customer_phone ?? query.customerPhone ?? '').trim();
  return v.length ? v : null;
};

const parseSupplierPhone = (query) => {
  const v = String(
    query.supplier_phone ?? query.supplierPhone ?? query.vendor_phone ?? query.vendorPhone ?? ''
  ).trim();
  return v.length ? v : null;
};

/** Comma-separated (or repeated) ObjectIds from a query param, e.g. multi-select filters. */
const parseOidCsvList = (raw) => {
  const values = Array.isArray(raw) ? raw : [raw];
  const unique = [];
  for (const value of values) {
    const str = String(value ?? '').trim();
    if (!str || str === 'undefined' || str === 'null') continue;
    for (const part of str.split(',')) {
      const id = part.trim();
      if (mongoose.Types.ObjectId.isValid(id) && !unique.includes(id)) {
        unique.push(id);
      }
    }
  }
  return unique.map((id) => new mongoose.Types.ObjectId(id));
};

const parseSupplierId = (query) => {
  const raw = String(
    query.supplier_id ?? query.supplierId ?? query.vendor_id ?? query.vendorId ?? ''
  ).trim();
  return mongoose.Types.ObjectId.isValid(raw) ? new mongoose.Types.ObjectId(raw) : null;
};

/** Match orders by client ObjectId and/or phone (substring, case-insensitive). */
const appendOrderCustomerFilters = (match, f) => {
  if (f.customerId) match.clientId = f.customerId;
  if (f.customerPhone) {
    match.clientPhoneNumber = { $regex: escapeRegex(f.customerPhone), $options: 'i' };
  }
};

const parseCommonFilters = (query, actor) => {
  const nowCairo = moment.tz(REPORT_TZ);
  const from = toDate(
    query.from,
    nowCairo.clone().startOf('month').startOf('day').utc().toDate(),
    { endOfDay: false }
  );
  const to = toDate(query.to, nowCairo.clone().endOf('day').utc().toDate(), { endOfDay: true });

  const categoryIds = parseOidCsvList(query.category_id ?? query.categoryId);

  const requestedBranchId = mongoose.Types.ObjectId.isValid(String(query.branch_id || ''))
    ? new mongoose.Types.ObjectId(String(query.branch_id))
    : null;
  const actorBranchId =
    actor?.role === 'Branch Manager' &&
    mongoose.Types.ObjectId.isValid(String(actor?.branch || ''))
      ? new mongoose.Types.ObjectId(String(actor.branch))
      : null;

  return {
    from,
    to,
    /** Branch managers are always scoped from the authenticated DB user, never query input. */
    branchId: actorBranchId || requestedBranchId,
    productId: mongoose.Types.ObjectId.isValid(String(query.product_id || ''))
      ? new mongoose.Types.ObjectId(String(query.product_id))
      : null,
    categoryIds,
    categoryId: categoryIds[0] || null,
    customerId: mongoose.Types.ObjectId.isValid(String(query.customer_id || ''))
      ? new mongoose.Types.ObjectId(String(query.customer_id))
      : null,
    customerPhone: parseCustomerPhone(query),
    supplierPhone: parseSupplierPhone(query),
    supplierId: parseSupplierId(query),
    sellerName: String(query.seller_name || '').trim(),
    groupBy: String(query.groupBy || 'daily') === 'monthly' ? 'monthly' : 'daily',
    page: Math.max(1, Number(query.page) || 1),
    limit: Math.max(1, Math.min(200, Number(query.limit) || 20)),
  };
};

/** Order lines store only productId, so categories are matched through their products. */
const resolveCategoryProductIdFilter = async (categoryIds) => {
  if (!categoryIds?.length) return null;
  const productIds = await Product.find({ category: { $in: categoryIds } }).distinct('_id');
  return { $in: productIds };
};

/**
 * When filtering sales by product/category, measure matching lines only
 * (qty + line value), not the full mixed invoice total.
 */
const salesLineScopeStages = (lineProductIdFilter) => {
  if (!lineProductIdFilter) return [];
  return [
    { $unwind: '$products' },
    { $match: { 'products.productId': lineProductIdFilter } },
    {
      $addFields: {
        lineQty: {
          $max: [
            0,
            {
              $subtract: [
                { $ifNull: ['$products.quantity', 0] },
                { $ifNull: ['$products.returnedQuantity', 0] },
              ],
            },
          ],
        },
      },
    },
    {
      $addFields: {
        lineGross: {
          $multiply: [{ $ifNull: ['$products.price', 0] }, '$lineQty'],
        },
      },
    },
    {
      $addFields: {
        lineSales: {
          $cond: [
            { $gt: [{ $ifNull: ['$subtotalPrice', 0] }, 0] },
            {
              $multiply: [
                '$lineGross',
                { $divide: [{ $ifNull: ['$totalPrice', 0] }, '$subtotalPrice'] },
              ],
            },
            '$lineGross',
          ],
        },
      },
    },
  ];
};

const salesAmountExpr = (scopedToLines) =>
  scopedToLines ? { $sum: '$lineSales' } : { $sum: '$totalPrice' };

const salesQtyExpr = (scopedToLines) =>
  scopedToLines
    ? { $sum: '$lineQty' }
    : { $sum: { $ifNull: ['$numberOfProducts', 0] } };

/** Resolve vendor ids matching a supplier phone (exact candidates or last-10 / substring). */
const resolveVendorIdsByPhone = async (supplierPhone) => {
  if (!supplierPhone) return null;
  const candidates = buildPhoneSearchCandidates(supplierPhone);
  const last10 = digitsOnly(supplierPhone).slice(-10);
  const or = [];
  if (candidates.length) {
    or.push({ phone: { $in: candidates } });
  }
  if (last10 && last10.length >= 7) {
    or.push({ phone: { $regex: new RegExp(`${escapeRegex(last10)}$`) } });
  }
  or.push({ phone: { $regex: escapeRegex(supplierPhone), $options: 'i' } });
  const vendors = await Vendor.find({ $or: or }).select('_id').lean();
  return vendors.map((v) => v._id);
};

/** Products acquired from a supplier (by id and/or phone) or linked on purchasing requests. */
const resolveSupplierProductIds = async (supplierPhone, supplierId = null) => {
  if (!supplierPhone && !supplierId) return null;

  let vendorIds = supplierId ? [supplierId] : null;
  if (!vendorIds?.length && supplierPhone) {
    vendorIds = await resolveVendorIdsByPhone(supplierPhone);
  }

  const acquiredOr = [];
  if (supplierPhone) {
    const phoneRegex = { $regex: escapeRegex(supplierPhone), $options: 'i' };
    const last10 = digitsOnly(supplierPhone).slice(-10);
    acquiredOr.push({ 'acquiredFrom.phone': phoneRegex });
    if (last10 && last10.length >= 7) {
      acquiredOr.push({ 'acquiredFrom.phone': { $regex: new RegExp(`${escapeRegex(last10)}$`) } });
    }
  }
  if (vendorIds?.length) {
    acquiredOr.push({ 'acquiredFrom.vendorId': { $in: vendorIds } });
  }
  if (!acquiredOr.length) {
    return [];
  }

  const [fromAcquired, fromPurchasing] = await Promise.all([
    Product.find({ $or: acquiredOr }).distinct('_id'),
    vendorIds?.length
      ? PurchasingRequest.find({ supplier: { $in: vendorIds } }).distinct('products')
      : Promise.resolve([]),
  ]);

  const ids = new Set();
  for (const id of fromAcquired || []) {
    if (id) ids.add(String(id));
  }
  for (const id of fromPurchasing || []) {
    if (id) ids.add(String(id));
  }
  return [...ids].map((id) => new mongoose.Types.ObjectId(id));
};

/** Narrow a product-id filter by an optional supplier product id list. */
const intersectProductIdFilter = (existingProductId, supplierProductIds) => {
  if (!supplierProductIds) return existingProductId || null;

  const supplierSet = new Set(supplierProductIds.map((id) => String(id)));
  const toObjectId = (id) =>
    id instanceof mongoose.Types.ObjectId ? id : new mongoose.Types.ObjectId(String(id));

  if (!existingProductId) {
    return { $in: supplierProductIds };
  }

  if (existingProductId instanceof mongoose.Types.ObjectId || typeof existingProductId === 'string') {
    return supplierSet.has(String(existingProductId)) ? existingProductId : { $in: [] };
  }

  if (existingProductId.$in && Array.isArray(existingProductId.$in)) {
    const intersection = existingProductId.$in
      .filter((id) => supplierSet.has(String(id)))
      .map(toObjectId);
    return { $in: intersection };
  }

  return { $in: [] };
};

const getDateGroupExpr = (groupBy) =>
  groupBy === 'monthly'
    ? { $dateToString: { format: '%Y-%m', date: '$createdAt', timezone: REPORT_TZ } }
    : { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: REPORT_TZ } };

/** Date-group expression for an arbitrary date field path (e.g. payments.paidAt). */
const getDateGroupExprForField = (groupBy, dateField) =>
  groupBy === 'monthly'
    ? { $dateToString: { format: '%Y-%m', date: dateField, timezone: REPORT_TZ } }
    : { $dateToString: { format: '%Y-%m-%d', date: dateField, timezone: REPORT_TZ } };

/** Orders with a customer installment schedule (profit is cash-basis on collection). */
const hasInstallmentsExpr = {
  $gt: [{ $size: { $ifNull: ['$installments', []] } }, 0],
};

/**
 * Expand sale lines with invoice discount/surcharge allocated proportionally.
 * Product prices already include item-level discounts; invoiceDiscountAmount is
 * positive for a discount and negative for a surcharge.
 */
const profitLineValueStages = (lineProductIdFilter) => [
  {
    $addFields: {
      orderLineGrossTotal: {
        $reduce: {
          input: { $ifNull: ['$products', []] },
          initialValue: 0,
          in: {
            $add: [
              '$$value',
              {
                $multiply: [
                  { $ifNull: ['$$this.price', 0] },
                  { $ifNull: ['$$this.quantity', 0] },
                ],
              },
            ],
          },
        },
      },
    },
  },
  { $unwind: '$products' },
  ...(lineProductIdFilter
    ? [{ $match: { 'products.productId': lineProductIdFilter } }]
    : []),
  {
    $addFields: {
      lineGrossRevenue: {
        $multiply: [
          { $ifNull: ['$products.price', 0] },
          { $ifNull: ['$products.quantity', 0] },
        ],
      },
      lineCostBeforeReturns: {
        $multiply: [
          { $ifNull: ['$products.cost', 0] },
          { $ifNull: ['$products.quantity', 0] },
        ],
      },
    },
  },
  {
    $addFields: {
      lineInvoiceDiscount: {
        $cond: [
          { $gt: ['$orderLineGrossTotal', 0] },
          {
            $multiply: [
              { $ifNull: ['$invoiceDiscountAmount', 0] },
              { $divide: ['$lineGrossRevenue', '$orderLineGrossTotal'] },
            ],
          },
          0,
        ],
      },
    },
  },
  {
    $addFields: {
      revenue: { $subtract: ['$lineGrossRevenue', '$lineInvoiceDiscount'] },
      cost: '$lineCostBeforeReturns',
    },
  },
];

/** Cash; credit; card (Visa / Mastercard / Meeza); everything else = apps & wallets (Valu, Instapay, etc.). */
const salesPaymentCategoryExpr = {
  $cond: [
    { $in: [{ $toLower: { $ifNull: ['$paymentMethod', 'cash'] } }, ['', 'cash']] },
    'cash',
    {
      $cond: [
        {
          $in: [
            { $toLower: { $ifNull: ['$paymentMethod', 'cash'] } },
            ['visa', 'mastercard', 'meeza'],
          ],
        },
        'card',
        {
          $cond: [
            { $eq: [{ $toLower: { $ifNull: ['$paymentMethod', ''] } }, 'credit'] },
            'credit',
            'application',
          ],
        },
      ],
    },
  ],
};

export const getSalesReport = async (req, res) => {
  try {
    const f = parseCommonFilters(req.query, req.user);
    const lineProductIdFilter = f.productId
      ? f.productId
      : await resolveCategoryProductIdFilter(f.categoryIds);
    const scopedToLines = Boolean(lineProductIdFilter);
    const lineStages = salesLineScopeStages(lineProductIdFilter);

    const baseMatch = {
      createdAt: { $gte: f.from, $lte: f.to },
      status: { $ne: 'restored' },
    };
    if (f.branchId) baseMatch.branch = f.branchId;
    appendOrderCustomerFilters(baseMatch, f);
    if (lineProductIdFilter) baseMatch['products.productId'] = lineProductIdFilter;
    if (f.sellerName) baseMatch.sellerName = f.sellerName;

    const orderCountGroup = scopedToLines ? { $addToSet: '$_id' } : { $sum: 1 };
    const projectOrderCount = scopedToLines
      ? { $size: '$orderIds' }
      : '$totalOrders';

    const [summary] = await Order.aggregate([
      { $match: baseMatch },
      ...lineStages,
      {
        $group: {
          _id: null,
          totalSales: salesAmountExpr(scopedToLines),
          soldQty: salesQtyExpr(scopedToLines),
          ...(scopedToLines ? { orderIds: orderCountGroup } : { totalOrders: orderCountGroup }),
        },
      },
      {
        $addFields: {
          totalOrders: projectOrderCount,
        },
      },
      {
        $project: {
          _id: 0,
          totalSales: { $round: ['$totalSales', 2] },
          soldQty: { $round: ['$soldQty', 2] },
          totalOrders: 1,
          averageOrderValue: {
            $cond: [
              { $gt: ['$totalOrders', 0] },
              { $round: [{ $divide: ['$totalSales', '$totalOrders'] }, 2] },
              0,
            ],
          },
        },
      },
    ]);

    const salesOverTime = await Order.aggregate([
      { $match: baseMatch },
      ...lineStages,
      {
        $group: {
          _id: getDateGroupExpr(f.groupBy),
          totalSales: salesAmountExpr(scopedToLines),
          soldQty: salesQtyExpr(scopedToLines),
          ...(scopedToLines ? { orderIds: orderCountGroup } : { totalOrders: orderCountGroup }),
        },
      },
      { $sort: { _id: 1 } },
      {
        $addFields: { totalOrders: projectOrderCount },
      },
      {
        $project: {
          _id: 0,
          period: '$_id',
          totalSales: { $round: ['$totalSales', 2] },
          soldQty: { $round: ['$soldQty', 2] },
          totalOrders: 1,
        },
      },
    ]);

    const salesPerBranch = await Order.aggregate([
      { $match: baseMatch },
      ...lineStages,
      {
        $group: {
          _id: '$branch',
          totalSales: salesAmountExpr(scopedToLines),
          soldQty: salesQtyExpr(scopedToLines),
          ...(scopedToLines ? { orderIds: orderCountGroup } : { totalOrders: orderCountGroup }),
        },
      },
      { $lookup: { from: 'branches', localField: '_id', foreignField: '_id', as: 'branch' } },
      { $unwind: { path: '$branch', preserveNullAndEmptyArrays: true } },
      {
        $addFields: { totalOrders: projectOrderCount },
      },
      {
        $project: {
          _id: 0,
          branchId: '$_id',
          branchName: { $ifNull: ['$branch.name', 'N/A'] },
          totalSales: { $round: ['$totalSales', 2] },
          soldQty: { $round: ['$soldQty', 2] },
          totalOrders: 1,
        },
      },
      { $sort: { totalSales: -1 } },
    ]);

    const salesByPaymentCategory = await Order.aggregate([
      { $match: baseMatch },
      { $addFields: { paymentCategory: salesPaymentCategoryExpr } },
      ...lineStages,
      {
        $group: {
          _id: '$paymentCategory',
          totalSales: salesAmountExpr(scopedToLines),
          soldQty: salesQtyExpr(scopedToLines),
          ...(scopedToLines ? { orderIds: orderCountGroup } : { totalOrders: orderCountGroup }),
        },
      },
      { $sort: { _id: 1 } },
      {
        $addFields: { totalOrders: projectOrderCount },
      },
      {
        $project: {
          _id: 0,
          category: '$_id',
          totalSales: { $round: ['$totalSales', 2] },
          soldQty: { $round: ['$soldQty', 2] },
          totalOrders: 1,
        },
      },
    ]);

    return res.json({
      filters: f,
      summary: summary || { totalSales: 0, soldQty: 0, totalOrders: 0, averageOrderValue: 0 },
      salesOverTime,
      salesPerBranch,
      salesByPaymentCategory,
    });
  } catch (error) {
    console.error('getSalesReport:', error);
    return res.status(500).json({ error: 'Failed to generate sales report' });
  }
};

export const getProfitReport = async (req, res) => {
  try {
    const f = parseCommonFilters(req.query, req.user);
    const baseOrderMatch = {};
    if (f.branchId) baseOrderMatch.branch = f.branchId;
    appendOrderCustomerFilters(baseOrderMatch, f);
    const lineProductIdFilter = f.productId
      ? f.productId
      : await resolveCategoryProductIdFilter(f.categoryIds);
    if (lineProductIdFilter) baseOrderMatch['products.productId'] = lineProductIdFilter;
    if (f.sellerName) baseOrderMatch.sellerName = f.sellerName;
    /** Accrual sales: exclude installment invoices (their profit is recognized on collection). */
    const nonInstallmentMatch = {
      ...baseOrderMatch,
      createdAt: { $gte: f.from, $lte: f.to },
      $expr: { $eq: [{ $size: { $ifNull: ['$installments', []] } }, 0] },
    };

    /** Installment orders (any createdAt) for cash-basis profit by payment date. */
    const installmentOrderMatch = {
      ...baseOrderMatch,
      'installments.0': { $exists: true },
    };

    const overhead = await getBranchOverheadForReport(f.branchId);
    const daysInPeriod = calendarDaysInclusive(f.from, f.to);
    const branchOperatingCostTotal = overhead.dailyRate * daysInPeriod;
    const dailyExpenses = await getOperatingDailyExpensesForReport({
      from: f.from,
      to: f.to,
      branchId: f.branchId,
      groupBy: f.groupBy,
    });

    const [aggSummary] = await Order.aggregate([
      { $match: nonInstallmentMatch },
      ...profitLineValueStages(lineProductIdFilter),
      {
        $group: {
          _id: null,
          grossRevenue: { $sum: '$lineGrossRevenue' },
          invoiceDiscounts: { $sum: '$lineInvoiceDiscount' },
          totalRevenue: { $sum: '$revenue' },
          totalCost: { $sum: '$cost' },
        },
      },
      {
        $project: {
          _id: 0,
          grossRevenue: { $round: ['$grossRevenue', 2] },
          invoiceDiscounts: { $round: ['$invoiceDiscounts', 2] },
          totalRevenue: { $round: ['$totalRevenue', 2] },
          totalCost: { $round: ['$totalCost', 2] },
          tradingProfit: { $round: [{ $subtract: ['$totalRevenue', '$totalCost'] }, 2] },
        },
      },
    ]);

    const returnMatch = {
      ...baseOrderMatch,
      'returns.returnedAt': { $gte: f.from, $lte: f.to },
      $expr: { $eq: [{ $size: { $ifNull: ['$installments', []] } }, 0] },
    };
    const [returnSummary] = await Order.aggregate([
      { $match: returnMatch },
      { $unwind: '$returns' },
      { $match: { 'returns.returnedAt': { $gte: f.from, $lte: f.to } } },
      { $unwind: '$returns.items' },
      ...(lineProductIdFilter
        ? [{ $match: { 'returns.items.productId': lineProductIdFilter } }]
        : []),
      {
        $addFields: {
          returnedProductLine: {
            $arrayElemAt: [
              {
                $filter: {
                  input: { $ifNull: ['$products', []] },
                  as: 'productLine',
                  cond: {
                    $eq: ['$$productLine.productId', '$returns.items.productId'],
                  },
                },
              },
              0,
            ],
          },
        },
      },
      {
        $group: {
          _id: null,
          salesReturns: { $sum: { $ifNull: ['$returns.items.lineTotal', 0] } },
          returnedCostReversal: {
            $sum: {
              $multiply: [
                { $ifNull: ['$returnedProductLine.cost', 0] },
                { $ifNull: ['$returns.items.quantity', 0] },
              ],
            },
          },
        },
      },
    ]);

    /** Installment profit from payment lines (new data). */
    const installmentProfitFromPayments = await Order.aggregate([
      { $match: installmentOrderMatch },
      { $unwind: '$payments' },
      {
        $match: {
          'payments.paidAt': { $gte: f.from, $lte: f.to },
          'payments.installmentProfit': { $gt: 0 },
        },
      },
      {
        $group: {
          _id: getDateGroupExprForField(f.groupBy, '$payments.paidAt'),
          installmentProfit: { $sum: { $ifNull: ['$payments.installmentProfit', 0] } },
        },
      },
      { $project: { _id: 0, period: '$_id', installmentProfit: { $round: ['$installmentProfit', 2] } } },
    ]);

    /**
     * Legacy installment collections: no payment.installmentProfit recorded.
     * Approximate from installment row paidAmount/amount × profitShare (or equal split of line profit).
     */
    const installmentProfitLegacy = await Order.aggregate([
      { $match: installmentOrderMatch },
      {
        $addFields: {
          trackedInstallmentProfit: {
            $sum: {
              $map: {
                input: { $ifNull: ['$payments', []] },
                as: 'p',
                in: { $ifNull: ['$$p.installmentProfit', 0] },
              },
            },
          },
          lineTradingProfit: {
            $reduce: {
              input: { $ifNull: ['$products', []] },
              initialValue: 0,
              in: {
                $add: [
                  '$$value',
                  {
                    $subtract: [
                      {
                        $multiply: [
                          { $ifNull: ['$$this.price', 0] },
                          { $ifNull: ['$$this.quantity', 0] },
                        ],
                      },
                      {
                        $multiply: [
                          { $ifNull: ['$$this.cost', 0] },
                          { $ifNull: ['$$this.quantity', 0] },
                        ],
                      },
                    ],
                  },
                ],
              },
            },
          },
          installmentCount: { $size: { $ifNull: ['$installments', []] } },
        },
      },
      { $match: { trackedInstallmentProfit: { $lte: 0.001 } } },
      { $unwind: '$installments' },
      {
        $match: {
          'installments.paidAt': { $gte: f.from, $lte: f.to },
          'installments.paidAmount': { $gt: 0 },
        },
      },
      {
        $addFields: {
          rowShare: {
            $cond: [
              {
                $and: [
                  { $ne: ['$installments.profitShare', null] },
                  { $gt: [{ $ifNull: ['$installments.profitShare', 0] }, 0] },
                ],
              },
              { $ifNull: ['$installments.profitShare', 0] },
              {
                $cond: [
                  { $gt: ['$installmentCount', 0] },
                  { $divide: ['$lineTradingProfit', '$installmentCount'] },
                  0,
                ],
              },
            ],
          },
          approxProfit: {
            $cond: [
              { $gt: [{ $ifNull: ['$installments.amount', 0] }, 0] },
              {
                $multiply: [
                  {
                    $cond: [
                      {
                        $and: [
                          { $ne: ['$installments.profitShare', null] },
                          { $gt: [{ $ifNull: ['$installments.profitShare', 0] }, 0] },
                        ],
                      },
                      { $ifNull: ['$installments.profitShare', 0] },
                      {
                        $cond: [
                          { $gt: ['$installmentCount', 0] },
                          { $divide: ['$lineTradingProfit', '$installmentCount'] },
                          0,
                        ],
                      },
                    ],
                  },
                  {
                    $divide: [
                      { $ifNull: ['$installments.paidAmount', 0] },
                      { $ifNull: ['$installments.amount', 1] },
                    ],
                  },
                ],
              },
              0,
            ],
          },
        },
      },
      {
        $group: {
          _id: getDateGroupExprForField(f.groupBy, '$installments.paidAt'),
          installmentProfit: { $sum: '$approxProfit' },
        },
      },
      { $project: { _id: 0, period: '$_id', installmentProfit: { $round: ['$installmentProfit', 2] } } },
    ]);

    const installmentByPeriod = new Map();
    for (const row of [...(installmentProfitFromPayments || []), ...(installmentProfitLegacy || [])]) {
      const key = String(row.period);
      installmentByPeriod.set(
        key,
        round2((installmentByPeriod.get(key) || 0) + (Number(row.installmentProfit) || 0))
      );
    }
    const installmentProfitCollected = round2(
      [...installmentByPeriod.values()].reduce((s, n) => s + n, 0)
    );

    const grossRevenueAfterDiscount = Number(aggSummary?.totalRevenue) || 0;
    const grossCostBeforeReturns = Number(aggSummary?.totalCost) || 0;
    const salesReturns = round2(returnSummary?.salesReturns ?? 0);
    const returnedCostReversal = round2(returnSummary?.returnedCostReversal ?? 0);
    const totalRevenue = round2(grossRevenueAfterDiscount - salesReturns);
    const totalCost = round2(grossCostBeforeReturns - returnedCostReversal);
    const cashSalesTrading = aggSummary?.tradingProfit ?? round2(totalRevenue - totalCost);
    const tradingProfit = round2(cashSalesTrading + installmentProfitCollected);
    const dailyExpensesTotal = dailyExpenses.total;
    const netProfitAfterBranch = round2(
      tradingProfit - branchOperatingCostTotal - dailyExpensesTotal
    );
    const profitMargin =
      totalRevenue + installmentProfitCollected > 0
        ? round2((netProfitAfterBranch / (totalRevenue + installmentProfitCollected)) * 100)
        : 0;

    const summary = {
      grossRevenue: round2(aggSummary?.grossRevenue ?? 0),
      invoiceDiscounts: round2(aggSummary?.invoiceDiscounts ?? 0),
      salesReturns,
      returnedCostReversal,
      totalRevenue,
      totalCost,
      tradingProfit,
      installmentProfitCollected,
      cashSalesTradingProfit: cashSalesTrading,
      branchOperatingCost: round2(branchOperatingCostTotal),
      dailyExpensesTotal,
      dailyExpensesCount: dailyExpenses.count,
      netProfit: netProfitAfterBranch,
      profitMargin,
      branchOverhead: {
        monthlyFixedTotal: round2(overhead.monthlyTotal),
        dailyRate: round2(overhead.dailyRate),
        daysInPeriod,
        divisorDays: BRANCH_OVERHEAD_MONTHLY_DAYS,
        breakdown: {
          rent: round2(overhead.breakdown.rent),
          employeesSalary: round2(overhead.breakdown.employeesSalary),
          branchInvoices: round2(overhead.breakdown.branchInvoices),
          expenses: round2(overhead.breakdown.expenses),
        },
        branchCount: overhead.branchCount,
      },
    };

    const profitOverTimeRaw = await Order.aggregate([
      { $match: nonInstallmentMatch },
      ...profitLineValueStages(lineProductIdFilter),
      { $group: { _id: getDateGroupExpr(f.groupBy), revenue: { $sum: '$revenue' }, cost: { $sum: '$cost' } } },
      { $sort: { _id: 1 } },
      {
        $project: {
          _id: 0,
          period: '$_id',
          revenue: { $round: ['$revenue', 2] },
          cost: { $round: ['$cost', 2] },
        },
      },
    ]);

    const returnsOverTimeRaw = await Order.aggregate([
      { $match: returnMatch },
      { $unwind: '$returns' },
      { $match: { 'returns.returnedAt': { $gte: f.from, $lte: f.to } } },
      { $unwind: '$returns.items' },
      ...(lineProductIdFilter
        ? [{ $match: { 'returns.items.productId': lineProductIdFilter } }]
        : []),
      {
        $addFields: {
          returnedProductLine: {
            $arrayElemAt: [
              {
                $filter: {
                  input: { $ifNull: ['$products', []] },
                  as: 'productLine',
                  cond: { $eq: ['$$productLine.productId', '$returns.items.productId'] },
                },
              },
              0,
            ],
          },
        },
      },
      {
        $group: {
          _id: getDateGroupExprForField(f.groupBy, '$returns.returnedAt'),
          revenue: { $sum: { $ifNull: ['$returns.items.lineTotal', 0] } },
          cost: {
            $sum: {
              $multiply: [
                { $ifNull: ['$returnedProductLine.cost', 0] },
                { $ifNull: ['$returns.items.quantity', 0] },
              ],
            },
          },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const salesByPeriod = new Map(
      (profitOverTimeRaw || []).map((row) => [String(row.period), row])
    );
    const returnsByPeriod = new Map(
      (returnsOverTimeRaw || []).map((row) => [String(row._id), row])
    );
    const allPeriods = [
      ...new Set([
        ...salesByPeriod.keys(),
        ...returnsByPeriod.keys(),
        ...installmentByPeriod.keys(),
        ...dailyExpenses.byPeriod.keys(),
      ]),
    ].sort();

    const profitOverTime = allPeriods.map((period) => {
      const row = salesByPeriod.get(period);
      const returnRow = returnsByPeriod.get(period);
      const salesReturnsForPeriod = Number(returnRow?.revenue) || 0;
      const returnedCostForPeriod = Number(returnRow?.cost) || 0;
      const revenue = round2((Number(row?.revenue) || 0) - salesReturnsForPeriod);
      const cost = round2((Number(row?.cost) || 0) - returnedCostForPeriod);
      const installmentProfit = installmentByPeriod.get(period) || 0;
      const trading = round2(revenue - cost + installmentProfit);
      let overheadAlloc = 0;
      if (f.groupBy === 'monthly') {
        const d = daysInMonthOverlappingRange(period, f.from, f.to);
        overheadAlloc = round2(overhead.dailyRate * d);
      } else {
        overheadAlloc = round2(overhead.dailyRate);
      }
      const periodDailyExpenses = dailyExpenses.byPeriod.get(period) || 0;
      return {
        period,
        revenue,
        cost,
        salesReturns: round2(salesReturnsForPeriod),
        returnedCostReversal: round2(returnedCostForPeriod),
        installmentProfit,
        tradingProfit: trading,
        branchOverheadAllocated: overheadAlloc,
        dailyExpenses: periodDailyExpenses,
        netProfit: round2(trading - overheadAlloc - periodDailyExpenses),
      };
    });

    /** Invoices created in period (incl. installment — profit = recognized so far). */
    const invoiceCreatedMatch = {
      ...baseOrderMatch,
      createdAt: { $gte: f.from, $lte: f.to },
    };
    const invoiceAll =
      req.query.invoice_all === 'true' || req.query.invoice_all === true;
    const invoicePage = Math.max(1, Number(req.query.invoice_page) || 1);
    const invoiceLimit = Math.max(
      1,
      Math.min(100, Number(req.query.invoice_limit) || 25)
    );
    const invoiceSkip = (invoicePage - 1) * invoiceLimit;
    const invoiceExportCap = 50000;

    const [invoiceFacet] = await Order.aggregate([
      { $match: invoiceCreatedMatch },
      ...profitLineValueStages(lineProductIdFilter),
      {
        $addFields: {
          remainingRatio: {
            $cond: [
              { $gt: [{ $ifNull: ['$products.quantity', 0] }, 0] },
              {
                $divide: [
                  {
                    $max: [
                      0,
                      {
                        $subtract: [
                          { $ifNull: ['$products.quantity', 0] },
                          { $ifNull: ['$products.returnedQuantity', 0] },
                        ],
                      },
                    ],
                  },
                  { $ifNull: ['$products.quantity', 1] },
                ],
              },
              0,
            ],
          },
        },
      },
      {
        $addFields: {
          lineRevenue: { $multiply: ['$revenue', '$remainingRatio'] },
          lineCost: { $multiply: ['$cost', '$remainingRatio'] },
        },
      },
      {
        $group: {
          _id: '$_id',
          orderNumber: { $first: '$orderNumber' },
          createdAt: { $first: '$createdAt' },
          clientName: { $first: '$clientName' },
          clientPhoneNumber: { $first: '$clientPhoneNumber' },
          paymentStatus: { $first: '$paymentStatus' },
          paymentMethod: { $first: '$paymentMethod' },
          totalPrice: { $first: '$totalPrice' },
          installments: { $first: '$installments' },
          installmentTotalProfit: { $first: '$installmentTotalProfit' },
          revenue: { $sum: '$lineRevenue' },
          cost: { $sum: '$lineCost' },
        },
      },
      {
        $addFields: {
          isInstallment: hasInstallmentsExpr,
          installmentCount: { $size: { $ifNull: ['$installments', []] } },
          lineTradingProfit: { $subtract: ['$revenue', '$cost'] },
          recognizedProfit: {
            $sum: {
              $map: {
                input: { $ifNull: ['$installments', []] },
                as: 'inst',
                in: { $ifNull: ['$$inst.recognizedProfit', 0] },
              },
            },
          },
          installmentAmount: {
            $ifNull: [{ $arrayElemAt: ['$installments.amount', 0] }, 0],
          },
          installmentProfitShare: {
            $let: {
              vars: {
                firstShare: { $arrayElemAt: ['$installments.profitShare', 0] },
                n: { $size: { $ifNull: ['$installments', []] } },
              },
              in: {
                $cond: [
                  { $gt: [{ $ifNull: ['$$firstShare', 0] }, 0] },
                  '$$firstShare',
                  {
                    $cond: [
                      { $gt: ['$$n', 0] },
                      { $divide: [{ $subtract: ['$revenue', '$cost'] }, '$$n'] },
                      0,
                    ],
                  },
                ],
              },
            },
          },
        },
      },
      {
        $addFields: {
          /** Legacy rows: derive recognized from paidAmount when recognizedProfit unset. */
          recognizedProfitResolved: {
            $cond: [
              '$isInstallment',
              {
                $cond: [
                  { $gt: ['$recognizedProfit', 0.001] },
                  '$recognizedProfit',
                  {
                    $sum: {
                      $map: {
                        input: { $ifNull: ['$installments', []] },
                        as: 'inst',
                        in: {
                          $cond: [
                            { $gt: [{ $ifNull: ['$$inst.amount', 0] }, 0] },
                            {
                              $multiply: [
                                {
                                  $cond: [
                                    { $gt: [{ $ifNull: ['$$inst.profitShare', 0] }, 0] },
                                    { $ifNull: ['$$inst.profitShare', 0] },
                                    {
                                      $cond: [
                                        { $gt: ['$installmentCount', 0] },
                                        {
                                          $divide: ['$lineTradingProfit', '$installmentCount'],
                                        },
                                        0,
                                      ],
                                    },
                                  ],
                                },
                                {
                                  $divide: [
                                    { $ifNull: ['$$inst.paidAmount', 0] },
                                    { $ifNull: ['$$inst.amount', 1] },
                                  ],
                                },
                              ],
                            },
                            0,
                          ],
                        },
                      },
                    },
                  },
                ],
              },
              '$lineTradingProfit',
            ],
          },
        },
      },
      {
        $project: {
          _id: 0,
          orderId: '$_id',
          orderNumber: 1,
          createdAt: 1,
          clientName: 1,
          clientPhoneNumber: 1,
          paymentStatus: 1,
          paymentMethod: 1,
          isInstallment: 1,
          installmentAmount: { $round: [{ $ifNull: ['$installmentAmount', 0] }, 2] },
          installmentProfitShare: {
            $round: [{ $ifNull: ['$installmentProfitShare', 0] }, 2],
          },
          installmentTotalProfit: {
            $round: [
              {
                $ifNull: ['$installmentTotalProfit', '$lineTradingProfit'],
              },
              2,
            ],
          },
          totalPrice: { $round: [{ $ifNull: ['$totalPrice', 0] }, 2] },
          revenue: { $round: ['$revenue', 2] },
          cost: { $round: ['$cost', 2] },
          tradingProfit: {
            $round: [
              {
                $cond: ['$isInstallment', '$recognizedProfitResolved', '$lineTradingProfit'],
              },
              2,
            ],
          },
        },
      },
      { $sort: { createdAt: -1 } },
      {
        $facet: {
          meta: [{ $count: 'totalCount' }],
          rows: invoiceAll
            ? [{ $limit: invoiceExportCap }]
            : [{ $skip: invoiceSkip }, { $limit: invoiceLimit }],
        },
      },
    ]);

    const profitByInvoice = invoiceFacet?.rows || [];
    const invoiceTotalCount = invoiceFacet?.meta?.[0]?.totalCount || 0;

    return res.json({
      filters: f,
      summary,
      profitOverTime,
      profitByInvoice,
      profitByInvoiceMeta: {
        totalCount: invoiceTotalCount,
        page: invoiceAll ? 1 : invoicePage,
        limit: invoiceAll ? invoiceTotalCount || profitByInvoice.length : invoiceLimit,
        all: !!invoiceAll,
      },
    });
  } catch (error) {
    console.error('getProfitReport:', error);
    return res.status(500).json({ error: 'Failed to generate profit report' });
  }
};

/** Consolidated management-accounting report (accrual P&L + cash and position snapshots). */
export const getAccountingSummaryReport = async (req, res) => {
  try {
    const f = parseCommonFilters(req.query, req.user);
    const basis = String(req.query.basis || 'accrual').toLowerCase();
    if (basis !== 'accrual') {
      return res.status(400).json({
        error: 'Only accrual basis is available until legacy payment events are reconciled',
      });
    }

    const orderScope = {};
    if (f.branchId) orderScope.branch = f.branchId;
    const createdOrderMatch = {
      ...orderScope,
      createdAt: { $gte: f.from, $lte: f.to },
    };
    const returnOrderMatch = {
      ...orderScope,
      'returns.returnedAt': { $gte: f.from, $lte: f.to },
    };

    const [
      salesRows,
      returnRows,
      expenseData,
      paymentFeeRows,
      purchaseDocs,
      purchaseReturnDocs,
      treasuryPeriodRows,
      treasuryPriorRows,
      treasuryOpeningDocs,
      inventoryRows,
      customerOpeningRows,
      vendors,
      receivableOrderRows,
      payableRequests,
      linkedBranchPurchases,
      duplicateLedgerRows,
      orphanOrderLedgerRows,
    ] = await Promise.all([
      Order.aggregate([
        { $match: createdOrderMatch },
        ...profitLineValueStages(null),
        {
          $group: {
            _id: getDateGroupExpr(f.groupBy),
            grossSales: { $sum: '$lineGrossRevenue' },
            invoiceDiscounts: { $sum: '$lineInvoiceDiscount' },
            netBeforeReturns: { $sum: '$revenue' },
            costBeforeReturns: { $sum: '$cost' },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      Order.aggregate([
        { $match: returnOrderMatch },
        { $unwind: '$returns' },
        { $match: { 'returns.returnedAt': { $gte: f.from, $lte: f.to } } },
        { $unwind: '$returns.items' },
        {
          $addFields: {
            returnedProductLine: {
              $arrayElemAt: [
                {
                  $filter: {
                    input: { $ifNull: ['$products', []] },
                    as: 'line',
                    cond: { $eq: ['$$line.productId', '$returns.items.productId'] },
                  },
                },
                0,
              ],
            },
          },
        },
        {
          $group: {
            _id: getDateGroupExprForField(f.groupBy, '$returns.returnedAt'),
            salesReturns: { $sum: { $ifNull: ['$returns.items.lineTotal', 0] } },
            returnedCost: {
              $sum: {
                $multiply: [
                  { $ifNull: ['$returnedProductLine.cost', 0] },
                  { $ifNull: ['$returns.items.quantity', 0] },
                ],
              },
            },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      getOperatingDailyExpensesForReport({
        from: f.from,
        to: f.to,
        branchId: f.branchId,
        groupBy: f.groupBy,
      }),
      Order.aggregate([
        { $match: { ...orderScope, 'payments.paidAt': { $gte: f.from, $lte: f.to } } },
        { $unwind: '$payments' },
        {
          $match: {
            'payments.paidAt': { $gte: f.from, $lte: f.to },
            'payments.feeNet': { $gt: 0 },
          },
        },
        { $group: { _id: null, total: { $sum: '$payments.feeNet' } } },
      ]),
      ProductPurchaseRequest.find({
        ...(f.branchId ? { branch: f.branchId } : {}),
        status: { $in: ['approved', 'partially_returned', 'returned'] },
        createdAt: { $gte: f.from, $lte: f.to },
      }).lean(),
      ProductPurchaseRequest.find({
        ...(f.branchId ? { branch: f.branchId } : {}),
        'returns.returnedAt': { $gte: f.from, $lte: f.to },
      })
        .select('returns')
        .lean(),
      TreasuryLedgerEntry.aggregate([
        {
          $match: {
            ...(f.branchId ? { branch: f.branchId } : {}),
            occurredAt: { $gte: f.from, $lte: f.to },
          },
        },
        {
          $group: {
            _id: '$accountKey',
            inflows: {
              $sum: { $cond: [{ $eq: ['$direction', 'in'] }, '$amount', 0] },
            },
            outflows: {
              $sum: { $cond: [{ $eq: ['$direction', 'out'] }, '$amount', 0] },
            },
            internalTransfers: {
              $sum: { $cond: [{ $eq: ['$sourceType', 'transfer'] }, '$amount', 0] },
            },
          },
        },
      ]),
      TreasuryLedgerEntry.aggregate([
        {
          $match: {
            ...(f.branchId ? { branch: f.branchId } : {}),
            occurredAt: { $lt: f.from },
          },
        },
        {
          $group: {
            _id: '$accountKey',
            net: {
              $sum: {
                $cond: [{ $eq: ['$direction', 'in'] }, '$amount', { $multiply: ['$amount', -1] }],
              },
            },
          },
        },
      ]),
      TreasuryAccountOpening.find(f.branchId ? { branch: f.branchId } : {}).lean(),
      Product.aggregate([
        {
          $match: {
            ...(f.branchId ? { branch: f.branchId } : {}),
            removedWhenOutOfStock: { $ne: true },
          },
        },
        {
          $group: {
            _id: null,
            value: {
              $sum: {
                $multiply: [
                  { $ifNull: ['$stock', 0] },
                  { $ifNull: ['$netPrice', 0] },
                ],
              },
            },
          },
        },
      ]),
      f.branchId
        ? Promise.resolve([])
        : Client.aggregate([
            {
              $group: {
                _id: null,
                openingDebit: { $sum: { $ifNull: ['$openingDebitBalance', 0] } },
                prepaidLiability: { $sum: { $ifNull: ['$creditBalance', 0] } },
              },
            },
          ]),
      f.branchId
        ? Promise.resolve([])
        : Vendor.find({})
            .select('creditBalance buyerPrepaidBalance openingDebitBalance')
            .lean(),
      Order.aggregate([
        { $match: { ...orderScope, status: { $ne: 'restored' } } },
        {
          $group: {
            _id: '$partyType',
            receivable: {
              $sum: {
                $max: [
                  0,
                  {
                    $subtract: [
                      { $ifNull: ['$totalPrice', 0] },
                      { $ifNull: ['$amountPaid', 0] },
                    ],
                  },
                ],
              },
            },
          },
        },
      ]),
      PurchasingRequest.find({
        status: 'Received',
        paymentStatus: { $in: ['Installments', 'Deferred'] },
      }).lean(),
      f.branchId
        ? ProductPurchaseRequest.find({
            branch: f.branchId,
            linkedPurchasingRequestId: { $ne: null },
          })
            .select('linkedPurchasingRequestId')
            .lean()
        : Promise.resolve([]),
      TreasuryLedgerEntry.aggregate([
        {
          $match: {
            eventKey: { $exists: false },
            sourceId: { $ne: null },
            occurredAt: { $gte: f.from, $lte: f.to },
          },
        },
        {
          $group: {
            _id: {
              branch: '$branch',
              accountKey: '$accountKey',
              direction: '$direction',
              amount: '$amount',
              sourceType: '$sourceType',
              sourceId: '$sourceId',
              occurredAt: '$occurredAt',
            },
            count: { $sum: 1 },
          },
        },
        { $match: { count: { $gt: 1 } } },
        { $limit: 100 },
      ]),
      TreasuryLedgerEntry.aggregate([
        {
          $match: {
            sourceType: { $in: ['order_payment', 'order_refund'] },
            sourceId: { $ne: null },
            occurredAt: { $gte: f.from, $lte: f.to },
          },
        },
        {
          $lookup: {
            from: 'orders',
            localField: 'sourceId',
            foreignField: '_id',
            as: 'sourceOrder',
          },
        },
        { $match: { sourceOrder: { $size: 0 } } },
        { $count: 'count' },
      ]),
    ]);

    const [
      paymentSourceIds,
      postedPaymentSourceIds,
      expenseSourceIds,
      postedExpenseSourceIds,
      purchaseReturnSourceIds,
      postedPurchaseReturnSourceIds,
    ] = await Promise.all([
      Order.distinct('_id', {
        ...orderScope,
        payments: {
          $elemMatch: {
            paidAt: { $gte: f.from, $lte: f.to },
            amount: { $gt: 0 },
          },
        },
      }),
      TreasuryLedgerEntry.distinct('sourceId', {
        ...(f.branchId ? { branch: f.branchId } : {}),
        sourceType: 'order_payment',
        occurredAt: { $gte: f.from, $lte: f.to },
      }),
      DailyExpense.distinct('_id', {
        ...(f.branchId ? { branch: f.branchId } : {}),
        createdAt: { $gte: f.from, $lte: f.to },
      }),
      TreasuryLedgerEntry.distinct('sourceId', {
        ...(f.branchId ? { branch: f.branchId } : {}),
        sourceType: 'daily_expense',
        occurredAt: { $gte: f.from, $lte: f.to },
      }),
      ProductPurchaseRequest.distinct('_id', {
        ...(f.branchId ? { branch: f.branchId } : {}),
        returns: { $elemMatch: { returnedAt: { $gte: f.from, $lte: f.to } } },
      }),
      TreasuryLedgerEntry.distinct('sourceId', {
        ...(f.branchId ? { branch: f.branchId } : {}),
        sourceType: 'purchase_return',
        occurredAt: { $gte: f.from, $lte: f.to },
      }),
    ]);
    const missingCount = (sourceIds, postedIds) => {
      const posted = new Set((postedIds || []).map(String));
      return (sourceIds || []).filter((id) => !posted.has(String(id))).length;
    };

    const sumRows = (rows, key) =>
      round2((rows || []).reduce((sum, row) => sum + (Number(row?.[key]) || 0), 0));
    const grossSales = sumRows(salesRows, 'grossSales');
    const invoiceDiscounts = sumRows(salesRows, 'invoiceDiscounts');
    const salesReturns = sumRows(returnRows, 'salesReturns');
    const salesBeforeReturns = sumRows(salesRows, 'netBeforeReturns');
    const costBeforeReturns = sumRows(salesRows, 'costBeforeReturns');
    const returnedCostReversal = sumRows(returnRows, 'returnedCost');
    const netSales = round2(salesBeforeReturns - salesReturns);
    const costOfGoodsSold = round2(costBeforeReturns - returnedCostReversal);
    const grossProfit = round2(netSales - costOfGoodsSold);
    const overhead = await getBranchOverheadForReport(f.branchId);
    const allocatedOverhead = round2(
      overhead.dailyRate * calendarDaysInclusive(f.from, f.to)
    );
    const paymentProcessingFees = round2(paymentFeeRows?.[0]?.total ?? 0);
    const operatingExpenses = round2(expenseData.total);
    const netProfit = round2(
      grossProfit - operatingExpenses - paymentProcessingFees - allocatedOverhead
    );

    const inventoryPurchases = round2(
      (purchaseDocs || []).reduce(
        (sum, purchase) => sum + deskPurchaseLineTotal(purchase),
        0
      )
    );
    const purchaseReturns = round2(
      (purchaseReturnDocs || []).reduce(
        (sum, purchase) =>
          sum +
          (purchase.returns || [])
            .filter((ret) => {
              const when = new Date(ret.returnedAt);
              return when >= f.from && when <= f.to;
            })
            .reduce((retSum, ret) => retSum + (Number(ret.refundTotal) || 0), 0),
        0
      )
    );

    const openingByAccount = new Map();
    for (const opening of treasuryOpeningDocs || []) {
      const key = String(opening.accountKey || '').toLowerCase();
      if (!openingByAccount.has(key)) openingByAccount.set(key, []);
      openingByAccount.get(key).push(Number(opening.amount) || 0);
    }
    const priorByAccount = new Map(
      (treasuryPriorRows || []).map((row) => [String(row._id), Number(row.net) || 0])
    );
    const periodByAccount = new Map(
      (treasuryPeriodRows || []).map((row) => [String(row._id), row])
    );
    const treasuryKeys = new Set([
      ...openingByAccount.keys(),
      ...priorByAccount.keys(),
      ...periodByAccount.keys(),
    ]);
    const treasuryAccounts = [...treasuryKeys].sort().map((accountKey) => {
      const configuredOpening = f.branchId
        ? round2((openingByAccount.get(accountKey) || []).reduce((sum, n) => sum + n, 0))
        : companyOpeningForAccount(accountKey, openingByAccount.get(accountKey) || []);
      const opening = round2(configuredOpening + (priorByAccount.get(accountKey) || 0));
      const period = periodByAccount.get(accountKey) || {};
      const inflows = round2(period.inflows || 0);
      const outflows = round2(period.outflows || 0);
      return {
        accountKey,
        opening,
        inflows,
        outflows,
        closing: round2(opening + inflows - outflows),
      };
    });

    const orderReceivables = new Map(
      (receivableOrderRows || []).map((row) => [
        String(row._id || 'client'),
        round2(row.receivable),
      ])
    );
    const customerOpening = round2(customerOpeningRows?.[0]?.openingDebit ?? 0);
    const customerPrepaidLiability = round2(
      customerOpeningRows?.[0]?.prepaidLiability ?? 0
    );
    const supplierPrepaidAsset = round2(
      (vendors || []).reduce((sum, vendor) => sum + (Number(vendor.creditBalance) || 0), 0)
    );
    const supplierOpeningReceivable = round2(
      (vendors || []).reduce(
        (sum, vendor) => sum + (Number(vendor.openingDebitBalance) || 0),
        0
      )
    );
    const supplierDepositLiability = round2(
      (vendors || []).reduce(
        (sum, vendor) => sum + (Number(vendor.buyerPrepaidBalance) || 0),
        0
      )
    );

    const branchLinkedRequestIds = new Set(
      (linkedBranchPurchases || []).map((row) => String(row.linkedPurchasingRequestId))
    );
    const scopedPayableRequests = f.branchId
      ? (payableRequests || []).filter((request) =>
          branchLinkedRequestIds.has(String(request._id))
        )
      : payableRequests || [];
    const supplierPayable = round2(
      scopedPayableRequests.reduce((sum, request) => {
        if (request.paymentStatus === 'Installments') {
          return sum + unpaidInstallmentsTotal(request);
        }
        return sum + deferredPurchaseRemaining(request);
      }, 0)
    );

    const salesByPeriod = new Map((salesRows || []).map((row) => [String(row._id), row]));
    const returnsByPeriod = new Map(
      (returnRows || []).map((row) => [String(row._id), row])
    );
    const timelinePeriods = [
      ...new Set([
        ...salesByPeriod.keys(),
        ...returnsByPeriod.keys(),
        ...expenseData.byPeriod.keys(),
      ]),
    ].sort();
    const timeline = timelinePeriods.map((period) => {
      const sale = salesByPeriod.get(period) || {};
      const ret = returnsByPeriod.get(period) || {};
      const periodSales = round2(
        (Number(sale.netBeforeReturns) || 0) - (Number(ret.salesReturns) || 0)
      );
      const periodCost = round2(
        (Number(sale.costBeforeReturns) || 0) - (Number(ret.returnedCost) || 0)
      );
      const periodExpenses = round2(expenseData.byPeriod.get(period) || 0);
      let periodOverhead = overhead.dailyRate;
      if (f.groupBy === 'monthly') {
        periodOverhead =
          overhead.dailyRate * daysInMonthOverlappingRange(period, f.from, f.to);
      }
      return {
        period,
        netSales: periodSales,
        costOfGoodsSold: periodCost,
        operatingExpenses: periodExpenses,
        netProfit: round2(periodSales - periodCost - periodExpenses - periodOverhead),
      };
    });

    const missingOrderPaymentPostings = missingCount(
      paymentSourceIds,
      postedPaymentSourceIds
    );
    const missingExpensePostings = missingCount(expenseSourceIds, postedExpenseSourceIds);
    const missingPurchaseReturnPostings = missingCount(
      purchaseReturnSourceIds,
      postedPurchaseReturnSourceIds
    );
    const warnings = [
      'tax_snapshots_missing',
      'factory_sales_excluded',
    ];
    if (
      missingOrderPaymentPostings ||
      missingExpensePostings ||
      missingPurchaseReturnPostings
    ) {
      warnings.push('treasury_postings_missing');
    }
    if (duplicateLedgerRows.length) warnings.push('treasury_duplicates_suspected');
    if (f.branchId) {
      warnings.push(
        'branch_opening_balances_excluded'
      );
    }
    return res.json({
      meta: {
        currency: 'EGP',
        timezone: REPORT_TZ,
        basis,
        dataCompleteness: warnings.length ? 'partial' : 'complete',
        from: f.from,
        to: f.to,
        branchId: f.branchId,
      },
      profitAndLoss: {
        grossSales,
        invoiceDiscounts,
        salesReturns,
        netSales,
        costBeforeReturns,
        returnedCostReversal,
        costOfGoodsSold,
        grossProfit,
        operatingExpenses,
        paymentProcessingFees,
        allocatedOverhead,
        netProfit,
      },
      purchases: {
        inventoryPurchases,
        purchaseReturns,
        netPurchases: round2(inventoryPurchases - purchaseReturns),
      },
      receivables: {
        customers: round2((orderReceivables.get('client') || 0) + customerOpening),
        suppliers: round2(
          (orderReceivables.get('supplier') || 0) +
            supplierOpeningReceivable +
            supplierPrepaidAsset
        ),
        supplierPrepaidAsset,
      },
      payables: {
        suppliers: supplierPayable,
        customerDeposits: customerPrepaidLiability,
        supplierDeposits: supplierDepositLiability,
      },
      treasury: {
        opening: round2(treasuryAccounts.reduce((sum, row) => sum + row.opening, 0)),
        inflows: round2(treasuryAccounts.reduce((sum, row) => sum + row.inflows, 0)),
        outflows: round2(treasuryAccounts.reduce((sum, row) => sum + row.outflows, 0)),
        closing: round2(treasuryAccounts.reduce((sum, row) => sum + row.closing, 0)),
        accounts: treasuryAccounts,
      },
      inventory: {
        closingCostValue: round2(inventoryRows?.[0]?.value ?? 0),
      },
      taxes: {
        available: false,
        salesTax: null,
        purchaseTax: null,
        netTaxPayable: null,
      },
      timeline,
      reconciliation: {
        suspectedDuplicateLegacyGroups: duplicateLedgerRows.length,
        orphanOrderLedgerEntries: Number(orphanOrderLedgerRows?.[0]?.count) || 0,
        missingOrderPaymentPostings,
        missingExpensePostings,
        missingPurchaseReturnPostings,
        warnings,
      },
    });
  } catch (error) {
    console.error('getAccountingSummaryReport:', error);
    return res.status(500).json({ error: 'Failed to generate accounting summary report' });
  }
};

export const getProductsReport = async (req, res) => {
  try {
    const f = parseCommonFilters(req.query, req.user);
    const lowStockThreshold = Math.max(0, Number(req.query.lowStockThreshold) || 5);
    const supplierProductIds =
      f.supplierPhone || f.supplierId
        ? await resolveSupplierProductIds(f.supplierPhone, f.supplierId)
        : null;

    const orderMatch = { createdAt: { $gte: f.from, $lte: f.to }, status: { $ne: 'restored' } };
    if (f.branchId) orderMatch.branch = f.branchId;
    appendOrderCustomerFilters(orderMatch, f);

    let scopedProductIds = f.productId || null;
    if (!f.productId && f.categoryIds.length) {
      scopedProductIds = await resolveCategoryProductIdFilter(f.categoryIds);
    }
    const orderProductIdFilter = intersectProductIdFilter(scopedProductIds, supplierProductIds);
    if (orderProductIdFilter) {
      orderMatch['products.productId'] = orderProductIdFilter;
    }

    const productLineMatch = orderProductIdFilter
      ? { 'products.productId': orderProductIdFilter }
      : null;

    const topSellingProducts = await Order.aggregate([
      { $match: orderMatch },
      { $unwind: '$products' },
      ...(productLineMatch ? [{ $match: productLineMatch }] : []),
      {
        $group: {
          _id: '$products.productId',
          productName: { $first: '$products.name' },
          soldQty: { $sum: '$products.quantity' },
          soldAmount: { $sum: { $multiply: ['$products.price', '$products.quantity'] } },
        },
      },
      { $sort: { soldQty: -1 } },
      { $limit: 20 },
      { $project: { _id: 0, productId: '$_id', productName: 1, soldQty: 1, soldAmount: { $round: ['$soldAmount', 2] } } },
    ]);

    const productMatch = {
      $or: [
        { removedWhenOutOfStock: { $ne: true } },
        { removedWhenOutOfStock: { $exists: false } },
      ],
    };
    if (f.branchId) productMatch.branch = f.branchId;
    if (f.categoryIds.length === 1) {
      productMatch.category = f.categoryIds[0];
    } else if (f.categoryIds.length > 1) {
      productMatch.category = { $in: f.categoryIds };
    }
    const inventoryProductIdFilter = intersectProductIdFilter(f.productId || null, supplierProductIds);
    if (inventoryProductIdFilter) {
      productMatch._id = inventoryProductIdFilter;
    }

    const lowStockProducts = await Product.find({ ...productMatch, stock: { $lte: lowStockThreshold } })
      .populate('branch', 'name')
      .populate('category', 'name')
      .sort({ stock: 1 })
      .limit(100)
      .lean();

    const stockValueExpr = {
      $multiply: [{ $ifNull: ['$stock', 0] }, { $ifNull: ['$netPrice', 0] }],
    };

    const stockPerBranch = await Product.aggregate([
      { $match: { ...productMatch, inWarehouse: { $ne: true }, branch: { $ne: null } } },
      {
        $group: {
          _id: '$branch',
          totalStock: { $sum: '$stock' },
          productsCount: { $sum: 1 },
          inventoryCapital: { $sum: stockValueExpr },
        },
      },
      { $lookup: { from: 'branches', localField: '_id', foreignField: '_id', as: 'branch' } },
      { $unwind: { path: '$branch', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          branchId: '$_id',
          branchName: { $ifNull: ['$branch.name', 'N/A'] },
          totalStock: 1,
          productsCount: 1,
          inventoryCapital: { $round: ['$inventoryCapital', 2] },
        },
      },
      { $sort: { branchName: 1 } },
    ]);

    const [warehouseStats] = await Product.aggregate([
      { $match: { ...productMatch, inWarehouse: true } },
      {
        $group: {
          _id: null,
          stockInWarehouse: { $sum: '$stock' },
          productsCount: { $sum: 1 },
          inventoryCapital: { $sum: stockValueExpr },
        },
      },
      {
        $project: {
          _id: 0,
          stockInWarehouse: 1,
          productsCount: 1,
          inventoryCapital: { $round: ['$inventoryCapital', 2] },
        },
      },
    ]);

    const [inventoryCapitalStats] = await Product.aggregate([
      { $match: productMatch },
      {
        $group: {
          _id: null,
          totalStock: { $sum: { $ifNull: ['$stock', 0] } },
          productsCount: { $sum: 1 },
          inventoryCapital: { $sum: stockValueExpr },
        },
      },
      {
        $project: {
          _id: 0,
          totalStock: 1,
          productsCount: 1,
          inventoryCapital: { $round: ['$inventoryCapital', 2] },
        },
      },
    ]);

    const [branchesCapitalStats] = await Product.aggregate([
      { $match: { ...productMatch, inWarehouse: { $ne: true }, branch: { $ne: null } } },
      {
        $group: {
          _id: null,
          totalStock: { $sum: { $ifNull: ['$stock', 0] } },
          productsCount: { $sum: 1 },
          inventoryCapital: { $sum: stockValueExpr },
        },
      },
      {
        $project: {
          _id: 0,
          totalStock: 1,
          productsCount: 1,
          inventoryCapital: { $round: ['$inventoryCapital', 2] },
        },
      },
    ]);

    return res.json({
      filters: f,
      summary: {
        lowStockThreshold,
        stockInWarehouse: warehouseStats?.stockInWarehouse || 0,
        warehouseProductsCount: warehouseStats?.productsCount || 0,
        warehouseInventoryCapital: warehouseStats?.inventoryCapital || 0,
        branchesStock: branchesCapitalStats?.totalStock || 0,
        branchesProductsCount: branchesCapitalStats?.productsCount || 0,
        branchesInventoryCapital: branchesCapitalStats?.inventoryCapital || 0,
        totalStock: inventoryCapitalStats?.totalStock || 0,
        productsCount: inventoryCapitalStats?.productsCount || 0,
        inventoryCapital: inventoryCapitalStats?.inventoryCapital || 0,
      },
      topSellingProducts,
      lowStockProducts,
      stockPerBranch,
    });
  } catch (error) {
    console.error('getProductsReport:', error);
    return res.status(500).json({ error: 'Failed to generate products report' });
  }
};

export const getStockReport = async (req, res) => {
  try {
    const f = parseCommonFilters(req.query, req.user);
    const match = { createdAt: { $gte: f.from, $lte: f.to } };
    if (f.productId) match.productId = f.productId;
    if (f.branchId) {
      match.$or = [{ branchId: f.branchId }, { fromBranchId: f.branchId }, { toBranchId: f.branchId }];
    }

    const skip = (f.page - 1) * f.limit;
    const [movements, totalCount, summaryByType] = await Promise.all([
      StockMovement.find(match)
        .populate('productId', 'name code')
        .populate('fromBranchId', 'name')
        .populate('toBranchId', 'name')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(f.limit)
        .lean(),
      StockMovement.countDocuments(match),
      StockMovement.aggregate([
        { $match: match },
        { $group: { _id: '$movementType', count: { $sum: 1 }, totalQty: { $sum: '$quantity' }, totalValue: { $sum: '$totalValue' } } },
        { $project: { _id: 0, movementType: '$_id', count: 1, totalQty: 1, totalValue: { $round: ['$totalValue', 2] } } },
      ]),
    ]);

    return res.json({
      filters: f,
      summaryByType,
      movements,
      meta: { currentPage: f.page, totalCount, totalPages: Math.ceil(totalCount / f.limit) },
    });
  } catch (error) {
    console.error('getStockReport:', error);
    return res.status(500).json({ error: 'Failed to generate stock movement report' });
  }
};

export const getCustomersReport = async (req, res) => {
  try {
    const f = parseCommonFilters(req.query, req.user);
    const match = { createdAt: { $gte: f.from, $lte: f.to }, status: { $ne: 'restored' } };
    if (f.branchId) match.branch = f.branchId;
    appendOrderCustomerFilters(match, f);
    if (f.productId) match['products.productId'] = f.productId;

    const customers = await Order.aggregate([
      { $match: match },
      {
        $group: {
          _id: { clientId: '$clientId', phone: '$clientPhoneNumber', name: '$clientName' },
          totalOrders: { $sum: 1 },
          totalSpending: { $sum: '$totalPrice' },
          lastOrderAt: { $max: '$createdAt' },
        },
      },
      {
        $project: {
          _id: 0,
          clientId: '$_id.clientId',
          customerName: '$_id.name',
          customerPhone: '$_id.phone',
          totalOrders: 1,
          totalSpending: { $round: ['$totalSpending', 2] },
          lastOrderAt: 1,
        },
      },
      { $sort: { totalSpending: -1 } },
      { $limit: 100 },
    ]);

    return res.json({ filters: f, topCustomers: customers.slice(0, 10), customers });
  } catch (error) {
    console.error('getCustomersReport:', error);
    return res.status(500).json({ error: 'Failed to generate customers report' });
  }
};

export const getInstallmentsReport = async (req, res) => {
  try {
    const f = parseCommonFilters(req.query, req.user);
    const collectorIdRaw = String(req.query.collector_id || req.query.collectorId || '').trim();
    const hasCollectorFilter = mongoose.Types.ObjectId.isValid(collectorIdRaw);
    const collectorOid = hasCollectorFilter
      ? new mongoose.Types.ObjectId(collectorIdRaw)
      : null;
    const statusKey = String(req.query.status || req.query.installment_status || 'all')
      .trim()
      .toLowerCase();

    const timezone = REPORT_TZ;
    const now = moment.tz(timezone);
    const soonEnd = now.clone().add(7, 'days').endOf('day');

    let clientIdsFilter = null;
    if (hasCollectorFilter) {
      const clients = await Client.find({ collectorId: collectorOid }).select('_id').lean();
      clientIdsFilter = clients.map((c) => c._id);
    }

    const orderMatch = {
      partyType: { $in: [null, 'client'] },
      paymentMethod: 'installment',
      status: { $ne: 'restored' },
      'installments.0': { $exists: true },
    };
    if (f.branchId) orderMatch.branch = f.branchId;
    if (hasCollectorFilter) {
      orderMatch.$or = [
        { collectorId: collectorOid },
        {
          $and: [
            { $or: [{ collectorId: null }, { collectorId: { $exists: false } }] },
            ...(clientIdsFilter?.length
              ? [{ clientId: { $in: clientIdsFilter } }]
              : [{ _id: null }]),
          ],
        },
      ];
    }
    appendOrderCustomerFilters(orderMatch, f);

    const orders = await Order.find(orderMatch)
      .select(
        'orderNumber clientId clientName clientPhoneNumber branch installmentPlanSnapshot installments totalPrice amountPaid paymentStatus collectorId'
      )
      .populate('branch', 'name')
      .populate('collectorId', 'name')
      .lean();

    if (hasCollectorFilter && !orders.length) {
      return res.json({
        filters: { ...f, collectorId: collectorOid, status: statusKey },
        summary: {
          totalAmount: 0,
          collectedAmount: 0,
          remainingAmount: 0,
          overdueAmount: 0,
          dueSoonAmount: 0,
          paidCount: 0,
          unpaidCount: 0,
          overdueCount: 0,
          promisedCount: 0,
          collectionRate: 0,
        },
        byCollector: [],
        overTime: [],
        rows: [],
      });
    }

    const clientIds = [
      ...new Set(orders.map((o) => String(o.clientId || '')).filter(Boolean)),
    ].filter((id) => mongoose.Types.ObjectId.isValid(id));

    const clients = clientIds.length
      ? await Client.find({ _id: { $in: clientIds } })
          .select('name phoneNumber collectorId')
          .populate('collectorId', 'name')
          .lean()
      : [];
    const clientById = new Map(clients.map((c) => [String(c._id), c]));

    const collectorStats = new Map();
    const allCollectors = await User.find({ role: 'Collector' }).select('name').lean();
    for (const c of allCollectors) {
      collectorStats.set(String(c._id), {
        collectorId: String(c._id),
        collectorName: c.name || '',
        totalAmount: 0,
        collectedAmount: 0,
        remainingAmount: 0,
        overdueAmount: 0,
      });
    }

    const periodFmt = f.groupBy === 'monthly' ? 'YYYY-MM' : 'YYYY-MM-DD';
    const overTimeMap = new Map();

    let totalAmount = 0;
    let collectedAmount = 0;
    let remainingAmount = 0;
    let overdueAmount = 0;
    let dueSoonAmount = 0;
    let paidCount = 0;
    let unpaidCount = 0;
    let overdueCount = 0;
    let promisedCount = 0;

    const rows = [];

    for (const order of orders) {
      const client = clientById.get(String(order.clientId)) || null;
      const orderCol = order?.collectorId;
      const clientCol = client?.collectorId;
      const colId = String(
        (orderCol && (orderCol._id || orderCol)) ||
          (clientCol && (clientCol._id || clientCol)) ||
          ''
      );
      const colName = String(
        (orderCol && orderCol.name) || (clientCol && clientCol.name) || ''
      ).trim();
      if (hasCollectorFilter && colId !== String(collectorOid)) continue;
      if (colId && !collectorStats.has(colId)) {
        collectorStats.set(colId, {
          collectorId: colId,
          collectorName: colName,
          totalAmount: 0,
          collectedAmount: 0,
          remainingAmount: 0,
          overdueAmount: 0,
        });
      }
      const colStat = colId ? collectorStats.get(colId) : null;

      for (const inst of order.installments || []) {
        const due = inst.dueDate ? moment(inst.dueDate).tz(timezone) : null;
        if (!due || !due.isValid()) continue;
        if (due.isBefore(moment(f.from)) || due.isAfter(moment(f.to))) continue;

        const amount = round2(inst.amount);
        const paidAmt = round2(
          Number(inst.paidAmount) || (inst.paid ? amount : 0)
        );
        const rem = Math.max(0, round2(amount - paidAmt));
        const isPaid = !!inst.paid || rem <= 0.001;
        const promise = inst.promiseToPayAt
          ? moment(inst.promiseToPayAt).tz(timezone)
          : null;

        let rowStatus = 'due';
        if (isPaid) rowStatus = 'paid';
        else if (promise && promise.isValid()) rowStatus = 'promised';
        else if (due.clone().endOf('day').isBefore(now)) rowStatus = 'overdue';
        else if (due.isSameOrBefore(soonEnd)) rowStatus = 'due_soon';

        if (statusKey === 'unpaid') {
          if (isPaid) continue;
        } else if (statusKey !== 'all' && statusKey !== rowStatus) {
          continue;
        }

        totalAmount = round2(totalAmount + amount);
        collectedAmount = round2(collectedAmount + Math.min(paidAmt, amount));
        remainingAmount = round2(remainingAmount + rem);
        if (isPaid) paidCount += 1;
        else unpaidCount += 1;
        if (rowStatus === 'overdue') {
          overdueAmount = round2(overdueAmount + rem);
          overdueCount += 1;
        }
        if (rowStatus === 'due_soon') dueSoonAmount = round2(dueSoonAmount + rem);
        if (rowStatus === 'promised') promisedCount += 1;

        if (colStat) {
          colStat.totalAmount = round2(colStat.totalAmount + amount);
          colStat.collectedAmount = round2(
            colStat.collectedAmount + Math.min(paidAmt, amount)
          );
          colStat.remainingAmount = round2(colStat.remainingAmount + rem);
          if (rowStatus === 'overdue') {
            colStat.overdueAmount = round2(colStat.overdueAmount + rem);
          }
        }

        const period = due.format(periodFmt);
        if (!overTimeMap.has(period)) {
          overTimeMap.set(period, { period, dueAmount: 0, collectedAmount: 0 });
        }
        const ot = overTimeMap.get(period);
        ot.dueAmount = round2(ot.dueAmount + amount);
        ot.collectedAmount = round2(ot.collectedAmount + Math.min(paidAmt, amount));

        rows.push({
          orderId: order._id,
          orderNumber: order.orderNumber,
          clientId: order.clientId,
          clientName: order.clientName || client?.name || '',
          clientPhone: order.clientPhoneNumber || client?.phoneNumber || '',
          collectorId: colId || null,
          collectorName: colName || '—',
          branchName: order.branch?.name || '',
          planName: order.installmentPlanSnapshot?.name || '',
          planMonths: order.installmentPlanSnapshot?.months || null,
          sequence: inst.sequence,
          dueDate: inst.dueDate,
          amount,
          paidAmount: Math.min(paidAmt, amount),
          remaining: rem,
          status: rowStatus,
          promiseToPayAt: inst.promiseToPayAt || null,
          paidAt: inst.paidAt || null,
        });
      }
    }

    rows.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));

    const byCollector = [...collectorStats.values()]
      .filter((c) => c.totalAmount > 0 || c.collectedAmount > 0)
      .map((c) => ({
        ...c,
        collectionRate:
          c.totalAmount > 0
            ? Math.round((c.collectedAmount / c.totalAmount) * 1000) / 10
            : 0,
      }))
      .sort((a, b) => b.collectedAmount - a.collectedAmount);

    const overTime = [...overTimeMap.values()].sort((a, b) =>
      String(a.period).localeCompare(String(b.period))
    );

    const collectionRate =
      totalAmount > 0
        ? Math.round((collectedAmount / totalAmount) * 1000) / 10
        : 0;

    return res.json({
      filters: { ...f, collectorId: collectorOid, status: statusKey },
      summary: {
        totalAmount,
        collectedAmount,
        remainingAmount,
        overdueAmount,
        dueSoonAmount,
        paidCount,
        unpaidCount,
        overdueCount,
        promisedCount,
        collectionRate,
      },
      byCollector,
      overTime,
      rows: rows.slice(0, 500),
    });
  } catch (error) {
    console.error('getInstallmentsReport:', error);
    return res.status(500).json({ error: 'Failed to generate installments report' });
  }
};

/** Online / branch pickup bookings in date range (default: active only). */
export const getBookingsReport = async (req, res) => {
  try {
    const f = parseCommonFilters(req.query, req.user);
    const status = String(req.query.booking_status || 'active');
    const match = {
      bookingDate: { $gte: f.from, $lte: f.to },
    };
    if (status === 'all') {
      // no status filter
    } else if (status === 'cancelled') {
      match.status = 'cancelled';
    } else {
      match.status = 'active';
    }
    if (f.branchId) {
      match.branch = f.branchId;
    }

    const bookings = await ProductBooking.find(match)
      .sort({ bookingDate: -1 })
      .limit(500)
      .populate('product', 'name code')
      .populate('createdBy', 'name')
      .lean();

    const rows = bookings.map((b) => ({
      productName: b.product?.name || '',
      productCode: b.product?.code || '',
      quantity: b.quantity ?? 1,
      customerName: b.customerName,
      customerPhone: b.customerPhone,
      pickupType: b.pickupType,
      shippingAddress: b.shippingAddress || '',
      depositAmount: b.depositAmount,
      bookingDate: b.bookingDate,
      status: b.status,
      createdByName: b.createdBy?.name || '',
    }));

    const pickupBreakdown = rows.reduce((acc, r) => {
      acc[r.pickupType] = (acc[r.pickupType] || 0) + 1;
      return acc;
    }, {});

    return res.json({
      filters: f,
      summary: {
        totalBookings: rows.length,
        branchPickup: pickupBreakdown.branch_pickup || 0,
        onlineShipping: pickupBreakdown.online_shipping || 0,
      },
      rows,
    });
  } catch (error) {
    console.error('getBookingsReport:', error);
    return res.status(500).json({ error: 'Failed to generate bookings report' });
  }
};

/** Desk purchase / trade-in cost by configured purchase treasury (cash drawer vs banks/wallets). */
export const getDeskPurchasesTreasuryReport = async (req, res) => {
  try {
    const f = parseCommonFilters(req.query, req.user);
    const match = {
      createdAt: { $gte: f.from, $lte: f.to },
    };
    if (f.branchId) {
      match.branch = f.branchId;
    }

    const rows = await ProductPurchaseRequest.find(match)
      .select(
        'createdAt quantity productPayload lines purchaseTreasuryKey purchaseTreasuryLabel purchaseTreasurySplits branch isExchangeTradeIn exchangeSettlementSplits'
      )
      .populate('branch', 'name')
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();

    const byKey = aggregateTreasuryAmountsFromPurchases(rows);
    let totalAmount = 0;
    for (const r of rows) {
      const splits = resolvePurchaseTreasurySplits(r);
      for (const s of splits) {
        totalAmount = round2(totalAmount + s.amount);
      }
    }

    const summaryByTreasury = Object.values(byKey)
      .map((x) => ({
        treasuryKey: x.key,
        treasuryLabel: x.label,
        totalAmount: x.total,
        intakeCount: x.count,
      }))
      .sort((a, b) => String(a.treasuryKey).localeCompare(String(b.treasuryKey)));

    /** One detail row per product when bulk multi-code / different unitDetails. */
    const lines = rows.flatMap((r) =>
      expandDeskPurchaseDetailLines(r, { branchName: r.branch?.name || '' })
    );

    return res.json({
      filters: f,
      summary: {
        totalAmount,
        totalIntakes: rows.length,
        byTreasury: summaryByTreasury,
      },
      lines,
    });
  } catch (error) {
    console.error('getDeskPurchasesTreasuryReport:', error);
    return res.status(500).json({ error: 'Failed to generate desk purchases treasury report' });
  }
};

function accountDisplayType(acc) {
  if (acc?.kind === 'cash') return 'cash';
  if (acc?.kind === 'settlement') return 'settlement';
  if (acc?.channel === 'wallet') return 'wallet';
  return 'bank';
}

function emptyLedgerTotals() {
  return { inTotal: 0, outTotal: 0 };
}

async function ledgerTotalsByAccount(match) {
  const rows = await TreasuryLedgerEntry.aggregate([
    { $match: match },
    {
      $group: {
        _id: { accountKey: '$accountKey', direction: '$direction' },
        total: { $sum: '$amount' },
      },
    },
  ]);
  const map = new Map();
  for (const r of rows) {
    const key = String(r?._id?.accountKey || '').toLowerCase();
    if (!key) continue;
    if (!map.has(key)) map.set(key, emptyLedgerTotals());
    const row = map.get(key);
    if (r._id.direction === 'in') row.inTotal = round2(r.total);
    if (r._id.direction === 'out') row.outTotal = round2(r.total);
  }
  return map;
}

/**
 * Wallets, money accounts, and payment methods: period balances + sales volume by method.
 */
export const getTreasuryAccountsReport = async (req, res) => {
  try {
    const f = parseCommonFilters(req.query, req.user);
    const { moneyAccounts, paymentMethodAccountMap, paymentMethodsCatalog } =
      await getEffectiveMoneyAccountsFromDb();
    const accounts = moneyAccounts || [];
    const keys = accounts.map((a) => a.key).filter(Boolean);
    const accountsByKey = new Map(accounts.map((a) => [a.key, a]));
    const mapByMethod = new Map((paymentMethodAccountMap || []).map((r) => [r.method, r]));

    const baseMatch = {};
    if (f.branchId) baseMatch.branch = f.branchId;
    if (keys.length) baseMatch.accountKey = { $in: keys };

    const openingMatch = keys.length ? { accountKey: { $in: keys } } : { accountKey: { $in: [] } };
    if (f.branchId) openingMatch.branch = f.branchId;

    const lastMatch = { ...baseMatch, occurredAt: { $gte: f.from, $lte: f.to } };

    const [openingDocs, beforeFrom, inPeriod, lastRows, salesByMethod, sourceRows] = await Promise.all([
      TreasuryAccountOpening.find(openingMatch).select('accountKey amount').lean(),
      keys.length
        ? ledgerTotalsByAccount({ ...baseMatch, occurredAt: { $lt: f.from } })
        : Promise.resolve(new Map()),
      keys.length
        ? ledgerTotalsByAccount({ ...baseMatch, occurredAt: { $gte: f.from, $lte: f.to } })
        : Promise.resolve(new Map()),
      keys.length
        ? TreasuryLedgerEntry.aggregate([
            { $match: lastMatch },
            { $sort: { occurredAt: -1, createdAt: -1 } },
            {
              $group: {
                _id: '$accountKey',
                occurredAt: { $first: '$occurredAt' },
                direction: { $first: '$direction' },
                amount: { $first: '$amount' },
                sourceType: { $first: '$sourceType' },
              },
            },
          ])
        : Promise.resolve([]),
      Order.aggregate([
        {
          $match: {
            createdAt: { $gte: f.from, $lte: f.to },
            status: { $ne: 'restored' },
            ...(f.branchId ? { branch: f.branchId } : {}),
          },
        },
        {
          $group: {
            _id: { $toLower: { $ifNull: ['$paymentMethod', 'cash'] } },
            totalSales: { $sum: '$totalPrice' },
            totalOrders: { $sum: 1 },
          },
        },
      ]),
      TreasuryLedgerEntry.aggregate([
        {
          $match: {
            occurredAt: { $gte: f.from, $lte: f.to },
            ...(f.branchId ? { branch: f.branchId } : {}),
            ...(keys.length ? { accountKey: { $in: keys } } : {}),
          },
        },
        {
          $group: {
            _id: { sourceType: '$sourceType', direction: '$direction' },
            total: { $sum: '$amount' },
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

    const openingAmountsByKey = new Map();
    for (const doc of openingDocs || []) {
      const key = String(doc.accountKey || '').toLowerCase();
      const list = openingAmountsByKey.get(key) || [];
      list.push(Number(doc.amount) || 0);
      openingAmountsByKey.set(key, list);
    }
    const openingByKey = new Map(
      [...openingAmountsByKey.entries()].map(([key, amounts]) => [
        key,
        companyOpeningForAccount(key, amounts),
      ])
    );

    const lastByKey = new Map(
      (lastRows || []).map((r) => [
        String(r._id || '').toLowerCase(),
        {
          occurredAt: r.occurredAt,
          direction: r.direction,
          amount: round2(r.amount),
          sourceType: r.sourceType || 'other',
        },
      ])
    );

    const typeOrder = { cash: 0, bank: 1, wallet: 2, settlement: 3 };
    const accountRows = accounts
      .map((acc) => {
        const key = acc.key;
        const openingBalance = openingByKey.get(key) || 0;
        const prior = beforeFrom.get(key) || emptyLedgerTotals();
        const period = inPeriod.get(key) || emptyLedgerTotals();
        const openingAtStart = round2(openingBalance + prior.inTotal - prior.outTotal);
        const periodIn = period.inTotal;
        const periodOut = period.outTotal;
        const expectedBalance = round2(openingAtStart + periodIn - periodOut);
        const displayType = accountDisplayType(acc);
        return {
          key,
          label: acc.label || key,
          kind: acc.kind,
          channel: acc.channel || '',
          displayType,
          accountNumber: acc.accountNumber || '',
          phone: acc.phone || '',
          enabled: acc.key === 'cash' ? true : acc.enabled !== false,
          openingAtStart,
          periodIn,
          periodOut,
          periodNet: round2(periodIn - periodOut),
          expectedBalance,
          lastMovement: lastByKey.get(key) || null,
        };
      })
      .sort((a, b) => {
        const d = (typeOrder[a.displayType] ?? 9) - (typeOrder[b.displayType] ?? 9);
        return d !== 0 ? d : String(a.label).localeCompare(String(b.label), 'ar');
      });

    const untilDate = moment(f.to).tz(REPORT_TZ).format('YYYY-MM-DD');
    const cashRow = accountRows.find((row) => isCashDrawerAccount(row.key));
    if (cashRow) {
      cashRow.expectedBalance = f.branchId
        ? await getCurrentDrawerCash(f.branchId, untilDate)
        : await sumCurrentDrawerCashAllBranches(untilDate);
    }

    const totalsByType = { cash: 0, bank: 0, wallet: 0, settlement: 0 };
    let periodInAll = 0;
    let periodOutAll = 0;
    for (const row of accountRows) {
      totalsByType[row.displayType] = round2((totalsByType[row.displayType] || 0) + row.expectedBalance);
      periodInAll = round2(periodInAll + row.periodIn);
      periodOutAll = round2(periodOutAll + row.periodOut);
    }

    const salesMap = new Map(
      (salesByMethod || []).map((r) => [
        String(r._id || 'cash').toLowerCase() || 'cash',
        { totalSales: round2(r.totalSales), totalOrders: r.totalOrders || 0 },
      ])
    );

    const catalog = paymentMethodsCatalog || [];
    const seenMethods = new Set(catalog.map((m) => m.key));
    const paymentMethods = catalog.map((row) => {
      const mapRow = mapByMethod.get(row.key);
      const accountKey = row.key === 'cash' ? 'cash' : mapRow?.accountKey || '';
      const acc = accountKey ? accountsByKey.get(accountKey) : null;
      const bankKey = mapRow?.settlementBankAccountKey || '';
      const bank = bankKey ? accountsByKey.get(bankKey) : null;
      const sales = salesMap.get(row.key) || { totalSales: 0, totalOrders: 0 };
      return {
        key: row.key,
        label: row.label || row.key,
        showIn: row.showIn || 'sale',
        effectMode: row.effectMode || 'instant',
        feePercent: Number(row.feePercent) || 0,
        accountKey,
        accountLabel: acc?.label || '',
        settlementBankAccountKey: bankKey,
        settlementBankLabel: bank?.label || '',
        totalSales: sales.totalSales,
        totalOrders: sales.totalOrders,
      };
    });

    for (const [method, sales] of salesMap.entries()) {
      if (seenMethods.has(method) || !method) continue;
      const acc = accountsByKey.get(method);
      paymentMethods.push({
        key: method,
        label: acc?.label || method,
        showIn: 'sale',
        effectMode: method === 'credit' || method === 'mixed' ? 'none' : 'instant',
        feePercent: 0,
        accountKey: '',
        accountLabel: '',
        settlementBankAccountKey: '',
        settlementBankLabel: '',
        totalSales: sales.totalSales,
        totalOrders: sales.totalOrders,
      });
    }

    const methodRank = (k) => (k === 'cash' ? 0 : k === 'credit' ? 1 : 2);
    paymentMethods.sort((a, b) => {
      const d = methodRank(a.key) - methodRank(b.key);
      if (d !== 0) return d;
      const salesDiff = (b.totalSales || 0) - (a.totalSales || 0);
      return salesDiff !== 0 ? salesDiff : String(a.label).localeCompare(String(b.label), 'ar');
    });

    const bySourceTypeMap = new Map();
    for (const r of sourceRows || []) {
      const sourceType = String(r?._id?.sourceType || 'other');
      if (!bySourceTypeMap.has(sourceType)) {
        bySourceTypeMap.set(sourceType, { sourceType, inTotal: 0, outTotal: 0, count: 0 });
      }
      const row = bySourceTypeMap.get(sourceType);
      row.count += r.count || 0;
      if (r._id.direction === 'in') row.inTotal = round2(r.total);
      if (r._id.direction === 'out') row.outTotal = round2(r.total);
    }
    const bySourceType = [...bySourceTypeMap.values()]
      .map((row) => ({
        ...row,
        net: round2(row.inTotal - row.outTotal),
      }))
      .sort((a, b) => String(a.sourceType).localeCompare(String(b.sourceType)));

    const orderSales = paymentMethods.reduce((s, m) => round2(s + (m.totalSales || 0)), 0);

    return res.json({
      filters: f,
      summary: {
        spendableTotal: round2(totalsByType.cash + totalsByType.bank + totalsByType.wallet),
        cashTotal: totalsByType.cash,
        bankTotal: totalsByType.bank,
        walletTotal: totalsByType.wallet,
        settlementTotal: totalsByType.settlement,
        accountsCount: accountRows.length,
        methodsCount: paymentMethods.length,
        periodIn: periodInAll,
        periodOut: periodOutAll,
        orderSales,
      },
      accounts: accountRows,
      paymentMethods,
      bySourceType,
    });
  } catch (error) {
    console.error('getTreasuryAccountsReport:', error);
    return res.status(500).json({ error: 'Failed to generate treasury accounts report' });
  }
};
