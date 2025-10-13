import Order from '../../DB/models/order.model.js';
import Category from "../../DB/models/category.model.js";
import mongoose from 'mongoose';
import Product from '../../DB/models/product.model.js';
import moment from 'moment-timezone';

export const getOrdersStatstics = async (req, res) => {
  try {
    const { from, to, branch } = req.query;
    const filters = {};
    const timezone = 'Africa/Cairo';

    // 🕒 Convert date filters using Egypt local time
    if (from || to) {
      filters.createdAt = {};

      if (from) {
        const fromDate = moment.tz(from, 'YYYY-MM-DD', timezone).startOf('day').utc().toDate();
        filters.createdAt.$gte = fromDate;
      }

      if (to) {
        const toDate = moment.tz(to, 'YYYY-MM-DD', timezone).endOf('day').utc().toDate();
        filters.createdAt.$lte = toDate;
      }
    }

    // 🏢 Branch filter (optional)
    if (branch && mongoose.Types.ObjectId.isValid(branch)) {
      filters.branch = branch;
    }

    // 📦 Fetch matching orders
    const orders = await Order.find(filters).populate('products');

    // 💰 Calculate totals
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

    // ✅ Response
    return res.json({
      totalSales,
      netProfit,
      totalInvoices,
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

    // Default to current year if not provided
    const selectedYear = year ? Number(year) : new Date().getFullYear();

    // Build filter
    const filter = {
      createdAt: {
        $gte: new Date(`${selectedYear}-01-01T00:00:00Z`),
        $lte: new Date(`${selectedYear}-12-31T23:59:59Z`)
      }
    };

    if (branchId) {
      filter.branch = branchId;
    }

    // Aggregate invoices per month
    const stats = await Order.aggregate([
      { $match: filter },
      {
        $group: {
          _id: { $month: "$createdAt" },
          totalInvoices: { $sum: 1 }
        }
      },
      { $sort: { "_id": 1 } }
    ]);

    // Initialize all 12 months (in case some months have 0 invoices)
    const monthlyCounts = Array(12).fill(0);
    stats.forEach(item => {
      monthlyCounts[item._id - 1] = item.totalInvoices;
    });

    res.status(200).json({
      year: selectedYear,
      monthlyCounts, // array of 12 values
    });

  } catch (error) {
    console.error("Error fetching invoices per month:", error);
    res.status(500).json({ error: "Failed to fetch invoices per month" });
  }
};


export const getCategoriesStatistics = async (req, res) => {
  try {
    const categories = await Category.find()
      .select("name productsCount totalItems")
      .sort({ name: 1 });

    const stats = await Promise.all(
      categories.map(async (category) => {
        // if totalItems and productsCount already stored in DB, use them
        // otherwise, calculate from Product model
        let productsCount = category.productsCount || 0;
        let totalItems = category.totalItems || 0;

        // If the stored values are missing, calculate dynamically
        if (!productsCount || !totalItems) {
          const products = await Product.find({ category: category._id });
          productsCount = products.length;
          totalItems = products.reduce((acc, p) => acc + (p.stock || 0), 0);
        }

        return {
          categoryName: category.name,
          productsCount,
          totalItems,
        };
      })
    );

    res.status(200).json({ stats });
  } catch (error) {
    console.error("❌ Error fetching category stats:", error);
    res.status(500).json({ error: "Failed to fetch category stats" });
  }
};

export const getOrdersStatisticsByStatus = async (req, res) => {
  try {
    const { branch } = req.query;
    const filters = {};

    // Optional filter by branch
    if (branch && mongoose.Types.ObjectId.isValid(branch)) {
      filters.branch = branch;
    }

    // Group by status
    const stats = await Order.aggregate([
      { $match: filters },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
        },
      },
    ]);

    // Format for Highcharts
    const formatted = [
      { name: "Completed", y: 0 },
      { name: "Restored", y: 0 },
    ];

    stats.forEach((item) => {
      const key = item._id.charAt(0).toUpperCase() + item._id.slice(1);
      const target = formatted.find((f) => f.name === key);
      if (target) target.y = item.count;
    });

    res.status(200).json({ stats: formatted });
  } catch (error) {
    console.error("❌ Error fetching order stats:", error);
    res.status(500).json({ error: "Failed to fetch order stats" });
  }
};






