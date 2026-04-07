import Order from '../../DB/models/order.model.js';
import Product from '../../DB/models/product.model.js';
import Branch from '../../DB/models/branch.model.js';
import Client from "../../DB/models/client.model.js";
import StockMovement from '../../DB/models/stockMovement.model.js';

import mongoose from 'mongoose';
import { auditLog } from '../audit_module/audit.service.js';

export const getOrders = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = '',
      searchBranch = '',
      status,
      paymentMethod,
    } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const query = {};

    // ✅ 1. Optional status filter
    if (status && status.trim() !== '') {
      query.status = status;
    }

    // ✅ 1b. Optional payment method filter (cash, visa, valu, …)
    if (paymentMethod && String(paymentMethod).trim() !== '') {
      query.paymentMethod = String(paymentMethod).trim();
    }

    // ✅ 2. Search by order number, client name, or phone number
    if (search) {
      const isNumber = !isNaN(search);
      query.$or = [
        { clientName: { $regex: search, $options: 'i' } },
        { clientPhoneNumber: { $regex: search, $options: 'i' } },
      ];
      if (isNumber) {
        query.$or.push({ orderNumber: Number(search) });
      }
    }

    // ✅ 3. Search by branch name (works independently)
    if (searchBranch) {
      const branch = await Branch.findOne({
        name: { $regex: searchBranch, $options: 'i' },
      });

      if (branch) {
        query.branch = branch._id;
      } else {
        return res.json({
          orders: [],
          meta: {
            currentPage: Number(page),
            totalCount: 0,
            totalPages: 0,
          },
        });
      }
    }

    // ✅ 4. Fetch orders (with branch populated)
    const [orders, total] = await Promise.all([
      Order.find(query)
        .select(
          'orderNumber clientName clientPhoneNumber clientAddress sellerName paymentMethod subtotalPrice invoiceDiscountAmount totalPrice amountPaid paymentStatus numberOfProducts status createdAt branch products'
        )
        .populate('branch', 'name')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),

      Order.countDocuments(query),
    ]);

    const totalPages = Math.ceil(total / limit);

    // ✅ 5. Respond
    res.json({
      orders,
      meta: {
        currentPage: Number(page),
        nextPage: page < totalPages ? Number(page) + 1 : null,
        prevPage: page > 1 ? Number(page) - 1 : null,
        totalCount: total,
        totalPages,
      },
    });
  } catch (error) {
    console.error('❌ Error fetching orders:', error);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
};



