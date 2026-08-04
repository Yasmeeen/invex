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
import DailyExpense from '../../DB/models/dailyExpense.model.js';
import { buildPhoneSearchCandidates, digitsOnly } from '../../utils/phone-utils.js';
import {
  aggregateTreasuryAmountsFromPurchases,
  expandDeskPurchaseDetailLines,
  resolvePurchaseTreasurySplits,
} from '../../utils/purchase-treasury-splits.js';
import { NON_OPERATING_DAILY_EXPENSE_TYPES } from '../../utils/daily-expense-categories.js';

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

const parseCommonFilters = (query) => {
  const nowCairo = moment.tz(REPORT_TZ);
  const from = toDate(
    query.from,
    nowCairo.clone().startOf('month').startOf('day').utc().toDate(),
    { endOfDay: false }
  );
  const to = toDate(query.to, nowCairo.clone().endOf('day').utc().toDate(), { endOfDay: true });

  const categoryRaw = String(query.category_id || query.categoryId || '').trim();

  return {
    from,
    to,
    branchId: mongoose.Types.ObjectId.isValid(String(query.branch_id || ''))
      ? new mongoose.Types.ObjectId(String(query.branch_id))
      : null,
    productId: mongoose.Types.ObjectId.isValid(String(query.product_id || ''))
      ? new mongoose.Types.ObjectId(String(query.product_id))
      : null,
    categoryId: mongoose.Types.ObjectId.isValid(categoryRaw)
      ? new mongoose.Types.ObjectId(categoryRaw)
      : null,
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
    const f = parseCommonFilters(req.query);
    const baseMatch = {
      createdAt: { $gte: f.from, $lte: f.to },
      status: { $ne: 'restored' },
    };
    if (f.branchId) baseMatch.branch = f.branchId;
    appendOrderCustomerFilters(baseMatch, f);
    if (f.productId) {
      baseMatch['products.productId'] = f.productId;
    } else if (f.categoryId) {
      const categoryProductIds = await Product.find({ category: f.categoryId }).distinct('_id');
      baseMatch['products.productId'] = { $in: categoryProductIds };
    }
    if (f.sellerName) baseMatch.sellerName = f.sellerName;

    const [summary] = await Order.aggregate([
      { $match: baseMatch },
      { $group: { _id: null, totalSales: { $sum: '$totalPrice' }, totalOrders: { $sum: 1 } } },
      {
        $project: {
          _id: 0,
          totalSales: { $round: ['$totalSales', 2] },
          totalOrders: 1,
          averageOrderValue: {
            $cond: [{ $gt: ['$totalOrders', 0] }, { $round: [{ $divide: ['$totalSales', '$totalOrders'] }, 2] }, 0],
          },
        },
      },
    ]);

    const salesOverTime = await Order.aggregate([
      { $match: baseMatch },
      { $group: { _id: getDateGroupExpr(f.groupBy), totalSales: { $sum: '$totalPrice' }, totalOrders: { $sum: 1 } } },
      { $sort: { _id: 1 } },
      { $project: { _id: 0, period: '$_id', totalSales: { $round: ['$totalSales', 2] }, totalOrders: 1 } },
    ]);

    const salesPerBranch = await Order.aggregate([
      { $match: baseMatch },
      { $group: { _id: '$branch', totalSales: { $sum: '$totalPrice' }, totalOrders: { $sum: 1 } } },
      { $lookup: { from: 'branches', localField: '_id', foreignField: '_id', as: 'branch' } },
      { $unwind: { path: '$branch', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          branchId: '$_id',
          branchName: { $ifNull: ['$branch.name', 'N/A'] },
          totalSales: { $round: ['$totalSales', 2] },
          totalOrders: 1,
        },
      },
      { $sort: { totalSales: -1 } },
    ]);

    const salesByPaymentCategory = await Order.aggregate([
      { $match: baseMatch },
      { $addFields: { paymentCategory: salesPaymentCategoryExpr } },
      {
        $group: {
          _id: '$paymentCategory',
          totalSales: { $sum: '$totalPrice' },
          totalOrders: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
      {
        $project: {
          _id: 0,
          category: '$_id',
          totalSales: { $round: ['$totalSales', 2] },
          totalOrders: 1,
        },
      },
    ]);

    return res.json({
      filters: f,
      summary: summary || { totalSales: 0, totalOrders: 0, averageOrderValue: 0 },
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
    const f = parseCommonFilters(req.query);
    const match = { createdAt: { $gte: f.from, $lte: f.to }, status: { $ne: 'restored' } };
    if (f.branchId) match.branch = f.branchId;
    appendOrderCustomerFilters(match, f);
    if (f.productId) match['products.productId'] = f.productId;
    if (f.sellerName) match.sellerName = f.sellerName;
    const unwindMatch = f.productId ? { 'products.productId': f.productId } : {};

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
      { $match: match },
      { $unwind: '$products' },
      { $match: unwindMatch },
      {
        $addFields: {
          revenue: { $multiply: ['$products.price', '$products.quantity'] },
          cost: { $multiply: [{ $ifNull: ['$products.cost', 0] }, '$products.quantity'] },
        },
      },
      { $group: { _id: null, totalRevenue: { $sum: '$revenue' }, totalCost: { $sum: '$cost' } } },
      {
        $project: {
          _id: 0,
          totalRevenue: { $round: ['$totalRevenue', 2] },
          totalCost: { $round: ['$totalCost', 2] },
          tradingProfit: { $round: [{ $subtract: ['$totalRevenue', '$totalCost'] }, 2] },
        },
      },
    ]);

    const totalRevenue = aggSummary?.totalRevenue ?? 0;
    const totalCost = aggSummary?.totalCost ?? 0;
    const tradingProfit = aggSummary?.tradingProfit ?? round2(totalRevenue - totalCost);
    const dailyExpensesTotal = dailyExpenses.total;
    const netProfitAfterBranch = round2(
      tradingProfit - branchOperatingCostTotal - dailyExpensesTotal
    );
    const profitMargin =
      totalRevenue > 0 ? round2((netProfitAfterBranch / totalRevenue) * 100) : 0;

    const summary = {
      totalRevenue,
      totalCost,
      tradingProfit,
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
      { $match: match },
      { $unwind: '$products' },
      { $match: unwindMatch },
      {
        $addFields: {
          revenue: { $multiply: ['$products.price', '$products.quantity'] },
          cost: { $multiply: [{ $ifNull: ['$products.cost', 0] }, '$products.quantity'] },
        },
      },
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

    const salesByPeriod = new Map(
      (profitOverTimeRaw || []).map((row) => [String(row.period), row])
    );
    const allPeriods = [
      ...new Set([...salesByPeriod.keys(), ...dailyExpenses.byPeriod.keys()]),
    ].sort();

    const profitOverTime = allPeriods.map((period) => {
      const row = salesByPeriod.get(period);
      const revenue = Number(row?.revenue) || 0;
      const cost = Number(row?.cost) || 0;
      const trading = round2(revenue - cost);
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
        tradingProfit: trading,
        branchOverheadAllocated: overheadAlloc,
        dailyExpenses: periodDailyExpenses,
        netProfit: round2(trading - overheadAlloc - periodDailyExpenses),
      };
    });

    return res.json({
      filters: f,
      summary,
      profitOverTime,
    });
  } catch (error) {
    console.error('getProfitReport:', error);
    return res.status(500).json({ error: 'Failed to generate profit report' });
  }
};

export const getProductsReport = async (req, res) => {
  try {
    const f = parseCommonFilters(req.query);
    const lowStockThreshold = Math.max(0, Number(req.query.lowStockThreshold) || 5);
    const supplierProductIds =
      f.supplierPhone || f.supplierId
        ? await resolveSupplierProductIds(f.supplierPhone, f.supplierId)
        : null;

    const orderMatch = { createdAt: { $gte: f.from, $lte: f.to }, status: { $ne: 'restored' } };
    if (f.branchId) orderMatch.branch = f.branchId;
    appendOrderCustomerFilters(orderMatch, f);

    let scopedProductIds = f.productId || null;
    if (f.categoryId && !f.productId) {
      const categoryProductIds = await Product.find({ category: f.categoryId }).distinct('_id');
      scopedProductIds = { $in: categoryProductIds };
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
    if (f.categoryId) productMatch.category = f.categoryId;
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
    const f = parseCommonFilters(req.query);
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
    const f = parseCommonFilters(req.query);
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
    const f = parseCommonFilters(req.query);
    const now = new Date();
    const match = { createdAt: { $gte: f.from, $lte: f.to } };

    const upcomingInstallments = await PurchasingRequest.aggregate([
      { $match: match },
      { $unwind: '$installments' },
      { $match: { 'installments.paid': false, 'installments.dueDate': { $gte: now } } },
      { $project: { _id: 0, requestId: '$_id', supplier: '$supplier', dueDate: '$installments.dueDate', amount: '$installments.amount', paid: '$installments.paid', status: '$status' } },
      { $sort: { dueDate: 1 } },
      { $limit: 200 },
    ]);

    const overdueInstallments = await PurchasingRequest.aggregate([
      { $match: match },
      { $unwind: '$installments' },
      { $match: { 'installments.paid': false, 'installments.dueDate': { $lt: now } } },
      { $project: { _id: 0, requestId: '$_id', supplier: '$supplier', dueDate: '$installments.dueDate', amount: '$installments.amount', paid: '$installments.paid', status: '$status' } },
      { $sort: { dueDate: 1 } },
      { $limit: 200 },
    ]);

    const [paidVsUnpaid] = await PurchasingRequest.aggregate([
      { $match: match },
      { $unwind: '$installments' },
      {
        $group: {
          _id: null,
          paidCount: { $sum: { $cond: ['$installments.paid', 1, 0] } },
          unpaidCount: { $sum: { $cond: ['$installments.paid', 0, 1] } },
          paidAmount: { $sum: { $cond: ['$installments.paid', '$installments.amount', 0] } },
          unpaidAmount: { $sum: { $cond: ['$installments.paid', 0, '$installments.amount'] } },
        },
      },
      { $project: { _id: 0, paidCount: 1, unpaidCount: 1, paidAmount: { $round: ['$paidAmount', 2] }, unpaidAmount: { $round: ['$unpaidAmount', 2] } } },
    ]);

    return res.json({
      filters: f,
      summary: paidVsUnpaid || { paidCount: 0, unpaidCount: 0, paidAmount: 0, unpaidAmount: 0 },
      upcomingInstallments,
      overdueInstallments,
    });
  } catch (error) {
    console.error('getInstallmentsReport:', error);
    return res.status(500).json({ error: 'Failed to generate installments report' });
  }
};

/** Online / branch pickup bookings in date range (default: active only). */
export const getBookingsReport = async (req, res) => {
  try {
    const f = parseCommonFilters(req.query);
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
    const f = parseCommonFilters(req.query);
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

    /** One detail row per device when bulk multi-code / different unitDetails. */
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
