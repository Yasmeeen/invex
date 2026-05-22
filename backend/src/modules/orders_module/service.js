import Order from '../../DB/models/order.model.js';
import Product from '../../DB/models/product.model.js';
import Category from '../../DB/models/category.model.js';
import Branch from '../../DB/models/branch.model.js';
import Client from "../../DB/models/client.model.js";
import Vendor from '../../DB/models/vendor.model.js';
import ProductPurchaseRequest from '../../DB/models/productPurchaseRequest.model.js';
import StockMovement from '../../DB/models/stockMovement.model.js';

import mongoose from 'mongoose';
import { auditLog } from '../audit_module/audit.service.js';
import {
  getEffectivePurchaseTreasuryMethodsFromDb,
  isDeferredPurchaseTreasury,
  treasuryMethodMap,
} from '../settings_module/treasuryMethods.js';
import { normalizeTreasurySplitsInput } from '../../utils/purchase-treasury-splits.js';

const normalizeAttrKey = (raw) =>
  String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');

function attrMapGet(attrs, key) {
  if (!attrs || !key) return '';
  if (typeof attrs.get === 'function') {
    const v = attrs.get(key);
    return v != null ? String(v).trim() : '';
  }
  const plain = attrs instanceof Map ? Object.fromEntries(attrs) : attrs;
  return String(plain[key] ?? '').trim();
}