export const getOrderById = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    res.json(order);
  } catch (err) {
    console.error('❌ Error fetching order:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

export const createOrder = async (req, res) => {

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      clientId, // optional
      clientName,
      clientPhoneNumber,
      sellerName,
      clientAddress,
      paymentMethod,
      branch,
      products,
      status,
      userId,
      invoiceDiscountAmount: invoiceDiscountRaw,
      paidAmount: paidAmountRaw,
    } = req.body;

    // validation
    if ( !clientPhoneNumber ) {
      return res.status(400).json({
        error: "clientPhoneNumber is required",
      });
    }

    if (!products || products.length === 0) {
      return res.status(400).json({ error: "Order must contain at least one product" });
    }

    // ======================
    // 1️⃣ GET OR CREATE CLIENT (+ link order branch for clients list / Branch Manager filter)
    // ======================
    let finalClientId = clientId;
    const orderBranchOid =
      branch && mongoose.Types.ObjectId.isValid(String(branch))
        ? new mongoose.Types.ObjectId(String(branch))
        : null;

    if (!finalClientId) {
      let client = await Client.findOne({ phoneNumber: clientPhoneNumber }).session(session);

      if (!client) {
        const [newClient] = await Client.create(
          [
            {
              name: clientName,
              phoneNumber: clientPhoneNumber,
              address: clientAddress,
              branches: orderBranchOid ? [orderBranchOid] : [],
            },
          ],
          { session }
        );
        client = newClient;
      } else if (orderBranchOid) {
        await Client.updateOne(
          { _id: client._id },
          { $addToSet: { branches: orderBranchOid } },
          { session }
        );
      }

      finalClientId = client._id;
    } else if (orderBranchOid) {
      await Client.updateOne(
        { _id: finalClientId },
        { $addToSet: { branches: orderBranchOid } },
        { session }
      );
    }

    // ======================
    // 2️⃣ CALCULATE TOTALS + UPDATE STOCK
    // ======================
    let totalPrice = 0;
    let numberOfProducts = 0;
    const orderProducts = [];

    for (const item of products) {
      const selected = item.selectedProduct;
      if (!selected || !selected._id) continue;

      const quantity = Number(item.quantity) || 1;
      numberOfProducts += quantity;

      let price = Number(selected.price) || 0;
      const itemCost = Number(selected.netPrice ?? selected.cost ?? 0);
      const isApplyDiscount = !!selected.isApplyDiscount;

      if (isApplyDiscount && selected.discount > 0) {
        price = price - (price * selected.discount) / 100;
      }

      totalPrice += price * quantity;

      const productDoc = await Product.findById(selected._id).session(session);
      if (!productDoc) throw new Error(`Product not found: ${selected._id}`);
      if (productDoc.stock < quantity) throw new Error(`Not enough stock for ${productDoc.name}`);

      productDoc.stock -= quantity;
      await productDoc.save({ session });

      orderProducts.push({
        productId: selected._id,
        name: selected.name,
        code: selected.code,
        quantity,
        price,
        cost: itemCost || Number(productDoc.netPrice || 0),
        isApplyDiscount,
      });
    }

    const subtotalPrice = Math.round(totalPrice * 100) / 100;
    let invoiceDiscountAmount = Number(invoiceDiscountRaw);
    if (!Number.isFinite(invoiceDiscountAmount) || invoiceDiscountAmount < 0) {
      invoiceDiscountAmount = 0;
    }
    invoiceDiscountAmount = Math.min(
      Math.round(invoiceDiscountAmount * 100) / 100,
      subtotalPrice
    );
    totalPrice = Math.round((subtotalPrice - invoiceDiscountAmount) * 100) / 100;

    let paidAmount = Number(paidAmountRaw);
    if (!Number.isFinite(paidAmount) || paidAmount < 0) paidAmount = 0;
    paidAmount = Math.min(Math.round(paidAmount * 100) / 100, totalPrice);

    const payments = [];
    if (paidAmount > 0) {
      payments.push({
        amount: paidAmount,
        paidAt: new Date(),
        paidByUserId: mongoose.Types.ObjectId.isValid(String(userId || ''))
          ? new mongoose.Types.ObjectId(String(userId))
          : undefined,
        note: 'Initial payment (cashier)',
      });
    }

    const paymentStatus =
      paidAmount >= totalPrice
        ? 'paid'
        : paidAmount > 0
        ? 'partial'
        : 'unpaid';

    // ======================
    // 3️⃣ GENERATE ORDER NUMBER
    // ======================
    const lastOrder = await Order.findOne().sort({ orderNumber: -1 }).lean();
    const nextOrderNumber = Number(lastOrder?.orderNumber || 0) + 1;

    // ======================
    // 4️⃣ CREATE ORDER WITH CASHIER
    // ======================
    const [newOrder] = await Order.create(
      [
        {
          orderNumber: nextOrderNumber,
          clientId: finalClientId,
          clientName,
          clientPhoneNumber,
          clientAddress,
          sellerName,
          paymentMethod,
          branch,
          products: orderProducts,
          numberOfProducts,
          subtotalPrice,
          invoiceDiscountAmount,
          totalPrice,
          amountPaid: paidAmount,
          paymentStatus,
          payments,
          status,
          cashierId: userId, 
          },
      ],
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    // Stock movement logs (non-transactional audit trail)
    try {
      const movementDocs = orderProducts.map((item) => ({
        movementType: 'sale',
        productId: item.productId,
        productName: item.name,
        branchId: branch || null,
        fromBranchId: branch || null,
        toBranchId: null,
        quantity: Number(item.quantity || 0),
        unitPrice: Number(item.price || 0),
        totalValue: Number(item.price || 0) * Number(item.quantity || 0),
        referenceType: 'order',
        referenceId: newOrder._id,
        notes: `Order #${newOrder.orderNumber}`,
      }));
      if (movementDocs.length) {
        await StockMovement.insertMany(movementDocs);
      }
    } catch (movementError) {
      console.error('⚠️ Failed to log sale stock movement:', movementError.message);
    }

    await auditLog(req, {
      action: 'create',
      module: 'orders',
      entityType: 'Order',
      entityId: newOrder?._id,
      message: `Order created #${newOrder?.orderNumber ?? ''}`.trim(),
      metadata: {
        orderNumber: newOrder?.orderNumber,
        subtotalPrice: newOrder?.subtotalPrice,
        invoiceDiscountAmount: newOrder?.invoiceDiscountAmount,
        totalPrice: newOrder?.totalPrice,
        numberOfProducts: newOrder?.numberOfProducts,
        paymentMethod: newOrder?.paymentMethod,
        branch: newOrder?.branch,
        status: newOrder?.status,
      },
    });

    const newOrderPlain =
      typeof newOrder?.toObject === 'function' ? newOrder.toObject() : newOrder;

    res.status(201).json({
      message: "✅ Order created successfully",
      newOrder: newOrderPlain,
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error("❌ Error creating order:", err);
    res.status(500).json({ error: "Server error", details: err.message });
  }
};

export const addOrderPayment = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { amount, paidAt, userId, note } = req.body || {};
    const payAmount = Number(amount);
    if (!Number.isFinite(payAmount) || payAmount <= 0) {
      return res.status(400).json({ error: 'Valid amount is required' });
    }
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.status === 'restored') return res.status(400).json({ error: 'Order is restored' });

    const total = Number(order.totalPrice) || 0;
    const alreadyPaid = Number(order.amountPaid) || 0;
    const remaining = Math.max(0, Math.round((total - alreadyPaid) * 100) / 100);
    const applied = Math.min(Math.round(payAmount * 100) / 100, remaining);
    if (applied <= 0) return res.status(400).json({ error: 'Nothing remaining to pay' });

    const dt = paidAt ? new Date(paidAt) : new Date();
    if (Number.isNaN(dt.getTime())) return res.status(400).json({ error: 'Invalid paidAt date' });

    order.payments = order.payments || [];
    order.payments.push({
      amount: applied,
      paidAt: dt,
      paidByUserId: mongoose.Types.ObjectId.isValid(String(userId || ''))
        ? new mongoose.Types.ObjectId(String(userId))
        : undefined,
      note: String(note || '').trim(),
    });

    order.amountPaid = Math.round((alreadyPaid + applied) * 100) / 100;
    if (order.amountPaid >= total) {
      order.paymentStatus = 'paid';
    } else {
      order.paymentStatus = order.amountPaid > 0 ? 'partial' : 'unpaid';
    }

    await order.save();

    await auditLog(req, {
      action: 'payment',
      module: 'orders',
      entityType: 'Order',
      entityId: order._id,
      message: `Order payment ${applied}`,
      metadata: { amount: applied, amountPaid: order.amountPaid, totalPrice: total },
    });

    res.json({ message: '✅ Payment added', order });
  } catch (error) {
    console.error('addOrderPayment:', error);
    res.status(500).json({ error: 'Failed to add payment' });
  }
};




