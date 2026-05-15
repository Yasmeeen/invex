import mongoose from 'mongoose';
import Order from '../../DB/models/order.model.js';
import Product from '../../DB/models/product.model.js';
import PurchasingRequest from '../../DB/models/purchasingRequest.model.js';
import StockMovement from '../../DB/models/stockMovement.model.js';
import ProductBooking from '../../DB/models/productBooking.model.js';
import ProductPurchaseRequest from '../../DB/models/productPurchaseRequest.model.js';
import Branch from '../../DB/models/branch.model.js';

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

const toDate = (value, fallback) => {
  const d = value ? new Date(value) : fallback;
  if (!d || Number.isNaN(d.getTime())) return fallback;
  return d;
};

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const parseCustomerPhone = (query) => {
  const v = String(query.customer_phone ?? query.customerPhone ?? '').trim();
  return v.length ? v : null;
};

/** Match orders by client ObjectId and/or phone (substring, case-insensitive). */
const appendOrderCustomerFilters = (match, f) => {
  if (f.customerId) match.clientId = f.customerId;
  if (f.customerPhone) {
    match.clientPhoneNumber = { $regex: escapeRegex(f.customerPhone), $options: 'i' };
  }
};

const parseCommonFilters = (query) => {
  const now = new Date();
  const from = toDate(query.from, new Date(now.getFullYear(), now.getMonth(), 1));
  const to = toDate(query.to, now);
  to.setHours(23, 59, 59, 999);

  return {
    from,
    to,
    branchId: mongoose.Types.ObjectId.isValid(String(query.branch_id || ''))
      ? new mongoose.Types.ObjectId(String(query.branch_id))
      : null,
    productId: mongoose.Types.ObjectId.isValid(String(query.product_id || ''))
      ? new mongoose.Types.ObjectId(String(query.product_id))
      : null,
    customerId: mongoose.Types.ObjectId.isValid(String(query.customer_id || ''))
      ? new mongoose.Types.ObjectId(String(query.customer_id))
      : null,
    customerPhone: parseCustomerPhone(query),
    groupBy: String(query.groupBy || 'daily') === 'monthly' ? 'monthly' : 'daily',
    page: Math.max(1, Number(query.page) || 1),
    limit: Math.max(1, Math.min(200, Number(query.limit) || 20)),
  };
};

