import Order from '../../DB/models/order.model.js';
import mongoose from 'mongoose';

export const getOrdersStatstics = async (req, res) => {
  try {
    const { from, to, branch } = req.query;

    // 1️⃣ Build query filters
    const filters = {};

    // Date filter
    if (from || to) {
      filters.createdAt = {};
      if (from) filters.createdAt.$gte = new Date(from);
      if (to) filters.createdAt.$lte = new Date(to);
    }

    // Branch filter (optional)
    if (branch && mongoose.Types.ObjectId.isValid(branch)) {
      filters.branch = branch;
    }

    // 2️⃣ Get all matching orders
    const orders = await Order.find(filters).populate('products');

    // 3️⃣ Calculate totals
    let totalSales = 0;
    let totalNetCost = 0;

    orders.forEach(order => {
      totalSales += order.totalPrice || 0;
      order.products.forEach(product => {
        totalNetCost += product.netPrice || 0;
      });
    });

    const netProfit = totalSales - totalNetCost;
    const totalInvoices = orders.length;

    // 4️⃣ Response
    return res.json({
      totalSales,      // إجمالي المبيعات
      netProfit,       // صافي الأرباح
      totalInvoices,   // عدد الفواتير
      branch: branch || 'All Branches',
      from: from || null,
      to: to || null,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load dashboard stats' });
  }
};