/** Build receipt lines from product snapshot + category attributeDefs.showOnInvoice */
function buildInvoiceAttributesSnapshot(productDoc, categoryDoc) {
  const out = [];
  if (!productDoc || !categoryDoc?.attributeDefs?.length) return out;
  for (const def of categoryDoc.attributeDefs) {
    const key =
      typeof def === 'string' ? normalizeAttrKey(def) : normalizeAttrKey(def?.key);
    if (!key) continue;
    const showOnInvoice = typeof def === 'string' ? false : !!def.showOnInvoice;
    if (!showOnInvoice) continue;
    const label =
      typeof def === 'string'
        ? key
        : String(def.label || '').trim() || key;
    const val = attrMapGet(productDoc.attributes, key);
    if (!val) continue;
    // Display the exact stored attribute value in the invoice.
    out.push({ label, value: val });
  }
  return out;
}

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
          'orderNumber partyType vendorId clientName clientPhoneNumber clientAddress sellerName paymentMethod subtotalPrice invoiceDiscountAmount totalPrice amountPaid paymentStatus numberOfProducts status createdAt branch products'
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
      paymentSplits: paymentSplitsRaw,
      exchangeTradeInCreditAmount: exchangeCreditRaw,
      exchangeProductPurchaseRequestId: exchangePurchaseIdRaw,
      partyType: partyTypeRaw,
      vendorId: vendorIdRaw,
    } = req.body;

    const partyType =
      String(partyTypeRaw || 'client').trim().toLowerCase() === 'supplier'
        ? 'supplier'
        : 'client';

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
    // 1️⃣ CLIENT or SUPPLIER linkage
    // ======================
    let finalClientId = clientId;
    let finalVendorId = null;
    let saleClientName = clientName;
    let saleClientPhone = clientPhoneNumber;
    let saleClientAddress = clientAddress;
    const orderBranchOid =
      branch && mongoose.Types.ObjectId.isValid(String(branch))
        ? new mongoose.Types.ObjectId(String(branch))
        : null;

    if (partyType === 'supplier') {
      if (vendorIdRaw && mongoose.Types.ObjectId.isValid(String(vendorIdRaw))) {
        const vendorDoc = await Vendor.findById(vendorIdRaw).session(session);
        if (!vendorDoc) {
          await session.abortTransaction();
          session.endSession();
          return res.status(400).json({ error: 'Supplier not found' });
        }
        finalVendorId = vendorDoc._id;
      }
    } else {
      // Exchange: sale must use the same client as the trade-in purchase (cashier may omit client panel).
      if (
        !finalClientId &&
        exchangePurchaseIdRaw &&
        mongoose.Types.ObjectId.isValid(String(exchangePurchaseIdRaw))
      ) {
        const exchangePurchase = await ProductPurchaseRequest.findById(exchangePurchaseIdRaw)
          .select('productPayload.acquiredFrom')
          .session(session)
          .lean();
        const af = exchangePurchase?.productPayload?.acquiredFrom;
        if (af && String(af.partyType || 'client').toLowerCase() !== 'supplier') {
          if (af.clientId && mongoose.Types.ObjectId.isValid(String(af.clientId))) {
            finalClientId = new mongoose.Types.ObjectId(String(af.clientId));
          }
          const tradePhone = String(af.phone || '').trim();
          if (tradePhone) {
            saleClientPhone = tradePhone;
            saleClientName = String(af.displayName || af.name || saleClientName || '').trim() || saleClientName;
            if (af.address) {
              saleClientAddress = String(af.address).trim() || saleClientAddress;
            }
          }
        }
      }

      if (!finalClientId) {
        let client = await Client.findOne({ phoneNumber: saleClientPhone }).session(session);

        if (!client) {
          const [newClient] = await Client.create(
            [
              {
                name: saleClientName,
                phoneNumber: saleClientPhone,
                address: saleClientAddress,
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
    }

    // ======================
    // 2️⃣ CALCULATE TOTALS + UPDATE STOCK
    // ======================
    let totalPrice = 0;
    let numberOfProducts = 0;
    const orderProducts = [];
    const categoryById = new Map();

    const getCategoryCached = async (categoryId) => {
      if (!categoryId) return null;
      const id = String(categoryId);
      if (categoryById.has(id)) return categoryById.get(id);
      const doc = await Category.findById(categoryId).session(session).lean();
      categoryById.set(id, doc);
      return doc;
    };

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
      const transferReserved = Number(productDoc.transferReservedQuantity) || 0;
      const maxSellable = Number(productDoc.stock) - transferReserved;
      if (maxSellable < quantity) throw new Error(`Not enough stock for ${productDoc.name}`);

      productDoc.stock -= quantity;
      await productDoc.save({ session });

      const categoryDoc = await getCategoryCached(productDoc.category);
      const invoiceAttributes = buildInvoiceAttributesSnapshot(productDoc, categoryDoc);

      orderProducts.push({
        productId: selected._id,
        name: selected.name,
        code: selected.code,
        quantity,
        price,
        cost: itemCost || Number(productDoc.netPrice || 0),
        isApplyDiscount,
        ...(invoiceAttributes.length ? { invoiceAttributes } : {}),
      });
    }

    const subtotalPrice = Math.round(totalPrice * 100) / 100;
    let invoiceDiscountAmount = Number(invoiceDiscountRaw);
    if (!Number.isFinite(invoiceDiscountAmount)) {
      invoiceDiscountAmount = 0;
    }
    invoiceDiscountAmount = Math.round(invoiceDiscountAmount * 100) / 100;
    if (invoiceDiscountAmount >= 0) {
      invoiceDiscountAmount = Math.min(invoiceDiscountAmount, subtotalPrice);
    }
    totalPrice = Math.round((subtotalPrice - invoiceDiscountAmount) * 100) / 100;
    if (totalPrice < 0) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: 'Invalid invoice adjustment' });
    }
    const totalRounded = Math.round(totalPrice * 100) / 100;

    let exchangeTradeInCreditAmount = 0;
    const creditReq = Number(exchangeCreditRaw);
    if (Number.isFinite(creditReq) && creditReq > 0) {
      exchangeTradeInCreditAmount = Math.round(creditReq * 100) / 100;
    }
    const exchangeCreditApplied = Math.min(exchangeTradeInCreditAmount, totalRounded);
    const amountDueForPayment = Math.round((totalRounded - exchangeCreditApplied) * 100) / 100;

    let exchangeProductPurchaseRequestId;
    if (
      exchangePurchaseIdRaw &&
      mongoose.Types.ObjectId.isValid(String(exchangePurchaseIdRaw))
    ) {
      exchangeProductPurchaseRequestId = new mongoose.Types.ObjectId(String(exchangePurchaseIdRaw));
    }

    let paidAmount = 0;
    const payments = [];
    let resolvedPaymentMethod = String(paymentMethod || 'cash').trim() || 'cash';

    const useSplits = Array.isArray(paymentSplitsRaw) && paymentSplitsRaw.length > 0;

    if (useSplits) {
      const splits = paymentSplitsRaw
        .map((s) => ({
          method: String(s?.method ?? '').trim().toLowerCase(),
          amount: Math.round((Number(s?.amount) || 0) * 100) / 100,
        }))
        .filter((s) => s.method && Number.isFinite(s.amount) && s.amount >= 0);

      paidAmount = Math.round(splits.reduce((a, s) => a + s.amount, 0) * 100) / 100;

      if (paidAmount > amountDueForPayment + 0.001) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ error: 'Payment amounts exceed amount due' });
      }

      const uid = mongoose.Types.ObjectId.isValid(String(userId || ''))
        ? new mongoose.Types.ObjectId(String(userId))
        : undefined;

      const hasCreditSplit = splits.some((s) => s.method === 'credit');

      for (const s of splits) {
        if (s.amount > 0) {
          const isCreditLine = s.method === 'credit';
          payments.push({
            amount: s.amount,
            paidAt: new Date(),
            paidByUserId: uid,
            method: isCreditLine ? undefined : s.method,
            note: isCreditLine ? 'Initial payment (cashier)' : `Checkout · ${s.method}`,
          });
        }
      }

      const withMoney = splits.filter((s) => s.amount > 0 && s.method !== 'credit');
      if (paidAmount >= amountDueForPayment - 0.001) {
        resolvedPaymentMethod = hasCreditSplit
          ? 'credit'
          : withMoney.length === 0
            ? 'cash'
            : withMoney.length === 1
              ? withMoney[0].method
              : 'mixed';
      } else {
        resolvedPaymentMethod = 'credit';
      }
    } else {
      const isCredit = String(paymentMethod || '')
        .trim()
        .toLowerCase() === 'credit';

      paidAmount = Number(paidAmountRaw);
      if (!Number.isFinite(paidAmount) || paidAmount < 0) paidAmount = 0;
      paidAmount = Math.min(Math.round(paidAmount * 100) / 100, amountDueForPayment);

      if (!isCredit) {
        paidAmount = Math.round(amountDueForPayment * 100) / 100;
      }

      const methodSlug =
        String(paymentMethod || 'cash').trim().toLowerCase() || 'cash';

      if (paidAmount > 0) {
        payments.push({
          amount: paidAmount,
          paidAt: new Date(),
          paidByUserId: mongoose.Types.ObjectId.isValid(String(userId || ''))
            ? new mongoose.Types.ObjectId(String(userId))
            : undefined,
          method: isCredit ? undefined : methodSlug,
          note: isCredit ? 'Initial payment (cashier)' : 'Full payment at checkout',
        });
      }
      resolvedPaymentMethod = String(paymentMethod || 'cash').trim() || 'cash';
    }

    const paymentStatus =
      paidAmount >= amountDueForPayment - 0.001
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
          partyType,
          ...(finalVendorId ? { vendorId: finalVendorId } : {}),
          ...(finalClientId ? { clientId: finalClientId } : {}),
          clientName: saleClientName,
          clientPhoneNumber: saleClientPhone,
          clientAddress: saleClientAddress,
          sellerName,
          paymentMethod: resolvedPaymentMethod,
          branch,
          products: orderProducts,
          numberOfProducts,
          subtotalPrice,
          invoiceDiscountAmount,
          totalPrice,
          ...(exchangeCreditApplied > 0
            ? {
                exchangeTradeInCreditAmount: exchangeCreditApplied,
                ...(exchangeProductPurchaseRequestId
                  ? { exchangeProductPurchaseRequestId }
                  : {}),
              }
            : {}),
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
    const {
      amount,
      paidAt,
      userId,
      note,
      method: methodRaw,
      paymentTreasurySplits: splitsRaw,
    } = req.body || {};
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.status === 'restored') return res.status(400).json({ error: 'Order is restored' });

    const total = Number(order.totalPrice) || 0;
    const alreadyPaid = Number(order.amountPaid) || 0;
    const remaining = Math.max(0, Math.round((total - alreadyPaid) * 100) / 100);

    let applied = 0;
    let treasurySplits = [];
    const hasSplits = Array.isArray(splitsRaw) && splitsRaw.length > 0;

    if (hasSplits) {
      applied = Math.round(
        splitsRaw.reduce((acc, row) => acc + (Number(row?.amount) || 0), 0) * 100
      ) / 100;
    } else {
      const payAmount = Number(amount);
      if (!Number.isFinite(payAmount) || payAmount <= 0) {
        return res.status(400).json({ error: 'Valid amount is required' });
      }
      applied = Math.round(payAmount * 100) / 100;
    }

    applied = Math.min(applied, remaining);
    if (applied <= 0) return res.status(400).json({ error: 'Nothing remaining to pay' });

    if (hasSplits) {
      const filtered = splitsRaw.filter(
        (row) => !isDeferredPurchaseTreasury(String(row?.key || '').trim().toLowerCase())
      );
      const treasuryMethods = await getEffectivePurchaseTreasuryMethodsFromDb();
      const tMap = treasuryMethodMap(treasuryMethods);
      const treasuryNorm = normalizeTreasurySplitsInput({
        purchaseTreasurySplits: filtered,
        purchaseTreasuryKey: undefined,
        lineTotal: applied,
        treasuryMethods,
        tMap,
      });
      if (treasuryNorm.error) {
        return res.status(400).json({ error: treasuryNorm.error });
      }
      treasurySplits = treasuryNorm.splits;
    }

    const dt = paidAt ? new Date(paidAt) : new Date();
    if (Number.isNaN(dt.getTime())) return res.status(400).json({ error: 'Invalid paidAt date' });

    const uid = mongoose.Types.ObjectId.isValid(String(userId || ''))
      ? new mongoose.Types.ObjectId(String(userId))
      : undefined;

    order.payments = order.payments || [];
    const noteStr = String(note || '').trim();

    if (treasurySplits.length) {
      for (const s of treasurySplits) {
        order.payments.push({
          amount: s.amount,
          paidAt: dt,
          paidByUserId: uid,
          method: s.key,
          paymentTreasurySplits: treasurySplits,
          note: noteStr,
        });
      }
    } else {
      const methodSlug = String(methodRaw || '').trim().toLowerCase();
      order.payments.push({
        amount: applied,
        paidAt: dt,
        paidByUserId: uid,
        ...(methodSlug ? { method: methodSlug } : {}),
        note: noteStr,
      });
    }

    order.amountPaid = Math.round((alreadyPaid + applied) * 100) / 100;
    if (order.amountPaid >= total) {
      order.paymentStatus = 'paid';
    } else {
      order.paymentStatus = order.amountPaid > 0 ? 'partial' : 'unpaid';
    }

    await order.save();

    if (
      order.partyType === 'supplier' &&
      order.vendorId &&
      mongoose.Types.ObjectId.isValid(String(order.vendorId))
    ) {
      try {
        const vendor = await Vendor.findById(order.vendorId);
        if (vendor) {
          vendor.ledgerEntries = vendor.ledgerEntries || [];
          vendor.ledgerEntries.push({
            type: 'order_payment',
            amount: applied,
            orderId: order._id,
            orderNumber: order.orderNumber,
            note: String(note || '').trim() || `Payment on order #${order.orderNumber}`,
            createdAt: dt,
            createdByUserId: mongoose.Types.ObjectId.isValid(String(userId || ''))
              ? new mongoose.Types.ObjectId(String(userId))
              : undefined,
          });
          await vendor.save();
        }
      } catch (ledgerErr) {
        console.error('⚠️ Failed to log supplier payment:', ledgerErr.message);
      }
    }

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
    order.restoredAt = new Date();
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