const getDateGroupExpr = (groupBy) =>
  groupBy === 'monthly'
    ? { $dateToString: { format: '%Y-%m', date: '$createdAt' } }
    : { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } };

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
    if (f.productId) baseMatch['products.productId'] = f.productId;

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
    const unwindMatch = f.productId ? { 'products.productId': f.productId } : {};

    const overhead = await getBranchOverheadForReport(f.branchId);
    const daysInPeriod = calendarDaysInclusive(f.from, f.to);
    const branchOperatingCostTotal = overhead.dailyRate * daysInPeriod;

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
    const netProfitAfterBranch = round2(tradingProfit - branchOperatingCostTotal);
    const profitMargin =
      totalRevenue > 0 ? round2((netProfitAfterBranch / totalRevenue) * 100) : 0;

    const summary = {
      totalRevenue,
      totalCost,
      tradingProfit,
      branchOperatingCost: round2(branchOperatingCostTotal),
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

    const profitOverTime = (profitOverTimeRaw || []).map((row) => {
      const revenue = Number(row.revenue) || 0;
      const cost = Number(row.cost) || 0;
      const trading = round2(revenue - cost);
      let overheadAlloc = 0;
      if (f.groupBy === 'monthly') {
        const d = daysInMonthOverlappingRange(row.period, f.from, f.to);
        overheadAlloc = round2(overhead.dailyRate * d);
      } else {
        overheadAlloc = round2(overhead.dailyRate);
      }
      return {
        period: row.period,
        revenue,
        cost,
        tradingProfit: trading,
        branchOverheadAllocated: overheadAlloc,
        netProfit: round2(trading - overheadAlloc),
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
    const orderMatch = { createdAt: { $gte: f.from, $lte: f.to }, status: { $ne: 'restored' } };
    if (f.branchId) orderMatch.branch = f.branchId;
    appendOrderCustomerFilters(orderMatch, f);
    if (f.productId) orderMatch['products.productId'] = f.productId;

    const topSellingProducts = await Order.aggregate([
      { $match: orderMatch },
      { $unwind: '$products' },
      ...(f.productId ? [{ $match: { 'products.productId': f.productId } }] : []),
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

    const productMatch = {};
    if (f.branchId) productMatch.branch = f.branchId;
    if (f.productId) productMatch._id = f.productId;

    const lowStockProducts = await Product.find({ ...productMatch, stock: { $lte: lowStockThreshold } })
      .populate('branch', 'name')
      .populate('category', 'name')
      .sort({ stock: 1 })
      .limit(100)
      .lean();

    const stockPerBranch = await Product.aggregate([
      { $match: { ...productMatch, inWarehouse: { $ne: true }, branch: { $ne: null } } },
      { $group: { _id: '$branch', totalStock: { $sum: '$stock' }, productsCount: { $sum: 1 } } },
      { $lookup: { from: 'branches', localField: '_id', foreignField: '_id', as: 'branch' } },
      { $unwind: { path: '$branch', preserveNullAndEmptyArrays: true } },
      { $project: { _id: 0, branchId: '$_id', branchName: { $ifNull: ['$branch.name', 'N/A'] }, totalStock: 1, productsCount: 1 } },
      { $sort: { branchName: 1 } },
    ]);

    const [warehouseStats] = await Product.aggregate([
      { $match: { ...productMatch, inWarehouse: true } },
      { $group: { _id: null, stockInWarehouse: { $sum: '$stock' }, productsCount: { $sum: 1 } } },
      { $project: { _id: 0, stockInWarehouse: 1, productsCount: 1 } },
    ]);

    return res.json({
      filters: f,
      summary: {
        lowStockThreshold,
        stockInWarehouse: warehouseStats?.stockInWarehouse || 0,
        warehouseProductsCount: warehouseStats?.productsCount || 0,
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
      .select('createdAt quantity productPayload purchaseTreasuryKey purchaseTreasuryLabel branch')
      .populate('branch', 'name')
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();

    const byTreasury = {};
    let totalAmount = 0;
    for (const r of rows) {
      const q = Math.max(1, Math.floor(Number(r.quantity) || 1));
      const net = round2(Number(r.productPayload?.netPrice || 0));
      const line = round2(net * q);
      totalAmount = round2(totalAmount + line);
      const key = String(r.purchaseTreasuryKey || 'cash').trim().toLowerCase() || 'cash';
      const label = String(r.purchaseTreasuryLabel || '').trim() || key;
      if (!byTreasury[key]) {
        byTreasury[key] = { treasuryKey: key, treasuryLabel: label, totalAmount: 0, intakeCount: 0 };
      }
      byTreasury[key].totalAmount = round2(byTreasury[key].totalAmount + line);
      byTreasury[key].intakeCount += 1;
    }

    const summaryByTreasury = Object.values(byTreasury).sort((a, b) =>
      String(a.treasuryKey).localeCompare(String(b.treasuryKey))
    );

    const lines = rows.map((r) => {
      const q = Math.max(1, Math.floor(Number(r.quantity) || 1));
      const net = round2(Number(r.productPayload?.netPrice || 0));
      const k = String(r.purchaseTreasuryKey || 'cash').trim().toLowerCase() || 'cash';
      return {
        createdAt: r.createdAt,
        branchName: r.branch?.name || '',
        productName: r.productPayload?.name || '',
        quantity: q,
        unitCost: net,
        lineTotal: round2(net * q),
        treasuryKey: k,
        treasuryLabel: String(r.purchaseTreasuryLabel || '').trim() || k,
      };
    });

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
