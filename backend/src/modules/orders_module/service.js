import Order from '../../DB/models/order.model.js';
import Product from '../../DB/models/product.model.js';
import Category from '../../DB/models/category.model.js';
import Branch from '../../DB/models/branch.model.js';
import Client from "../../DB/models/client.model.js";
import Vendor from '../../DB/models/vendor.model.js';
import User from '../../DB/models/user.model.js';
import ProductPurchaseRequest from '../../DB/models/productPurchaseRequest.model.js';
import StockMovement from '../../DB/models/stockMovement.model.js';

import mongoose from 'mongoose';
import moment from 'moment-timezone';
import { auditLog } from '../audit_module/audit.service.js';
import { resolveBranchForCashDrawer } from '../../utils/vendor-cash-drawer.js';
import { recordExchangeSettlement } from '../../utils/exchange-settlement.js';
import { finalizeExchangeTradeInPurchaseInSession } from '../product_purchase_requests_module/service.js';
import {
  processFullOrderRestore,
  processOrderReturn,
  salesReturnTreasuryRefundLines,
} from '../../utils/order-return.js';
import ProductBooking from '../../DB/models/productBooking.model.js';
import {
  consumeBookingsForSale,
  reconcileBookingsToStock,
} from '../product_bookings_module/service.js';
import {
  postOrderPaymentLinesToLedger,
  postRefundPaymentLinesToLedger,
  postTreasurySplitOutflows,
  safeTreasuryPost,
} from '../../utils/treasury-ledger.js';
import { notifyProductChanged } from '../integrations_module/catalogSync.js';
import { getOrCreateStoreSettings } from '../settings_module/storeSettingsDoc.js';
import { normalizePaymentMethodsCatalog } from '../settings_module/paymentMethodsCatalog.js';
import {
  catalogCreditFeePercent,
  creditMarkupAmount,
  creditOnAccountAmount,
  distributeAmountOntoLinePrices,
  roundMoney,
} from '../../utils/credit-sale-markup.js';
import InstallmentPlan from '../../DB/models/installmentPlan.model.js';
import {
  applyPaymentToInstallments,
  allocateInstallmentProfitShares,
  buildSaleInstallmentSchedule,
  ensureInstallmentProfitShares,
  orderLineTradingProfit,
} from '../../utils/sale-installments.js';
import {
  clearInstallmentPromiseToPay,
  serializePastPromiseHistory,
  setInstallmentPromiseToPay,
} from '../../utils/promise-to-pay.js';

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

function last10Digits(phone) {
  return String(phone || '').replace(/\D/g, '').slice(-10);
}

function bookingBelongsToSaleClient(booking, finalClientId, saleClientPhone) {
  const bookingClient = booking?.client ? String(booking.client) : '';
  const orderClient = finalClientId ? String(finalClientId) : '';
  const phoneOk =
    last10Digits(saleClientPhone).length >= 10 &&
    last10Digits(saleClientPhone) === last10Digits(booking?.customerPhone);
  if (orderClient && bookingClient && orderClient !== bookingClient && !phoneOk) {
    return false;
  }
  if (!orderClient && !phoneOk) {
    return false;
  }
  return true;
}

/**
 * Units reserved for this checkout client (website/POS booking).
 * Those units must be sellable to the same customer at cashier.
 */
async function clientReservedQtyByProductId({
  session,
  partyType,
  finalClientId,
  saleClientPhone,
  productIds,
}) {
  const map = new Map();
  if (partyType !== 'client' || !productIds.length) return map;
  const oids = productIds.filter((id) => mongoose.Types.ObjectId.isValid(String(id)));
  if (!oids.length) return map;
  const bookings = await ProductBooking.find({
    product: { $in: oids.map((id) => new mongoose.Types.ObjectId(String(id))) },
    status: 'active',
  })
    .session(session)
    .lean();
  for (const b of bookings) {
    if (!bookingBelongsToSaleClient(b, finalClientId, saleClientPhone)) continue;
    const pid = String(b.product);
    const qty = Math.max(1, Math.floor(Number(b.quantity) || 1));
    map.set(pid, (map.get(pid) || 0) + qty);
  }
  return map;
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

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function normalizePaymentFeeAllocations(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => ({
      forMethod: String(row?.forMethod ?? '').trim().toLowerCase(),
      feeNet: round2(Number(row?.feeNet) || 0),
      paidVia: String(row?.paidVia ?? '').trim().toLowerCase(),
      feeGrossOnPaidVia: round2(Number(row?.feeGrossOnPaidVia) || 0),
      feePercentSnapshot: round2(Number(row?.feePercentSnapshot) || 0),
    }))
    .filter((r) => r.forMethod && r.feeNet > 0 && r.paidVia);
}

function appendFeePaymentLines(payments, feeAllocations, { paidAt, paidByUserId }) {
  for (const fee of feeAllocations) {
    const collected = fee.feeGrossOnPaidVia > 0 ? fee.feeGrossOnPaidVia : fee.feeNet;
    payments.push({
      amount: collected,
      paidAt,
      paidByUserId,
      method: fee.paidVia,
      countsTowardInvoice: false,
      feeForMethod: fee.forMethod,
      feeNet: fee.feeNet,
      feeGrossOnPaidVia: collected,
      feePercentSnapshot: fee.feePercentSnapshot > 0 ? fee.feePercentSnapshot : undefined,
      note: `Fee · ${fee.forMethod}`,
    });
  }
}