export const updateOrder = async (req, res) => {
  try {
    const {
      clientName,
      clientPhoneNumber,
      sellerName,
      clientAddress,
      branch,
      products,
      status,
    } = req.body;

    if (!clientName || !clientPhoneNumber || !sellerName || !clientAddress) {
      return res.status(400).json({
        error: 'clientName, clientPhoneNumber, sellerName, and clientAddress are required',
      });
    }

    if (!products || products.length === 0) {
      return res.status(400).json({ error: 'Order must contain at least one product' });
    }

    // Fetch products from DB to calculate total
    const dbProducts = await Product.find({ _id: { $in: products } });

    if (dbProducts.length !== products.length) {
      return res.status(400).json({ error: 'Some products not found' });
    }

    const totalPrice = dbProducts.reduce((sum, p) => sum + p.price, 0);
    const numberOfProducts = dbProducts.length;

    const newOrder = await Order.create({
      clientName,
      clientPhoneNumber,
      sellerName,
      clientAddress,
      branch,
      products,
      numberOfProducts,
      totalPrice,
      status, // defaults to "pending" if not provided
    });

    res.status(201).json({ message: '✅ Order created', order: newOrder });
  } catch (err) {
    console.error('❌ Error creating order:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
};


export const restoreOrder = async (req, res) => {
  try {
    const { orderId } = req.params;
    const actorUserId = req.body?.userId || req.query?.userId;

    // ✅ Get order directly (no populate)
    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (order.status === 'restored') {
      return res.status(400).json({ error: 'Order is already restored' });
    }

    // ✅ Restore stock for each product
    for (const item of order.products) {
      if (!item.productId) continue; // skip malformed data

      const product = await Product.findById(item.productId);
      if (product) {
        product.stock += item.quantity;
        await product.save();

        try {
          await StockMovement.create({
            movementType: 'return',
            productId: product._id,
            productName: product.name,
            branchId: order.branch || null,
            fromBranchId: null,
            toBranchId: order.branch || null,
            quantity: Number(item.quantity || 0),
            unitPrice: Number(item.price || 0),
            totalValue: Number(item.price || 0) * Number(item.quantity || 0),
            referenceType: 'order',
            referenceId: order._id,
            notes: `Restore order #${order.orderNumber}`,
          });
        } catch (movementError) {
          console.error('⚠️ Failed to log return stock movement:', movementError.message);
        }

        console.log(`✅ Restored ${item.quantity} to ${product.name} (new stock: ${product.stock})`);
      } else {
        console.warn(`⚠️ Product not found for ID: ${item.productId}`);
      }
    }

    // ✅ Update order status
    order.status = 'restored';
    await order.save();

    await auditLog(req, {
      action: 'restore',
      module: 'orders',
      entityType: 'Order',
      entityId: order?._id,
      message: `Order restored #${order?.orderNumber ?? ''}`.trim(),
      metadata: { orderNumber: order?.orderNumber, branch: order?.branch, status: order?.status, actorUserId },
    });

    res.json({
      message: '✅ Order restored successfully',
      restoredOrder: order,
    });
  } catch (error) {
    console.error('❌ Error restoring order:', error);
    res.status(500).json({ error: 'Server error restoring order', details: error.message });
  }
};






export const deleteOrder = async (req, res) => {
  try {
    const deletedOrder = await Order.findByIdAndDelete(req.params.id);

    if (!deletedOrder) {
      return res.status(404).json({ error: 'Order not found' });
    }

    await auditLog(req, {
      action: 'delete',
      module: 'orders',
      entityType: 'Order',
      entityId: deletedOrder?._id,
      message: `Order deleted #${deletedOrder?.orderNumber ?? ''}`.trim(),
      metadata: { orderNumber: deletedOrder?.orderNumber, branch: deletedOrder?.branch },
      before: {
        orderNumber: deletedOrder?.orderNumber,
        totalPrice: deletedOrder?.totalPrice,
        status: deletedOrder?.status,
      },
    });

    res.json({ message: '✅ Order deleted' });
  } catch (err) {
    console.error('❌ Error deleting order:', err.message);
    res.status(500).json({ error: 'Server error' });
  }

  
};
