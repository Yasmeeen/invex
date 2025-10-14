import Order from '../../DB/models/order.model.js';
import Category from "../../DB/models/category.model.js";
import mongoose from 'mongoose';
import Product from '../../DB/models/product.model.js';
import moment from 'moment-timezone';

export const getOrdersStatstics = async (req, res) => {
  try {
    const { from, to, branch } = req.query;
    const timezone = 'Africa/Cairo';

    // 🕒 Date range filters
    const dateFilter = {};
    if (from || to) {
      if (from) {
        dateFilter.$gte = moment.tz(from, 'YYYY-MM-DD', timezone).startOf('day').utc().toDate();
      }
      if (to) {
        dateFilter.$lte = moment.tz(to, 'YYYY-MM-DD', timezone).endOf('day').utc().toDate();
      }
    }

    // 🏢 Optional branch filter
    const branchFilter = branch && mongoose.Types.ObjectId.isValid(branch)
      ? { branch }
      : {};

    // ✅ Filters for completed orders
    const completedFilters = {
      status: 'completed',
      ...branchFilter,
      ...(Object.keys(dateFilter).length ? { createdAt: dateFilter } : {}),
    };

    // ✅ Filters for total invoices (completed + restored)
    const allInvoicesFilters = {
      status: { $in: ['completed', 'restored'] },
      ...branchFilter,
      ...(Object.keys(dateFilter).length ? { createdAt: dateFilter } : {}),
    };

    // 📦 Fetch completed and all invoices
    const [completedOrders, totalInvoicesCount] = await Promise.all([
      Order.find(completedFilters),
      Order.countDocuments(allInvoicesFilters),
    ]);

    // 💰 Calculate totals
    let totalSales = 0;
    let totalNetCost = 0;

    for (const order of completedOrders) {
      totalSales += order.totalPrice || 0;

      for (const productItem of order.products) {
        const productId = productItem.productId || productItem._id || productItem;
        const quantity = productItem.quantity || 1;

        const realProduct = await Product.findById(productId).select('netPrice');
        if (realProduct && realProduct.netPrice) {
          totalNetCost += realProduct.netPrice * quantity;
        }
      }
    }

    const netProfit = totalSales - totalNetCost;

    // ✅ Response
    return res.json({
      totalSales,
      netProfit,
      totalInvoices: totalInvoicesCount, // ✅ includes completed + restored
      branch: branch || 'All Branches',
      from: from || null,
      to: to || null,
    });
  } catch (error) {
    console.error('Error fetching order stats:', error);
    res.status(500).json({ error: 'Failed to load dashboard stats' });
  }
};




export const getInvoicesPerMonth = async (req, res) => {
  try {
    const { branchId, year } = req.query;
    const selectedYear = year ? Number(year) : new Date().getFullYear();

    const timezone = 'Africa/Cairo';

    // Define start and end of year using Cairo timezone
    const startOfYear = moment.tz(`${selectedYear}-01-01`, timezone).startOf('day').utc().toDate();
    const endOfYear = moment.tz(`${selectedYear}-12-31`, timezone).endOf('day').utc().toDate();

    const filter = {
      createdAt: { $gte: startOfYear, $lte: endOfYear },
    };

    // Optional branch filter
    if (branchId && mongoose.Types.ObjectId.isValid(branchId)) {
      filter.branch = new mongoose.Types.ObjectId(branchId);
    }

    const stats = await Order.aggregate([
      { $match: filter },
      {
        $group: {
          _id: { $month: "$createdAt" },
          totalInvoices: { $sum: 1 },
        },
      },
      { $sort: { "_id": 1 } },
    ]);

    // Fill missing months with 0
    const monthlyCounts = Array(12).fill(0);
    stats.forEach((item) => {
      monthlyCounts[item._id - 1] = item.totalInvoices;
    });

    res.status(200).json({
      year: selectedYear,
      branch: branchId || "All Branches",
      monthlyCounts,
    });
  } catch (error) {
    console.error("❌ Error fetching invoices per month:", error);
    res.status(500).json({ error: "Failed to fetch invoices per month" });
  }
};

/**
 * 🏷️ 2. Get Category Statistics (filtered by branch if provided)
 */
export const getCategoriesStatistics = async (req, res) => {
  try {
    const { branch } = req.query;
    const branchFilter = branch && mongoose.Types.ObjectId.isValid(branch)
      ? { branch: new mongoose.Types.ObjectId(branch) }
      : {};

    const categories = await Category.find().select("name").sort({ name: 1 });

    const stats = await Promise.all(
      categories.map(async (category) => {
        // Count products and total stock for that category
        const products = await Product.find({
          category: category._id,
          ...branchFilter, // optional branch filter
        });

        const productsCount = products.length;
        const totalItems = products.reduce((acc, p) => acc + (p.stock || 0), 0);

        return {
          categoryName: category.name,
          productsCount,
          totalItems,
        };
      })
    );

    res.status(200).json({
      branch: branch || "All Branches",
      stats,
    });
  } catch (error) {
    console.error("❌ Error fetching category stats:", error);
    res.status(500).json({ error: "Failed to fetch category stats" });
  }
};

/**
 * 🛒 3. Get Orders Statistics by Status
 */
export const getOrdersStatisticsByStatus = async (req, res) => {
  try {
    const { branch } = req.query;
    const filters = {};

    // Optional filter by branch
    if (branch && mongoose.Types.ObjectId.isValid(branch)) {
      filters.branch = new mongoose.Types.ObjectId(branch);
    }

    const stats = await Order.aggregate([
      { $match: filters },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
        },
      },
    ]);

    // Initialize chart structure
    const formatted = [
      { name: "Completed", y: 0 },
      { name: "Restored", y: 0 },
    ];

    stats.forEach((item) => {
      const key = item._id.charAt(0).toUpperCase() + item._id.slice(1);
      const target = formatted.find((f) => f.name === key);
      if (target) target.y = item.count;
    });

    res.status(200).json({
      branch: branch || "All Branches",
      stats: formatted,
    });
  } catch (error) {
    console.error("❌ Error fetching order stats:", error);
    res.status(500).json({ error: "Failed to fetch order stats" });
  }
};