export const getOrders = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      perPage,
      search = '',
      searchBranch = '',
      status,
      paymentMethod,
      installmentPlanMonths,
      from,
      to,
    } = req.query;
    const pageLimit = Math.max(1, Number(limit) || Number(perPage) || 10);
    const skip = (Number(page) - 1) * pageLimit;

    const query = {};

    // ✅ 0. Optional createdAt date range (Cairo business days)
    if (from || to) {
      const timezone = 'Africa/Cairo';
      const createdAt = {};
      if (from) {
        createdAt.$gte = moment.tz(String(from).trim(), 'YYYY-MM-DD', timezone).startOf('day').utc().toDate();
      }
      if (to) {
        createdAt.$lte = moment.tz(String(to).trim(), 'YYYY-MM-DD', timezone).endOf('day').utc().toDate();
      }
      query.createdAt = createdAt;
    }

    // ✅ 1. Optional status filter
    if (status && status.trim() !== '') {
      query.status = status;
    }

    // ✅ 1b. Optional payment method filter (cash, visa, valu, installment, …)
    if (paymentMethod && String(paymentMethod).trim() !== '') {
      query.paymentMethod = String(paymentMethod).trim();
    }

    // ✅ 1c. Filter installment invoices by plan months (6 / 12 / 24 …)
    const monthsFilter = Math.floor(Number(installmentPlanMonths));
    if (Number.isFinite(monthsFilter) && monthsFilter > 0) {
      query['installmentPlanSnapshot.months'] = monthsFilter;
      if (!query.paymentMethod) {
        query.paymentMethod = 'installment';
      }
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
          'orderNumber partyType vendorId clientName clientPhoneNumber clientAddress sellerName paymentMethod subtotalPrice invoiceDiscountAmount totalPrice creditFeePercent creditFeeAmount amountPaid paymentStatus numberOfProducts status createdAt returns products.productId products.name products.code products.quantity products.returnedQuantity products.price products.showProductCodeOnInvoice products.invoiceAttributes installmentPlanId installmentPlanSnapshot installmentStartDate installmentPrincipal installmentInterestAmount installments'
        )
        .populate('branch', 'name')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageLimit),

      Order.countDocuments(query),
    ]);

    const totalPages = Math.ceil(total / pageLimit);

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
      paymentFeeAllocations: paymentFeeAllocationsRaw,
      exchangeTradeInCreditAmount: exchangeCreditRaw,
      exchangeProductPurchaseRequestId: exchangePurchaseIdRaw,
      exchangeProductPurchaseRequestIds: exchangePurchaseIdsRaw,
      exchangeSettlementTreasurySplits: exchangeSettlementSplitsRaw,
      bookingDepositCreditAmount: bookingDepositCreditRaw,
      bookingDepositAllocations: bookingDepositAllocationsRaw,
      partyType: partyTypeRaw,
      vendorId: vendorIdRaw,
      installmentPlanId: installmentPlanIdRaw,
      installmentStartDate: installmentStartDateRaw,
      installmentMonthlyAmount: installmentMonthlyAmountRaw,
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
      // Exchange: sale must use the same client as the first trade-in purchase (cashier may omit client panel).
      const exchangeLookupIdRaw = Array.isArray(exchangePurchaseIdsRaw)
        ? exchangePurchaseIdsRaw.find((id) => mongoose.Types.ObjectId.isValid(String(id)))
        : exchangePurchaseIdRaw;
      if (
        !finalClientId &&
        exchangeLookupIdRaw &&
        mongoose.Types.ObjectId.isValid(String(exchangeLookupIdRaw))
      ) {
        const exchangePurchase = await ProductPurchaseRequest.findById(exchangeLookupIdRaw)
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
    /** Products whose stock changed — reconcile bookings after commit. */
    const soldProductIds = new Set();
    /** Products removed because category.deleteProductWhenOutOfStock (audit after commit). */
    const autoDeletedProducts = [];

    const getCategoryCached = async (categoryId) => {
      if (!categoryId) return null;
      const id = String(categoryId);
      if (categoryById.has(id)) return categoryById.get(id);
      const doc = await Category.findById(categoryId).session(session).lean();
      categoryById.set(id, doc);
      return doc;
    };

    const orderProductIds = (products || [])
      .map((item) => item?.selectedProduct?._id)
      .filter(Boolean);
    const clientReservedByProduct = await clientReservedQtyByProductId({
      session,
      partyType,
      finalClientId,
      saleClientPhone,
      productIds: orderProductIds,
    });

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
      const bookedQty = Number(productDoc.bookedQuantity) || 0;
      const ecomReserved = Number(productDoc.ecommerceReservedQuantity) || 0;
      const clientReserved = Math.min(
        bookedQty,
        clientReservedByProduct.get(String(productDoc._id)) || 0
      );
      const othersBooked = Math.max(0, bookedQty - clientReserved);
      const maxSellable =
        Number(productDoc.stock) - transferReserved - othersBooked - ecomReserved;
      if (maxSellable < quantity) throw new Error(`Not enough stock for ${productDoc.name}`);

      productDoc.stock -= quantity;
      await productDoc.save({ session });
      soldProductIds.add(String(productDoc._id));

      const categoryDoc = await getCategoryCached(productDoc.category);
      const invoiceAttributes = buildInvoiceAttributesSnapshot(productDoc, categoryDoc);
      // Category default is true; missing field on legacy categories → show code
      const showProductCodeOnInvoice =
        categoryDoc?.showProductCodeOnInvoice == null
          ? true
          : !!categoryDoc.showProductCodeOnInvoice;

      orderProducts.push({
        productId: selected._id,
        name: selected.name,
        code: selected.code,
        quantity,
        price,
        cost: itemCost || Number(productDoc.netPrice || 0),
        isApplyDiscount,
        showProductCodeOnInvoice,
        ...(invoiceAttributes.length ? { invoiceAttributes } : {}),
      });

      // Category setting: soft-hide product once stock is exhausted (keep row for returns)
      if (
        Number(productDoc.stock) <= 0 &&
        categoryDoc?.deleteProductWhenOutOfStock
      ) {
        autoDeletedProducts.push({
          _id: productDoc._id,
          code: productDoc.code,
          name: productDoc.name,
          stock: productDoc.stock,
          branch: productDoc.branch,
          inWarehouse: productDoc.inWarehouse,
          addedBy: productDoc.addedBy,
          category: productDoc.category,
          price: productDoc.price,
          netPrice: productDoc.netPrice,
        });
        productDoc.stock = 0;
        productDoc.removedWhenOutOfStock = true;
        await productDoc.save({ session });
      }
    }

    let subtotalPrice = Math.round(totalPrice * 100) / 100;
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
    let amountDueForPayment = Math.round((totalRounded - exchangeCreditApplied) * 100) / 100;

    // Booking deposit prepaid credit (after exchange credit).
    let bookingDepositCreditApplied = 0;
    let validatedBookingAllocations = [];
    const bookingAllocationsRawList = Array.isArray(bookingDepositAllocationsRaw)
      ? bookingDepositAllocationsRaw
          .map((a) => ({
            bookingId: String(a?.bookingId || a?._id || '').trim(),
            quantityApplied: Math.max(0, Math.floor(Number(a?.quantityApplied) || 0)),
            creditApplied: Math.round((Number(a?.creditApplied) || 0) * 100) / 100,
          }))
          .filter(
            (a) =>
              mongoose.Types.ObjectId.isValid(a.bookingId) &&
              a.quantityApplied > 0 &&
              a.creditApplied > 0
          )
      : [];

    if (bookingAllocationsRawList.length && partyType === 'client') {
      const bookingIds = bookingAllocationsRawList.map((a) => a.bookingId);
      const activeBookings = await ProductBooking.find({
        _id: { $in: bookingIds.map((id) => new mongoose.Types.ObjectId(id)) },
        status: 'active',
      })
        .session(session)
        .lean();

      const byId = new Map(activeBookings.map((b) => [String(b._id), b]));
      let maxFromBookings = 0;
      const validated = [];
      for (const a of bookingAllocationsRawList) {
        const b = byId.get(a.bookingId);
        if (!b) continue;
        if (!bookingBelongsToSaleClient(b, finalClientId, saleClientPhone)) {
          continue;
        }
        const bookedQty = Math.max(1, Math.floor(Number(b.quantity) || 1));
        const take = Math.min(bookedQty, a.quantityApplied);
        const dep = Math.round((Number(b.depositAmount) || 0) * 100) / 100;
        const credit = Math.min(
          a.creditApplied,
          Math.round((dep * (take / bookedQty)) * 100) / 100 + 0.001
        );
        const creditRounded = Math.round(Math.min(credit, dep) * 100) / 100;
        if (creditRounded <= 0 || take <= 0) continue;
        maxFromBookings += creditRounded;
        validated.push({
          bookingId: a.bookingId,
          quantityApplied: take,
          creditApplied: creditRounded,
        });
      }

      const requested = Number(bookingDepositCreditRaw);
      const requestedRounded =
        Number.isFinite(requested) && requested > 0
          ? Math.round(requested * 100) / 100
          : maxFromBookings;

      bookingDepositCreditApplied = Math.min(
        requestedRounded,
        maxFromBookings,
        amountDueForPayment
      );
      bookingDepositCreditApplied = Math.round(bookingDepositCreditApplied * 100) / 100;

      // Scale allocations if capped.
      if (bookingDepositCreditApplied < maxFromBookings - 0.001 && maxFromBookings > 0) {
        const scale = bookingDepositCreditApplied / maxFromBookings;
        for (const v of validated) {
          v.creditApplied = Math.round(v.creditApplied * scale * 100) / 100;
        }
      }

      validatedBookingAllocations = validated.filter((v) => v.creditApplied > 0);
      amountDueForPayment = Math.round(
        (amountDueForPayment - bookingDepositCreditApplied) * 100
      ) / 100;
    }

    // Consume this client's reservations on sold lines even when deposit credit is 0
    // (website hold). Avoids leaving bookedQuantity on another customer's booking.
    if (partyType === 'client' && orderProducts.length) {
      const soldNeed = new Map();
      for (const p of orderProducts) {
        const pid = String(p.productId);
        soldNeed.set(
          pid,
          (soldNeed.get(pid) || 0) + Math.max(0, Math.floor(Number(p.quantity) || 0))
        );
      }
      const pidOids = [...soldNeed.keys()]
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));
      if (pidOids.length) {
        const clientBookings = await ProductBooking.find({
          product: { $in: pidOids },
          status: 'active',
        })
          .session(session)
          .sort({ createdAt: 1 })
          .lean();
        const allocatedIds = new Set(
          validatedBookingAllocations.map((a) => String(a.bookingId))
        );
        for (const a of validatedBookingAllocations) {
          const b = clientBookings.find((x) => String(x._id) === String(a.bookingId));
          if (!b) continue;
          const pid = String(b.product);
          soldNeed.set(
            pid,
            Math.max(0, (soldNeed.get(pid) || 0) - (Number(a.quantityApplied) || 0))
          );
        }
        for (const b of clientBookings) {
          if (allocatedIds.has(String(b._id))) continue;
          if (!bookingBelongsToSaleClient(b, finalClientId, saleClientPhone)) continue;
          const pid = String(b.product);
          const need = soldNeed.get(pid) || 0;
          if (need <= 0) continue;
          const bookedQty = Math.max(1, Math.floor(Number(b.quantity) || 1));
          const take = Math.min(bookedQty, need);
          if (take <= 0) continue;
          validatedBookingAllocations.push({
            bookingId: String(b._id),
            quantityApplied: take,
            creditApplied: 0,
          });
          allocatedIds.add(String(b._id));
          soldNeed.set(pid, need - take);
        }
      }
    }

    const exchangePurchaseIdCandidates = [];
    if (Array.isArray(exchangePurchaseIdsRaw)) {
      for (const id of exchangePurchaseIdsRaw) {
        if (mongoose.Types.ObjectId.isValid(String(id))) {
          exchangePurchaseIdCandidates.push(String(id));
        }
      }
    }
    if (
      exchangePurchaseIdRaw &&
      mongoose.Types.ObjectId.isValid(String(exchangePurchaseIdRaw))
    ) {
      exchangePurchaseIdCandidates.push(String(exchangePurchaseIdRaw));
    }
    const exchangeProductPurchaseRequestIds = [
      ...new Set(exchangePurchaseIdCandidates),
    ].map((id) => new mongoose.Types.ObjectId(id));
    const exchangeProductPurchaseRequestId = exchangeProductPurchaseRequestIds[0];

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
      const hasInstallmentSplit = splits.some((s) => s.method === 'installment');

      const checkoutPaidAt = new Date();
      const feeAllocations = normalizePaymentFeeAllocations(paymentFeeAllocationsRaw);

      for (const s of splits) {
        if (s.amount > 0) {
          const isCreditLine = s.method === 'credit';
          const isInstallmentLine = s.method === 'installment';
          payments.push({
            amount: s.amount,
            paidAt: checkoutPaidAt,
            paidByUserId: uid,
            method: isCreditLine || isInstallmentLine ? undefined : s.method,
            countsTowardInvoice: true,
            note: isCreditLine
              ? 'Initial payment (cashier)'
              : isInstallmentLine
                ? 'Installment down payment (cashier)'
                : `Checkout · ${s.method}`,
          });
        }
      }

      appendFeePaymentLines(payments, feeAllocations, {
        paidAt: checkoutPaidAt,
        paidByUserId: uid,
      });

      const withMoney = splits.filter(
        (s) => s.amount > 0 && s.method !== 'credit' && s.method !== 'installment'
      );
      if (paidAmount >= amountDueForPayment - 0.001) {
        resolvedPaymentMethod = hasCreditSplit
          ? 'credit'
          : hasInstallmentSplit
            ? 'installment'
            : withMoney.length === 0
              ? 'cash'
              : withMoney.length === 1
                ? withMoney[0].method
                : 'mixed';
      } else if (hasInstallmentSplit) {
        resolvedPaymentMethod = 'installment';
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

    let creditFeePercent = 0;
    let creditFeeAmount = 0;
    let installmentFields = null;
    const onAccount = creditOnAccountAmount(amountDueForPayment, paidAmount);
    const wantsInstallment =
      String(resolvedPaymentMethod || '').toLowerCase() === 'installment' ||
      (Array.isArray(paymentSplitsRaw) &&
        paymentSplitsRaw.some(
          (s) => String(s?.method || '').trim().toLowerCase() === 'installment'
        )) ||
      Boolean(installmentPlanIdRaw);

    if (wantsInstallment && onAccount > 0.001) {
      if (!installmentPlanIdRaw || !mongoose.Types.ObjectId.isValid(String(installmentPlanIdRaw))) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ error: 'Installment plan is required' });
      }
      const plan = await InstallmentPlan.findById(installmentPlanIdRaw).session(session);
      if (!plan || plan.enabled === false) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ error: 'Installment plan not found or disabled' });
      }

      const startRaw = installmentStartDateRaw || new Date();
      const startDate = new Date(startRaw);
      if (Number.isNaN(startDate.getTime())) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ error: 'Invalid installment start date' });
      }

      const monthlyOverride = Number(installmentMonthlyAmountRaw);
      const schedule = buildSaleInstallmentSchedule({
        principal: onAccount,
        interestPercent: plan.interestPercent,
        months: plan.months,
        startDate,
        monthlyAmountOverride:
          Number.isFinite(monthlyOverride) && monthlyOverride > 0
            ? monthlyOverride
            : undefined,
      });

      if (schedule.interestAmount > 0) {
        const applied = distributeAmountOntoLinePrices(orderProducts, schedule.interestAmount);
        if (applied > 0) {
          subtotalPrice = Math.round((subtotalPrice + applied) * 100) / 100;
          totalPrice = Math.round((totalPrice + applied) * 100) / 100;
          amountDueForPayment = Math.round((amountDueForPayment + applied) * 100) / 100;
        }
      }

      let installmentDiscountAmount = 0;
      let installmentSurchargeAmount = 0;
      const adjustmentDelta = roundMoney(schedule.adjustmentAmount || 0);
      if (adjustmentDelta > 0.001) {
        installmentSurchargeAmount = distributeAmountOntoLinePrices(
          orderProducts,
          adjustmentDelta
        );
        if (installmentSurchargeAmount > 0) {
          subtotalPrice = Math.round((subtotalPrice + installmentSurchargeAmount) * 100) / 100;
          totalPrice = Math.round((totalPrice + installmentSurchargeAmount) * 100) / 100;
          amountDueForPayment = Math.round((amountDueForPayment + installmentSurchargeAmount) * 100) / 100;
        }
      } else if (adjustmentDelta < -0.001) {
        installmentDiscountAmount = roundMoney(Math.abs(adjustmentDelta));
        totalPrice = Math.round((totalPrice - installmentDiscountAmount) * 100) / 100;
        amountDueForPayment = Math.round((amountDueForPayment - installmentDiscountAmount) * 100) / 100;
        if (totalPrice < 0) totalPrice = 0;
        if (amountDueForPayment < 0) amountDueForPayment = 0;
      }

      const installmentTotalProfit = orderLineTradingProfit(orderProducts);
      allocateInstallmentProfitShares(schedule.installments, installmentTotalProfit);

      installmentFields = {
        installmentPlanId: plan._id,
        installmentPlanSnapshot: {
          name: plan.name,
          months: plan.months,
          interestPercent: plan.interestPercent,
        },
        installmentStartDate: startDate,
        installmentPrincipal: schedule.principal,
        installmentInterestAmount: schedule.interestAmount,
        installmentDiscountAmount,
        installmentSurchargeAmount,
        installmentTotalProfit,
        installments: schedule.installments,
      };
      resolvedPaymentMethod = 'installment';
    } else if (onAccount > 0.001) {
      const settingsDoc = await getOrCreateStoreSettings();
      const catalog = normalizePaymentMethodsCatalog({
        paymentMethodsCatalog: settingsDoc?.paymentMethodsCatalog,
        paymentAppFeePercents: settingsDoc?.paymentAppFeePercents,
        purchaseTreasuryMethods: settingsDoc?.purchaseTreasuryMethods,
      });
      creditFeePercent = catalogCreditFeePercent(catalog);
      const wantedMarkup = creditMarkupAmount(onAccount, creditFeePercent);
      if (wantedMarkup > 0) {
        creditFeeAmount = distributeAmountOntoLinePrices(orderProducts, wantedMarkup);
        if (creditFeeAmount > 0) {
          subtotalPrice = Math.round((subtotalPrice + creditFeeAmount) * 100) / 100;
          totalPrice = Math.round((totalPrice + creditFeeAmount) * 100) / 100;
          amountDueForPayment = Math.round((amountDueForPayment + creditFeeAmount) * 100) / 100;
        }
      }
    }

    const paymentStatus =
      paidAmount >= amountDueForPayment - 0.001
        ? 'paid'
        : paidAmount > 0
        ? 'partial'
        : 'unpaid';

    let resolvedSellerName = String(sellerName || '').trim();
    if (!resolvedSellerName && userId && mongoose.Types.ObjectId.isValid(String(userId))) {
      const sellerUser = await User.findById(userId).select('name').session(session).lean();
      resolvedSellerName = String(sellerUser?.name || '').trim();
    }

    // ======================
    // 3️⃣ GENERATE ORDER NUMBER
    // ======================
    const lastOrder = await Order.findOne().sort({ orderNumber: -1 }).lean();
    const nextOrderNumber = Number(lastOrder?.orderNumber || 0) + 1;

    // Inherit client collector onto installment invoices (can be reassigned later per invoice).
    let inheritedCollectorId = null;
    if (installmentFields && finalClientId) {
      const clientForCollector = await Client.findById(finalClientId)
        .select("collectorId")
        .session(session)
        .lean();
      if (clientForCollector?.collectorId) {
        inheritedCollectorId = clientForCollector.collectorId;
      }
    }

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
          ...(inheritedCollectorId ? { collectorId: inheritedCollectorId } : {}),
          clientName: saleClientName,
          clientPhoneNumber: saleClientPhone,
          clientAddress: saleClientAddress,
          sellerName: resolvedSellerName,
          paymentMethod: resolvedPaymentMethod,
          branch,
          products: orderProducts,
          numberOfProducts,
          subtotalPrice,
          invoiceDiscountAmount,
          totalPrice,
          ...(creditFeeAmount > 0
            ? { creditFeePercent, creditFeeAmount }
            : {}),
          ...(exchangeCreditApplied > 0
            ? {
                exchangeTradeInCreditAmount: exchangeCreditApplied,
                ...(exchangeProductPurchaseRequestId
                  ? { exchangeProductPurchaseRequestId }
                  : {}),
                ...(exchangeProductPurchaseRequestIds.length
                  ? { exchangeProductPurchaseRequestIds }
                  : {}),
              }
            : exchangeProductPurchaseRequestIds.length
              ? {
                  ...(exchangeProductPurchaseRequestId
                    ? { exchangeProductPurchaseRequestId }
                    : {}),
                  exchangeProductPurchaseRequestIds,
                }
              : {}),
          ...(bookingDepositCreditApplied > 0
            ? {
                bookingDepositCreditAmount: bookingDepositCreditApplied,
                appliedBookingIds: validatedBookingAllocations.map(
                  (a) => new mongoose.Types.ObjectId(a.bookingId)
                ),
              }
            : {}),
          amountPaid: paidAmount,
          paymentStatus,
          payments,
          status,
          cashierId: userId,
          ...(installmentFields || {}),
          },
      ],
      { session }
    );

    // Finalize exchange trade-ins (create products/stock) only when the sale commits.
    const exchangePurchaseStockMovements = [];
    if (exchangeProductPurchaseRequestIds.length) {
      for (const purchaseId of exchangeProductPurchaseRequestIds) {
        const finalized = await finalizeExchangeTradeInPurchaseInSession(
          session,
          purchaseId,
          { userId, orderId: newOrder._id }
        );
        if (finalized?.error) {
          await session.abortTransaction();
          session.endSession();
          return res.status(finalized.status || 400).json({
            error: finalized.error || 'Failed to finalize exchange trade-in',
            ...(finalized.code ? { code: finalized.code } : {}),
          });
        }
        if (Array.isArray(finalized?.stockMovementRows) && finalized.stockMovementRows.length) {
          exchangePurchaseStockMovements.push(...finalized.stockMovementRows);
        }
      }
    }

    await session.commitTransaction();
    session.endSession();

    if (validatedBookingAllocations.length) {
      try {
        await consumeBookingsForSale({
          allocations: validatedBookingAllocations,
          userId,
          orderId: newOrder._id,
        });
      } catch (bookingConsumeErr) {
        console.warn(
          '⚠️ consumeBookingsForSale:',
          bookingConsumeErr?.message || bookingConsumeErr
        );
      }
    }

    // Free orphan reservations when sold qty left stock below booked qty
    // (e.g. sale without applying booking deposit credit).
    for (const pid of soldProductIds) {
      try {
        await reconcileBookingsToStock(pid, {
          userId,
          reason: `Released after sale #${newOrder?.orderNumber ?? newOrder?._id}`,
        });
      } catch (reconcileErr) {
        console.warn('⚠️ reconcileBookingsToStock:', reconcileErr?.message || reconcileErr);
      }
    }

    const storeOwesExchange = round2(
      Math.max(0, exchangeTradeInCreditAmount - totalRounded)
    );
    if (
      storeOwesExchange > 0.01 &&
      exchangeProductPurchaseRequestId &&
      Array.isArray(exchangeSettlementSplitsRaw) &&
      exchangeSettlementSplitsRaw.length
    ) {
      try {
        // Difference is one payout; record treasury on the first trade-in and link the rest.
        await recordExchangeSettlement(exchangeProductPurchaseRequestId, {
          orderId: newOrder._id,
          amount: storeOwesExchange,
          paymentTreasurySplits: exchangeSettlementSplitsRaw,
          userId,
          branchId: branch,
        });
      } catch (settlementErr) {
        console.error('⚠️ exchange settlement:', settlementErr?.message || settlementErr);
        return res.status(400).json({
          error: settlementErr?.message || 'Failed to record exchange settlement',
        });
      }
    } else if (storeOwesExchange > 0.01 && exchangeProductPurchaseRequestId) {
      return res.status(400).json({
        error: 'Exchange settlement treasury is required when store owes the customer',
      });
    }

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
      if (exchangePurchaseStockMovements.length) {
        movementDocs.push(...exchangePurchaseStockMovements);
      }
      if (movementDocs.length) {
        await StockMovement.insertMany(movementDocs);
      }
    } catch (movementError) {
      console.error('⚠️ Failed to log sale stock movement:', movementError.message);
    }

    await safeTreasuryPost('order_create', async () => {
      await postOrderPaymentLinesToLedger({
        branchId: branch,
        payments: newOrder.payments || [],
        orderId: newOrder._id,
        createdBy: userId,
      });
    });

    await auditLog(req, {
      action: 'create',
      module: 'orders',
      entityType: 'Order',
      entityId: newOrder?._id,
      entityLabel: newOrder?.orderNumber != null ? `#${newOrder.orderNumber}` : undefined,
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

    for (const item of orderProducts) {
      if (item?.productId) notifyProductChanged(item.productId);
    }

    for (const removed of autoDeletedProducts) {
      await auditLog(req, {
        action: 'delete',
        module: 'products',
        entityType: 'Product',
        entityId: removed._id,
        message: `Product hidden from stock after sale ${removed.code || ''}`.trim(),
        before: {
          code: removed.code,
          name: removed.name,
          stock: removed.stock,
          branch: removed.branch,
          inWarehouse: removed.inWarehouse,
          addedBy: removed.addedBy,
          category: removed.category,
          price: removed.price,
          netPrice: removed.netPrice,
        },
        metadata: {
          reason: 'deleteProductWhenOutOfStock',
          softRemoved: true,
          orderId: newOrder?._id,
          orderNumber: newOrder?.orderNumber,
        },
      });
    }

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
      paymentSplits: paymentSplitsRaw,
      paymentMethodSplits: paymentMethodSplitsRaw,
      paymentFeeAllocations: paymentFeeAllocationsRaw,
      branchId: branchIdRaw,
      installmentId: installmentIdRaw,
      /** @deprecated Sales installments use paymentSplits (customer methods), not purchase treasury. */
      paymentTreasurySplits: legacyTreasuryRaw,
    } = req.body || {};
    const splitsRaw = paymentSplitsRaw ?? paymentMethodSplitsRaw;
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.status === 'restored') return res.status(400).json({ error: 'Order is restored' });

    const total = Number(order.totalPrice) || 0;
    const alreadyPaid = Number(order.amountPaid) || 0;
    const remaining = Math.max(0, Math.round((total - alreadyPaid) * 100) / 100);

    let applied = 0;
    const hasPaymentSplits = Array.isArray(splitsRaw) && splitsRaw.length > 0;
    const hasLegacyTreasury =
      Array.isArray(legacyTreasuryRaw) && legacyTreasuryRaw.length > 0;

    if (hasLegacyTreasury && !hasPaymentSplits) {
      return res.status(400).json({
        error:
          'Use paymentSplits (customer payment methods) for sales invoice payments, not purchase treasury',
      });
    }

    const dt = paidAt ? new Date(paidAt) : new Date();
    if (Number.isNaN(dt.getTime())) return res.status(400).json({ error: 'Invalid paidAt date' });

    const uid = mongoose.Types.ObjectId.isValid(String(userId || ''))
      ? new mongoose.Types.ObjectId(String(userId))
      : undefined;

    const resolvedPaymentBranch = await resolveBranchForCashDrawer({
      userId,
      branchId: branchIdRaw,
    });

    order.payments = order.payments || [];
    const noteStr = String(note || '').trim();
    let primaryMethod = '';

    if (hasPaymentSplits) {
      const splits = splitsRaw
        .map((s) => ({
          method: String(s?.method ?? s?.key ?? '').trim().toLowerCase(),
          amount: Math.round((Number(s?.amount) || 0) * 100) / 100,
        }))
        .filter(
          (s) =>
            s.method &&
            s.method !== 'credit' &&
            s.method !== 'installment' &&
            Number.isFinite(s.amount) &&
            s.amount > 0
        );

      if (!splits.length) {
        return res.status(400).json({ error: 'At least one payment method with amount is required' });
      }

      applied = Math.round(splits.reduce((a, s) => a + s.amount, 0) * 100) / 100;
      applied = Math.min(applied, remaining);
      if (applied <= 0) return res.status(400).json({ error: 'Nothing remaining to pay' });

      primaryMethod = splits.length === 1 ? splits[0].method : 'mixed';

      for (const s of splits) {
        order.payments.push({
          amount: s.amount,
          paidAt: dt,
          paidByUserId: uid,
          ...(resolvedPaymentBranch ? { branch: resolvedPaymentBranch } : {}),
          method: s.method,
          countsTowardInvoice: true,
          note: noteStr || `Payment · ${s.method}`,
        });
      }

      const feeAllocations = normalizePaymentFeeAllocations(paymentFeeAllocationsRaw);
      appendFeePaymentLines(order.payments, feeAllocations, {
        paidAt: dt,
        paidByUserId: uid,
      });
    } else {
      const payAmount = Number(amount);
      if (!Number.isFinite(payAmount) || payAmount <= 0) {
        return res.status(400).json({ error: 'Valid amount is required' });
      }
      applied = Math.min(Math.round(payAmount * 100) / 100, remaining);
      if (applied <= 0) return res.status(400).json({ error: 'Nothing remaining to pay' });

      const methodSlug = String(methodRaw || 'cash').trim().toLowerCase();
      if (methodSlug === 'credit' || methodSlug === 'installment') {
        return res.status(400).json({ error: 'Use a customer payment method (not credit/installment) for payments' });
      }
      primaryMethod = methodSlug || 'cash';
      order.payments.push({
        amount: applied,
        paidAt: dt,
        paidByUserId: uid,
        ...(resolvedPaymentBranch ? { branch: resolvedPaymentBranch } : {}),
        method: primaryMethod,
        note: noteStr,
      });
    }

    order.amountPaid = Math.round((alreadyPaid + applied) * 100) / 100;
    if (order.amountPaid >= total) {
      order.paymentStatus = 'paid';
    } else {
      order.paymentStatus = order.amountPaid > 0 ? 'partial' : 'unpaid';
    }

    let remainingInstallments = 0;
    let recognizedInstallmentProfit = 0;
    if (Array.isArray(order.installments) && order.installments.length) {
      ensureInstallmentProfitShares(order);
      const scheduleResult = applyPaymentToInstallments(order.installments, applied, {
        paidAt: dt,
        paymentMethod: primaryMethod,
        paidByUserId: uid,
        installmentId: installmentIdRaw,
      });
      remainingInstallments = scheduleResult.remainingInstallments;
      recognizedInstallmentProfit = Math.round((Number(scheduleResult.installmentProfit) || 0) * 100) / 100;
      order.markModified('installments');

      if (recognizedInstallmentProfit > 0) {
        const toward = (order.payments || []).filter(
          (p) =>
            p.paidAt &&
            Math.abs(new Date(p.paidAt).getTime() - dt.getTime()) < 2000 &&
            p.countsTowardInvoice !== false &&
            !p.feeForMethod
        );
        if (toward.length === 1) {
          toward[0].installmentProfit = recognizedInstallmentProfit;
        } else if (toward.length > 1) {
          const sumAmt = toward.reduce((s, p) => s + (Number(p.amount) || 0), 0);
          let allocated = 0;
          toward.forEach((p, i) => {
            if (i === toward.length - 1) {
              p.installmentProfit = Math.round((recognizedInstallmentProfit - allocated) * 100) / 100;
            } else {
              const share =
                sumAmt > 0
                  ? Math.round(
                      ((recognizedInstallmentProfit * (Number(p.amount) || 0)) / sumAmt) * 100
                    ) / 100
                  : 0;
              p.installmentProfit = share;
              allocated = Math.round((allocated + share) * 100) / 100;
            }
          });
        }
        order.markModified('payments');
      }
    }

    await order.save();

    await safeTreasuryPost('order_payment', async () => {
      const branchForLedger =
        resolvedPaymentBranch || order.branch || (await resolveBranchForCashDrawer({ userId }));
      if (!branchForLedger) return;
      const recent = (order.payments || []).slice(-20);
      const justAdded = recent.filter(
        (p) => p.paidAt && Math.abs(new Date(p.paidAt).getTime() - dt.getTime()) < 2000
      );
      await postOrderPaymentLinesToLedger({
        branchId: branchForLedger,
        payments: justAdded.length ? justAdded : recent.slice(-5),
        orderId: order._id,
        createdBy: userId,
      });
    });

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
      entityLabel: order?.orderNumber != null ? `#${order.orderNumber}` : undefined,
      message: `Order payment ${applied}`,
      metadata: {
        orderNumber: order?.orderNumber,
        amount: applied,
        amountPaid: order.amountPaid,
        totalPrice: total,
        status: order?.status,
        paymentStatus: order?.paymentStatus,
        remainingInstallments,
        installmentId: installmentIdRaw || undefined,
      },
    });

    res.json({
      message: '✅ Payment added',
      order,
      remainingInstallments,
      remainingAfter: Math.max(0, Math.round((total - order.amountPaid) * 100) / 100),
    });
  } catch (error) {
    console.error('addOrderPayment:', error);
    res.status(500).json({ error: 'Failed to add payment' });
  }
};

/** POST set / clear promise-to-pay on one installment row. */
export const setInstallmentPromise = async (req, res) => {
  try {
    const { orderId, installmentId } = req.params;
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (!Array.isArray(order.installments) || !order.installments.length) {
      return res.status(400).json({ error: 'Order has no installments' });
    }

    const row = order.installments.id(installmentId) ||
      order.installments.find((r) => String(r._id) === String(installmentId));
    if (!row) return res.status(404).json({ error: 'Installment not found' });
    if (row.paid) return res.status(400).json({ error: 'Installment already paid' });

    const actorUserId = mongoose.Types.ObjectId.isValid(
      String(req.body?.userId || req.user?._id || '')
    )
      ? new mongoose.Types.ObjectId(String(req.body?.userId || req.user?._id))
      : undefined;

    const raw = req.body?.promiseToPayAt;
    if (raw === null || raw === '' || raw === undefined) {
      clearInstallmentPromiseToPay(row, { userId: actorUserId });
    } else {
      const dt = new Date(raw);
      if (Number.isNaN(dt.getTime())) {
        return res.status(400).json({ error: 'Invalid promiseToPayAt' });
      }
      setInstallmentPromiseToPay(row, dt, { userId: actorUserId });
    }
    if (req.body?.note !== undefined) {
      row.note = String(req.body.note || '').trim();
    }
    order.markModified('installments');
    await order.save();

    await auditLog(req, {
      action: 'update',
      module: 'orders',
      entityType: 'Order',
      entityId: order._id,
      entityLabel: order?.orderNumber != null ? `#${order.orderNumber}` : undefined,
      message:
        raw === null || raw === '' || raw === undefined
          ? `Cleared installment #${row.sequence} promise to pay`
          : `Set installment #${row.sequence} promise to pay`,
      metadata: {
        orderNumber: order?.orderNumber,
        installmentId: row._id,
        sequence: row.sequence,
        promiseToPayAt: row.promiseToPayAt || null,
        clientId: order.clientId,
      },
    });

    const installment = typeof row.toObject === 'function' ? row.toObject() : { ...row };
    installment.promiseToPayHistoryPast = serializePastPromiseHistory(row);

    res.json({ message: 'Promise updated', order, installment });
  } catch (error) {
    console.error('setInstallmentPromise:', error);
    res.status(500).json({ error: 'Failed to update promise' });
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
    const body = req.body || {};
    const actorUserId = body.userId || req.query?.userId;

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const hasPartialPayload =
      body.returnAll === true ||
      body.returnAll === 'true' ||
      (Array.isArray(body.items) && body.items.length > 0);

    let result;
    if (hasPartialPayload) {
      result = await processOrderReturn(order, {
        returnAll: body.returnAll === true || body.returnAll === 'true',
        items: body.items,
        userId: actorUserId,
        branchId: body.branchId,
        note: body.note,
        cashRefundVia: body.cashRefundVia,
        cashTreasuryKey: body.cashTreasuryKey,
        cashTreasuryLabel: body.cashTreasuryLabel,
      });
    } else {
      result = await processFullOrderRestore(order, {
        userId: actorUserId,
        note: body.note,
      });
    }

    const updated = result.order;

    await safeTreasuryPost('order_refund', async () => {
      const branchForLedger =
        updated.branch ||
        (await resolveBranchForCashDrawer({ userId: actorUserId, branchId: body.branchId }));
      if (!branchForLedger) return;
      const ret = result.returnRecord;
      await postRefundPaymentLinesToLedger({
        branchId: branchForLedger,
        refundPaymentSplits: ret?.refundPaymentSplits || [],
        orderId: updated._id,
        createdBy: actorUserId,
        occurredAt: ret?.returnedAt || new Date(),
      });
      const treasuryLines = salesReturnTreasuryRefundLines(ret);
      if (treasuryLines.length) {
        await postTreasurySplitOutflows({
          branchId: branchForLedger,
          splits: treasuryLines,
          sourceType: 'order_refund',
          sourceId: updated._id,
          createdBy: actorUserId,
        });
      }
    });

    await auditLog(req, {
      action: 'restore',
      module: 'orders',
      entityType: 'Order',
      entityId: updated?._id,
      entityLabel: updated?.orderNumber != null ? `#${updated.orderNumber}` : undefined,
      message: `Order return #${updated?.orderNumber ?? ''}`.trim(),
      metadata: {
        orderNumber: updated?.orderNumber,
        branch: updated?.branch,
        status: updated?.status,
        refundTotal: result.returnRecord?.refundTotal,
        actorUserId,
      },
    });

    res.json({
      message: '✅ Order return processed successfully',
      restoredOrder: updated,
      returnRecord: result.returnRecord,
    });
  } catch (error) {
    console.error('❌ Error restoring order:', error);
    const msg = error?.message || 'Server error restoring order';
    const status = msg.includes('not found') ? 404 : msg.includes('already') ? 400 : 500;
    res.status(status).json({ error: msg, details: error.message });
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
      entityLabel: deletedOrder?.orderNumber != null ? `#${deletedOrder.orderNumber}` : undefined,
      message: `Order deleted #${deletedOrder?.orderNumber ?? ''}`.trim(),
      metadata: {
        orderNumber: deletedOrder?.orderNumber,
        branch: deletedOrder?.branch,
        status: deletedOrder?.status,
      },
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
