import Order from '../../DB/models/order.model.js';
import Product from '../../DB/models/product.model.js';
import Category from '../../DB/models/category.model.js';
import Branch from '../../DB/models/branch.model.js';
import StoreSettings from '../../DB/models/storeSettings.model.js';
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
import {
  normalizeSaleQuantity,
  normalizeWeightUnit,
  resolveSellByWeight,
  roundWeight,
} from '../../utils/sale-quantity.util.js';
import { isCutFromSourceEnabled, sourceProductIdOf } from '../../utils/cut-from-source.js';
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
  const bookingsQ = ProductBooking.find({
    product: { $in: oids.map((id) => new mongoose.Types.ObjectId(String(id))) },
    status: 'active',
  });
  const bookings = await (session ? bookingsQ.session(session) : bookingsQ).lean();
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

function orderNeedsTransaction({
  partyType,
  exchangePurchaseIdsRaw,
  exchangePurchaseIdRaw,
  bookingDepositAllocationsRaw,
}) {
  if (partyType === 'supplier') return true;
  if (Array.isArray(bookingDepositAllocationsRaw) && bookingDepositAllocationsRaw.length > 0) {
    return true;
  }
  if (Array.isArray(exchangePurchaseIdsRaw) && exchangePurchaseIdsRaw.length > 0) return true;
  if (exchangePurchaseIdRaw && mongoose.Types.ObjectId.isValid(String(exchangePurchaseIdRaw))) {
    return true;
  }
  return false;
}

async function rollbackOrderSession(session) {
  if (!session) return;
  try {
    await session.abortTransaction();
  } catch (_) {
    /* already ended */
  }
  session.endSession();
}

async function commitOrderSession(session) {
  if (!session) return;
  await session.commitTransaction();
  session.endSession();
}

/** Non-blocking audit/treasury/booking reconcile after order commit (cashier speed). */
async function runOrderPostCreateSideEffects({
  req,
  newOrder,
  soldProductIds,
  orderProducts,
  exchangePurchaseStockMovements,
  branch,
  userId,
  autoDeletedProducts,
  validatedBookingAllocations,
  bookingDepositCreditApplied,
}) {
  if (validatedBookingAllocations?.length && bookingDepositCreditApplied > 0) {
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

  const soldIdsArray = [...soldProductIds]
    .filter((id) => mongoose.Types.ObjectId.isValid(String(id)))
    .map((id) => new mongoose.Types.ObjectId(String(id)));

  let productIdsNeedingReconcile = [];
  if (soldIdsArray.length) {
    try {
      productIdsNeedingReconcile = await ProductBooking.distinct('product', {
        product: { $in: soldIdsArray },
        status: 'active',
      });
    } catch (err) {
      console.warn('⚠️ booking distinct for reconcile:', err?.message || err);
      productIdsNeedingReconcile = soldIdsArray;
    }
  }

  if (productIdsNeedingReconcile.length) {
    await Promise.allSettled(
      productIdsNeedingReconcile.map((pid) =>
        reconcileBookingsToStock(pid, {
          userId,
          reason: `Released after sale #${newOrder?.orderNumber ?? newOrder?._id}`,
        })
      )
    );
  }

  try {
    const movementDocs = orderProducts.map((item) => ({
      movementType: 'sale',
      productId: item.sourceProductId || item.productId,
      productName: item.name,
      branchId: branch || null,
      fromBranchId: branch || null,
      toBranchId: null,
      quantity: Number(item.quantity || 0),
      unitPrice: Number(item.price || 0),
      totalValue: Number(item.price || 0) * Number(item.quantity || 0),
      referenceType: 'order',
      referenceId: newOrder._id,
      notes: item.sourceProductId
        ? `Order #${newOrder.orderNumber} · ${item.name}`
        : `Order #${newOrder.orderNumber}`,
    }));
    if (exchangePurchaseStockMovements?.length) {
      movementDocs.push(...exchangePurchaseStockMovements);
    }
    if (movementDocs.length) {
      await StockMovement.insertMany(movementDocs);
    }
  } catch (movementError) {
    console.error('⚠️ Failed to log sale stock movement:', movementError.message);
  }

  // Treasury is posted synchronously in createOrder (before HTTP response).

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
      sortBy = '',
      sortDir = 'desc',
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

    // ✅ 2. Search by order number, installment sale number, client name, or phone
    if (search) {
      const isNumber = !isNaN(search);
      query.$or = [
        { clientName: { $regex: search, $options: 'i' } },
        { clientPhoneNumber: { $regex: search, $options: 'i' } },
      ];
      if (isNumber) {
        const n = Number(search);
        query.$or.push({ orderNumber: n });
        query.$or.push({ installmentSaleNumber: n });
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

    const sortKey = String(sortBy || '')
      .trim()
      .toLowerCase();
    const dir =
      String(sortDir || 'desc')
        .trim()
        .toLowerCase() === 'asc'
        ? 1
        : -1;
    const sortBySaleNumber =
      sortKey === 'salenumber' || sortKey === 'installmentsalenumber';

    // Sorting by sale number only applies to installment sales (hide cash/etc.).
    if (sortBySaleNumber) {
      query.paymentMethod = 'installment';
      query.installmentSaleNumber = { $exists: true, $ne: null, $gte: 1 };
    }

    const sortSpec = sortBySaleNumber
      ? { installmentSaleNumber: dir, createdAt: -1 }
      : { createdAt: -1 };

    // ✅ 4. Fetch orders (with branch populated)
    const [orders, total] = await Promise.all([
      Order.find(query)
        .select(
          'orderNumber installmentSaleNumber partyType vendorId clientId clientName clientPhoneNumber clientAddress sellerName isDelivery deliveryPersonName paymentMethod subtotalPrice invoiceDiscountAmount totalPrice creditFeePercent creditFeeAmount amountPaid paymentStatus numberOfProducts status createdAt returns products.productId products.name products.code products.quantity products.saleUnit products.weightUnit products.returnedQuantity products.price products.showProductCodeOnInvoice products.invoiceAttributes installmentPlanId installmentPlanSnapshot installmentStartDate installmentPrincipal installmentInterestAmount installments.amount installments.paid installments.paidAmount'
        )
        .populate('branch', 'name')
        .sort(sortSpec)
        .skip(skip)
        .limit(pageLimit)
        .lean(),

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
  const {
    clientId,
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
    isDelivery: isDeliveryRaw,
    deliveryPersonName: deliveryPersonNameRaw,
    linkParty: linkPartyRaw,
    installmentPlanId: installmentPlanIdRaw,
    installmentStartDate: installmentStartDateRaw,
    installmentMonthlyAmount: installmentMonthlyAmountRaw,
    installmentSaleNumber: installmentSaleNumberRaw,
    collectorId: collectorIdRaw,
  } = req.body;

  const partyType =
    String(partyTypeRaw || 'client').trim().toLowerCase() === 'supplier'
      ? 'supplier'
      : 'client';
  const shouldLinkClient =
    partyType === 'client' &&
    linkPartyRaw !== false &&
    linkPartyRaw !== 'false' &&
    String(linkPartyRaw ?? '').toLowerCase() !== 'false';

  if (!clientPhoneNumber) {
    return res.status(400).json({ error: 'clientPhoneNumber is required' });
  }
  if (!products || products.length === 0) {
    return res.status(400).json({ error: 'Order must contain at least one product' });
  }

  const needsTransaction = orderNeedsTransaction({
    partyType,
    exchangePurchaseIdsRaw,
    exchangePurchaseIdRaw,
    bookingDepositAllocationsRaw,
  });

  let session = null;
  if (needsTransaction) {
    session = await mongoose.startSession();
    session.startTransaction();
  }

  const q = (query) => (session ? query.session(session) : query);
  const w = () => (session ? { session } : {});

  try {
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
        const vendorDoc = await q(Vendor.findById(vendorIdRaw));
        if (!vendorDoc) {
          await rollbackOrderSession(session);
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
        const exchangePurchase = await q(
          ProductPurchaseRequest.findById(exchangeLookupIdRaw).select('productPayload.acquiredFrom')
        ).lean();
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

      if (shouldLinkClient) {
        if (!finalClientId) {
          let client = await q(Client.findOne({ phoneNumber: saleClientPhone }));

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
              w()
            );
            client = newClient;
          } else if (orderBranchOid) {
            void Client.updateOne(
              { _id: client._id },
              { $addToSet: { branches: orderBranchOid } }
            ).catch((err) =>
              console.warn('⚠️ client branch link:', err?.message || err)
            );
          }

          finalClientId = client._id;
        } else if (orderBranchOid) {
          void Client.updateOne(
            { _id: finalClientId },
            { $addToSet: { branches: orderBranchOid } }
          ).catch((err) =>
            console.warn('⚠️ client branch link:', err?.message || err)
          );
        }
      }
    }

    // ======================
    // 2️⃣ CALCULATE TOTALS + UPDATE STOCK
    // ======================
    let totalPrice = 0;
    let numberOfProducts = 0;
    const orderProducts = [];
    /** Products whose stock changed — reconcile bookings after commit. */
    const soldProductIds = new Set();
    /** Products removed because category.deleteProductWhenOutOfStock (audit after commit). */
    const autoDeletedProducts = [];

    const validLineItems = products.filter((item) => item?.selectedProduct?._id);
    const uniqueProductIds = [
      ...new Set(validLineItems.map((item) => String(item.selectedProduct._id))),
    ]
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));

    const [settingsDoc, productDocsList, lastOrder] = await Promise.all([
      q(StoreSettings.findOne().sort({ updatedAt: -1 })).lean(),
      uniqueProductIds.length > 0
        ? q(
            Product.find({ _id: { $in: uniqueProductIds } }).select(
              'name code stock transferReservedQuantity bookedQuantity ecommerceReservedQuantity category netPrice sellByWeightOverride attributes removedWhenOutOfStock branch inWarehouse addedBy price sourceProductId'
            )
          )
        : Promise.resolve([]),
      q(Order.findOne().sort({ orderNumber: -1 }).select('orderNumber')).lean(),
    ]);
    const weightSalesEnabled = !!settingsDoc?.weightSalesEnabled;
    const cutFromSourceEnabled = isCutFromSourceEnabled(settingsDoc);
    const productById = new Map(productDocsList.map((p) => [String(p._id), p]));

    if (cutFromSourceEnabled && productDocsList.length) {
      const extraSourceIds = [
        ...new Set(
          productDocsList
            .map((p) => sourceProductIdOf(p))
            .filter((id) => id && mongoose.Types.ObjectId.isValid(id) && !productById.has(id))
        ),
      ].map((id) => new mongoose.Types.ObjectId(id));
      if (extraSourceIds.length) {
        const extraDocs = await q(
          Product.find({ _id: { $in: extraSourceIds } }).select(
            'name code stock transferReservedQuantity bookedQuantity ecommerceReservedQuantity category netPrice sellByWeightOverride attributes removedWhenOutOfStock branch inWarehouse addedBy price sourceProductId'
          )
        );
        for (const doc of extraDocs) {
          productById.set(String(doc._id), doc);
        }
      }
    }

    const categoryIds = [
      ...new Set(
        productDocsList
          .map((p) => p.category)
          .filter((id) => id != null)
          .map(String)
          .filter((id) => mongoose.Types.ObjectId.isValid(id))
      ),
    ].map((id) => new mongoose.Types.ObjectId(id));

    const categoryDocs =
      categoryIds.length > 0
        ? await q(Category.find({ _id: { $in: categoryIds } })).lean()
        : [];
    const categoryById = new Map(categoryDocs.map((c) => [String(c._id), c]));
    const nextOrderNumber = Number(lastOrder?.orderNumber || 0) + 1;

    const dirtyProductIds = new Set();

    const clientReservedByProduct = await clientReservedQtyByProductId({
      session,
      partyType,
      finalClientId,
      saleClientPhone,
      productIds: uniqueProductIds,
    });

    for (const item of validLineItems) {
      const selected = item.selectedProduct;
      const productDoc = productById.get(String(selected._id));
      if (!productDoc) throw new Error(`Product not found: ${selected._id}`);

      const categoryDoc = productDoc.category
        ? categoryById.get(String(productDoc.category)) ?? null
        : null;
      const isWeight = resolveSellByWeight({
        weightSalesEnabled,
        category: categoryDoc,
        product: { ...productDoc.toObject(), sellByWeightOverride: selected.sellByWeightOverride ?? productDoc.sellByWeightOverride },
      });
      const quantity = normalizeSaleQuantity(Number(item.quantity) || (isWeight ? 0 : 1), isWeight);
      if (isWeight && quantity <= 0) {
        throw new Error(`Valid weight is required for ${productDoc.name}`);
      }
      numberOfProducts += isWeight ? 1 : quantity;

      let price = Number(selected.price) || 0;
      const itemCost = Number(selected.netPrice ?? selected.cost ?? 0);
      const isApplyDiscount = !!selected.isApplyDiscount;

      if (isApplyDiscount && selected.discount > 0) {
        price = price - (price * selected.discount) / 100;
      }

      totalPrice += price * quantity;

      const sourceId = cutFromSourceEnabled ? sourceProductIdOf(productDoc) : null;
      if (sourceId && !productById.get(sourceId)) {
        throw new Error(`Source stock not found for ${productDoc.name}`);
      }
      const stockDoc = sourceId ? productById.get(sourceId) : productDoc;
      const stockTransferReserved = Number(stockDoc.transferReservedQuantity) || 0;
      const stockBookedQty = Number(stockDoc.bookedQuantity) || 0;
      const stockEcomReserved = Number(stockDoc.ecommerceReservedQuantity) || 0;
      const stockClientReserved = Math.min(
        stockBookedQty,
        clientReservedByProduct.get(String(stockDoc._id)) || 0
      );
      const stockOthersBooked = Math.max(0, stockBookedQty - stockClientReserved);
      const maxSellable = isWeight
        ? roundWeight(
            Number(stockDoc.stock) - stockTransferReserved - stockOthersBooked - stockEcomReserved
          )
        : Number(stockDoc.stock) - stockTransferReserved - stockOthersBooked - stockEcomReserved;
      if (maxSellable < quantity - (isWeight ? 0.0001 : 0)) {
        throw new Error(`Not enough stock for ${productDoc.name}`);
      }

      stockDoc.stock = isWeight
        ? roundWeight(Number(stockDoc.stock) - quantity)
        : Number(stockDoc.stock) - quantity;
      dirtyProductIds.add(String(stockDoc._id));
      soldProductIds.add(String(productDoc._id));
      if (sourceId) {
        soldProductIds.add(sourceId);
      }

      const invoiceAttributes = buildInvoiceAttributesSnapshot(productDoc, categoryDoc);
      // Category default is true; missing field on legacy categories → show code
      const showProductCodeOnInvoice =
        categoryDoc?.showProductCodeOnInvoice == null
          ? true
          : !!categoryDoc.showProductCodeOnInvoice;

      const weightUnit = isWeight ? normalizeWeightUnit(categoryDoc?.weightUnit) : undefined;

      orderProducts.push({
        productId: selected._id,
        name: selected.name,
        code: selected.code,
        quantity,
        saleUnit: isWeight ? 'weight' : 'piece',
        ...(isWeight ? { weightUnit } : {}),
        price,
        cost: itemCost || Number(productDoc.netPrice || 0),
        isApplyDiscount,
        showProductCodeOnInvoice,
        ...(sourceId ? { sourceProductId: stockDoc._id } : {}),
        ...(invoiceAttributes.length ? { invoiceAttributes } : {}),
      });

      const hideDoc = stockDoc;
      const hideCat = hideDoc.category
        ? categoryById.get(String(hideDoc.category)) ?? categoryDoc
        : categoryDoc;
      if (
        Number(hideDoc.stock) <= (isWeight ? 0.0001 : 0) &&
        hideCat?.deleteProductWhenOutOfStock
      ) {
        autoDeletedProducts.push({
          _id: hideDoc._id,
          code: hideDoc.code,
          name: hideDoc.name,
          stock: hideDoc.stock,
          branch: hideDoc.branch,
          inWarehouse: hideDoc.inWarehouse,
          addedBy: hideDoc.addedBy,
          category: hideDoc.category,
          price: hideDoc.price,
          netPrice: hideDoc.netPrice,
        });
        hideDoc.stock = 0;
        hideDoc.removedWhenOutOfStock = true;
        dirtyProductIds.add(String(hideDoc._id));
      }
    }

    if (dirtyProductIds.size > 0) {
      const bulkOps = [];
      for (const id of dirtyProductIds) {
        const productDoc = productById.get(id);
        if (!productDoc) continue;
        const $set = { stock: productDoc.stock };
        if (productDoc.removedWhenOutOfStock) {
          $set.removedWhenOutOfStock = true;
        }
        bulkOps.push({
          updateOne: {
            filter: { _id: productDoc._id },
            update: { $set },
          },
        });
      }
      if (bulkOps.length) {
        await Product.bulkWrite(bulkOps, w());
      }
    }

    if (!orderProducts.length) {
      await rollbackOrderSession(session);
      return res.status(400).json({ error: 'Order must contain at least one product' });
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
      await rollbackOrderSession(session);
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
      const activeBookings = await q(
        ProductBooking.find({
          _id: { $in: bookingIds.map((id) => new mongoose.Types.ObjectId(id)) },
          status: 'active',
        })
      ).lean();

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
        const clientBookings = await q(
          ProductBooking.find({
            product: { $in: pidOids },
            status: 'active',
          }).sort({ createdAt: 1 })
        ).lean();
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
        await rollbackOrderSession(session);
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
        await rollbackOrderSession(session);
        return res.status(400).json({ error: 'Installment plan is required' });
      }
      const plan = await q(InstallmentPlan.findById(installmentPlanIdRaw));
      if (!plan || plan.enabled === false) {
        await rollbackOrderSession(session);
        return res.status(400).json({ error: 'Installment plan not found or disabled' });
      }

      const startRaw = installmentStartDateRaw || new Date();
      const startDate = new Date(startRaw);
      if (Number.isNaN(startDate.getTime())) {
        await rollbackOrderSession(session);
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
      const sellerUser = await q(User.findById(userId).select('name')).lean();
      resolvedSellerName = String(sellerUser?.name || '').trim();
    }

    const isDelivery = Boolean(isDeliveryRaw);
    const deliveryPersonName = isDelivery
      ? String(deliveryPersonNameRaw || '').trim()
      : '';

    // Explicit checkout collector, else inherit from client (can be reassigned later per invoice).
    let inheritedCollectorId = null;
    if (installmentFields) {
      const explicitCollectorId =
        collectorIdRaw && mongoose.Types.ObjectId.isValid(String(collectorIdRaw))
          ? String(collectorIdRaw)
          : null;
      if (explicitCollectorId) {
        const collectorUser = await q(
          User.findById(explicitCollectorId).select('name role')
        ).lean();
        const role = String(collectorUser?.role || '').trim();
        if (
          collectorUser &&
          (role === 'Collector' || role === 'Co Admin' || role === 'Super Admin')
        ) {
          inheritedCollectorId = collectorUser._id;
        } else {
          await rollbackOrderSession(session);
          return res.status(400).json({
            error: 'Collector must be a Collector, Co Admin, or Super Admin',
          });
        }
      } else if (finalClientId) {
        const clientForCollector = await q(
          Client.findById(finalClientId).select('collectorId')
        ).lean();
        if (clientForCollector?.collectorId) {
          inheritedCollectorId = clientForCollector.collectorId;
        }
      }
    }

    // Installment sale number: cashier may override the system suggestion.
    if (installmentFields) {
      const rawSaleNum = String(installmentSaleNumberRaw ?? '').trim();
      const parsedSaleNum = Math.floor(Number(rawSaleNum));
      if (rawSaleNum !== '') {
        if (!Number.isFinite(parsedSaleNum) || parsedSaleNum < 1) {
          await rollbackOrderSession(session);
          return res.status(400).json({
            error: 'installmentSaleNumber must be a positive integer',
            code: 'INVALID_INSTALLMENT_SALE_NUMBER',
          });
        }
        const taken = await q(
          Order.findOne({ installmentSaleNumber: parsedSaleNum }).select('_id')
        ).lean();
        if (taken) {
          await rollbackOrderSession(session);
          return res.status(409).json({
            error: 'Installment sale number already exists',
            code: 'INSTALLMENT_SALE_NUMBER_TAKEN',
            installmentSaleNumber: parsedSaleNum,
          });
        }
        installmentFields.installmentSaleNumber = parsedSaleNum;
      } else {
        const lastInstallmentSale = await q(
          Order.findOne({ installmentSaleNumber: { $exists: true, $ne: null } })
            .sort({ installmentSaleNumber: -1 })
            .select('installmentSaleNumber')
        ).lean();
        installmentFields.installmentSaleNumber =
          Number(lastInstallmentSale?.installmentSaleNumber || 0) + 1;
      }
    }

    // ======================
    // 3️⃣ CREATE ORDER WITH CASHIER
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
          ...(isDelivery
            ? {
                isDelivery: true,
                ...(deliveryPersonName ? { deliveryPersonName } : {}),
              }
            : {}),
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
      w()
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
          await rollbackOrderSession(session);
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

    await commitOrderSession(session);

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

  await safeTreasuryPost('order_create', async () => {
    await postOrderPaymentLinesToLedger({
      branchId: branch,
      payments: newOrder.payments || [],
      orderId: newOrder._id,
      createdBy: userId,
    });
  });

  const newOrderPlain =
      typeof newOrder?.toObject === 'function' ? newOrder.toObject() : newOrder;

    res.status(201).json({
      message: "✅ Order created successfully",
      newOrder: newOrderPlain,
    });

    void runOrderPostCreateSideEffects({
      req,
      newOrder,
      soldProductIds,
      orderProducts,
      exchangePurchaseStockMovements,
      branch,
      userId,
      autoDeletedProducts,
      validatedBookingAllocations,
      bookingDepositCreditApplied,
    }).catch((err) =>
      console.error('⚠️ post-create order effects:', err?.message || err)
    );
  } catch (err) {
    await rollbackOrderSession(session);
    console.error("❌ Error creating order:", err);
    if (err?.code === 11000 && err?.keyPattern?.installmentSaleNumber) {
      return res.status(409).json({
        error: 'Installment sale number already exists',
        code: 'INSTALLMENT_SALE_NUMBER_TAKEN',
        installmentSaleNumber: err?.keyValue?.installmentSaleNumber,
      });
    }
    res.status(500).json({ error: "Server error", details: err.message });
  }
};

/** Next sequential installmentSaleNumber for cashier prefill (editable override). */
export const getNextInstallmentSaleNumber = async (req, res) => {
  try {
    const last = await Order.findOne({
      installmentSaleNumber: { $exists: true, $ne: null },
    })
      .sort({ installmentSaleNumber: -1 })
      .select('installmentSaleNumber')
      .lean();
    const nextInstallmentSaleNumber = Number(last?.installmentSaleNumber || 0) + 1;
    return res.status(200).json({ nextInstallmentSaleNumber });
  } catch (err) {
    console.error('❌ next installment sale number:', err);
    return res.status(500).json({ error: 'Server error', details: err.message });
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

function roundMoney2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function pickRequestUserId(req) {
  return (
    req?.body?.userId ||
    req?.body?.user_id ||
    req?.body?.actorUserId ||
    req?.query?.userId ||
    req?.headers?.['x-user-id'] ||
    req?.user?._id ||
    null
  );
}

async function requireInstallmentAdminActor(req) {
  const rawId = pickRequestUserId(req);
  if (!rawId || !mongoose.Types.ObjectId.isValid(String(rawId))) {
    return { status: 401, error: 'userId is required' };
  }
  const user = await User.findById(String(rawId)).select('name role branch').lean();
  if (!user) {
    return { status: 401, error: 'User not found' };
  }
  if (String(user.role || '').trim() !== 'Super Admin') {
    return { status: 403, error: 'Only Super Admin can perform this action' };
  }
  return { user };
}

/** Super Admin or Co Admin — edit installment sale number only. */
async function requireInstallmentSaleNumberEditorActor(req) {
  const rawId = pickRequestUserId(req);
  if (!rawId || !mongoose.Types.ObjectId.isValid(String(rawId))) {
    return { status: 401, error: 'userId is required' };
  }
  const user = await User.findById(String(rawId)).select('name role branch').lean();
  if (!user) {
    return { status: 401, error: 'User not found' };
  }
  const role = String(user.role || '').trim();
  if (role !== 'Super Admin' && role !== 'Co Admin') {
    return {
      status: 403,
      error: 'Only Super Admin or Co Admin can perform this action',
    };
  }
  return { user };
}

function installmentSaleSnapshot(order) {
  if (!order) return null;
  return {
    orderId: order._id,
    orderNumber: order.orderNumber,
    installmentSaleNumber: order.installmentSaleNumber,
    clientId: order.clientId,
    clientName: order.clientName,
    clientPhoneNumber: order.clientPhoneNumber,
    totalPrice: order.totalPrice,
    amountPaid: order.amountPaid,
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod,
    branch: order.branch,
    collectorId: order.collectorId,
    installmentPlanSnapshot: order.installmentPlanSnapshot,
    products: (order.products || []).map((p) => ({
      productId: p.productId,
      name: p.name,
      code: p.code,
      quantity: p.quantity,
      price: p.price,
    })),
    installments: (order.installments || []).map((row) => ({
      _id: row._id,
      sequence: row.sequence,
      dueDate: row.dueDate,
      amount: row.amount,
      paid: row.paid,
      paidAmount: row.paidAmount,
      paidAt: row.paidAt,
    })),
  };
}

/**
 * POST /api/orders/:orderId/admin-delete
 * Super Admin — delete installment sale with required reason (audited).
 * Body: { userId, reason }
 */
export const adminDeleteInstallmentSale = async (req, res) => {
  try {
    const auth = await requireInstallmentAdminActor(req);
    if (auth.error) return res.status(auth.status).json({ error: auth.error });

    const reason = String(req.body?.reason || '').trim();
    if (reason.length < 3) {
      return res.status(400).json({ error: 'Deletion reason is required (min 3 characters)' });
    }

    const { orderId } = req.params;
    if (!orderId || !mongoose.Types.ObjectId.isValid(String(orderId))) {
      return res.status(400).json({ error: 'Invalid order id' });
    }

    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (String(order.paymentMethod || '').toLowerCase() !== 'installment') {
      return res.status(400).json({ error: 'Only installment sales can be deleted with this action' });
    }
    if (String(order.status || '') === 'restored') {
      return res.status(400).json({ error: 'Cannot delete a restored invoice' });
    }

    const before = installmentSaleSnapshot(order);
    const saleLabel =
      order.installmentSaleNumber != null
        ? `تقسيط #${order.installmentSaleNumber}`
        : order.orderNumber != null
          ? `فاتورة #${order.orderNumber}`
          : String(order._id);

    await Order.findByIdAndDelete(order._id);

    await auditLog(req, {
      actorUserId: auth.user._id,
      actorName: auth.user.name,
      actorRole: auth.user.role,
      action: 'delete',
      module: 'orders',
      entityType: 'Order',
      entityId: order._id,
      entityLabel: saleLabel,
      message: `${auth.user.role} deleted installment sale ${saleLabel}: ${reason}`,
      metadata: {
        reason,
        installmentSaleNumber: order.installmentSaleNumber,
        orderNumber: order.orderNumber,
        clientName: order.clientName,
        clientPhoneNumber: order.clientPhoneNumber,
        totalPrice: order.totalPrice,
        amountPaid: order.amountPaid,
        adminAction: 'delete_installment_sale',
      },
      before,
    });

    res.json({
      message: '✅ Installment sale deleted',
      deletedOrderId: order._id,
      installmentSaleNumber: order.installmentSaleNumber,
      orderNumber: order.orderNumber,
      reason,
    });
  } catch (err) {
    console.error('❌ adminDeleteInstallmentSale:', err.message);
    res.status(500).json({ error: 'Failed to delete installment sale' });
  }
};

/**
 * PATCH /api/orders/:orderId/admin-sale-number
 * Super Admin / Co Admin — change installmentSaleNumber (optional reason, audited).
 * Body: { userId, installmentSaleNumber, reason? }
 */
export const adminUpdateInstallmentSaleNumber = async (req, res) => {
  try {
    const auth = await requireInstallmentSaleNumberEditorActor(req);
    if (auth.error) return res.status(auth.status).json({ error: auth.error });

    const reason = String(req.body?.reason || '').trim();
    const rawSaleNum = String(req.body?.installmentSaleNumber ?? '').trim();
    const parsedSaleNum = Math.floor(Number(rawSaleNum));
    if (!rawSaleNum || !Number.isFinite(parsedSaleNum) || parsedSaleNum < 1) {
      return res.status(400).json({
        error: 'installmentSaleNumber must be a positive integer',
        code: 'INVALID_INSTALLMENT_SALE_NUMBER',
      });
    }

    const { orderId } = req.params;
    if (!orderId || !mongoose.Types.ObjectId.isValid(String(orderId))) {
      return res.status(400).json({ error: 'Invalid order id' });
    }

    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (String(order.paymentMethod || '').toLowerCase() !== 'installment') {
      return res.status(400).json({ error: 'Only installment sales support this edit' });
    }
    if (String(order.status || '') === 'restored') {
      return res.status(400).json({ error: 'Cannot edit a restored invoice' });
    }

    const previousSaleNumber =
      order.installmentSaleNumber != null && Number.isFinite(Number(order.installmentSaleNumber))
        ? Number(order.installmentSaleNumber)
        : null;

    if (previousSaleNumber === parsedSaleNum) {
      return res.json({
        message: '✅ Installment sale number unchanged',
        orderId: order._id,
        installmentSaleNumber: previousSaleNumber,
      });
    }

    const taken = await Order.findOne({
      installmentSaleNumber: parsedSaleNum,
      _id: { $ne: order._id },
    })
      .select('_id')
      .lean();
    if (taken) {
      return res.status(409).json({
        error: 'Installment sale number already exists',
        code: 'INSTALLMENT_SALE_NUMBER_TAKEN',
        installmentSaleNumber: parsedSaleNum,
      });
    }

    const before = installmentSaleSnapshot(order);
    order.installmentSaleNumber = parsedSaleNum;
    await order.save();

    const saleLabel = `تقسيط #${parsedSaleNum}`;
    await auditLog(req, {
      actorUserId: auth.user._id,
      actorName: auth.user.name,
      actorRole: auth.user.role,
      action: 'update',
      module: 'orders',
      entityType: 'Order',
      entityId: order._id,
      entityLabel: saleLabel,
      message: reason
        ? `${auth.user.role} changed installment sale number ${
            previousSaleNumber != null ? `#${previousSaleNumber}` : '(none)'
          } → #${parsedSaleNum}: ${reason}`
        : `${auth.user.role} changed installment sale number ${
            previousSaleNumber != null ? `#${previousSaleNumber}` : '(none)'
          } → #${parsedSaleNum}`,
      metadata: {
        reason: reason || undefined,
        adminAction: 'edit_installment_sale_number',
        previousInstallmentSaleNumber: previousSaleNumber,
        installmentSaleNumber: parsedSaleNum,
        orderNumber: order.orderNumber,
        clientName: order.clientName,
        clientPhoneNumber: order.clientPhoneNumber,
      },
      before,
      after: installmentSaleSnapshot(order),
    });

    res.json({
      message: '✅ Installment sale number updated',
      orderId: order._id,
      previousInstallmentSaleNumber: previousSaleNumber,
      installmentSaleNumber: parsedSaleNum,
      reason: reason || undefined,
    });
  } catch (err) {
    console.error('❌ adminUpdateInstallmentSaleNumber:', err.message);
    if (err?.code === 11000 && err?.keyPattern?.installmentSaleNumber) {
      return res.status(409).json({
        error: 'Installment sale number already exists',
        code: 'INSTALLMENT_SALE_NUMBER_TAKEN',
        installmentSaleNumber: err?.keyValue?.installmentSaleNumber,
      });
    }
    res.status(500).json({ error: 'Failed to update installment sale number' });
  }
};

/**
 * PATCH /api/orders/:orderId/installments/:installmentId/admin
 * Super Admin — edit dueDate and/or amount (optional reason, audited).
 * Body: { userId, reason?, dueDate?, amount?, applyDueDateShiftToAll? }
 * When applyDueDateShiftToAll is true, unpaid installments are rebuilt from this
 * row's new dueDate using monthly sequence offsets (same day-of-month, clamped).
 */
export const adminUpdateInstallmentRow = async (req, res) => {
  try {
    const auth = await requireInstallmentAdminActor(req);
    if (auth.error) return res.status(auth.status).json({ error: auth.error });

    const reason = String(req.body?.reason || '').trim();
    const applyDueDateShiftToAll = !!req.body?.applyDueDateShiftToAll;

    const hasDueDate = Object.prototype.hasOwnProperty.call(req.body || {}, 'dueDate');
    const hasAmount = Object.prototype.hasOwnProperty.call(req.body || {}, 'amount');
    if (!hasDueDate && !hasAmount) {
      return res.status(400).json({ error: 'Provide dueDate and/or amount to update' });
    }
    if (applyDueDateShiftToAll && !hasDueDate) {
      return res.status(400).json({
        error: 'applyDueDateShiftToAll requires dueDate',
      });
    }

    const { orderId, installmentId } = req.params;
    if (!orderId || !mongoose.Types.ObjectId.isValid(String(orderId))) {
      return res.status(400).json({ error: 'Invalid order id' });
    }

    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (String(order.paymentMethod || '').toLowerCase() !== 'installment') {
      return res.status(400).json({ error: 'Only installment sales support this edit' });
    }
    if (String(order.status || '') === 'restored') {
      return res.status(400).json({ error: 'Cannot edit a restored invoice' });
    }
    if (!Array.isArray(order.installments) || !order.installments.length) {
      return res.status(400).json({ error: 'Order has no installments' });
    }

    const row =
      order.installments.id(installmentId) ||
      order.installments.find((r) => String(r._id) === String(installmentId));
    if (!row) return res.status(404).json({ error: 'Installment not found' });

    const isInstallmentPaidByClient = (inst) => {
      if (!inst) return false;
      if (inst.paid === true) return true;
      const amt = roundMoney2(inst.amount);
      const paidAmt = roundMoney2(inst.paidAmount);
      if (paidAmt > 0.005 && paidAmt >= amt - 0.005) return true;
      return false;
    };

    if (isInstallmentPaidByClient(row)) {
      return res.status(400).json({
        error: 'Cannot edit an installment that was already paid by the client',
      });
    }

    const noonLocal = (value) => {
      const d = value instanceof Date ? new Date(value) : new Date(value);
      if (Number.isNaN(d.getTime())) return null;
      d.setHours(12, 0, 0, 0);
      return d;
    };

    /** Parse YYYY-MM-DD as a local calendar date (avoids UTC midnight day-shift). */
    const parseDueInput = (rawDue) => {
      if (typeof rawDue === 'string') {
        const m = rawDue.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (m) {
          const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
          return Number.isNaN(date.getTime()) ? null : date;
        }
      }
      return noonLocal(rawDue);
    };

    /** Add calendar months keeping day-of-month (clamped to month length). */
    const addCalendarMonths = (baseDate, monthDelta) => {
      const y = baseDate.getFullYear();
      const m = baseDate.getMonth();
      const day = baseDate.getDate();
      const total = y * 12 + m + monthDelta;
      const ty = Math.floor(total / 12);
      const tm = ((total % 12) + 12) % 12;
      const lastDay = new Date(ty, tm + 1, 0).getDate();
      return new Date(ty, tm, Math.min(day, lastDay), 12, 0, 0, 0);
    };

    const beforeInstallments = (order.installments || []).map((r) => ({
      _id: r._id,
      sequence: r.sequence,
      dueDate: r.dueDate,
      amount: r.amount,
      paid: r.paid,
      paidAmount: r.paidAmount,
    }));
    const beforeRow = beforeInstallments.find((r) => String(r._id) === String(row._id));
    const beforeTotal = order.totalPrice;
    const beforePaymentStatus = order.paymentStatus;
    const beforeStartDate = order.installmentStartDate;

    let appliedDayOfMonth = null;
    let shiftedCount = 0;

    if (hasDueDate) {
      const rawDue = req.body.dueDate;
      if (rawDue == null || rawDue === '') {
        return res.status(400).json({ error: 'dueDate cannot be empty' });
      }
      const due = parseDueInput(rawDue);
      if (!due) {
        return res.status(400).json({ error: 'Invalid dueDate' });
      }

      if (applyDueDateShiftToAll) {
        appliedDayOfMonth = due.getDate();
        const anchorSeq = Number(row.sequence);
        if (!Number.isFinite(anchorSeq)) {
          return res.status(400).json({ error: 'Installment sequence is required to update all due dates' });
        }
        // Rebuild unpaid schedule from this installment (fixes rows corrupted by older shifts).
        for (const inst of order.installments) {
          if (isInstallmentPaidByClient(inst)) continue;
          const seq = Number(inst.sequence);
          if (!Number.isFinite(seq)) continue;
          inst.dueDate = addCalendarMonths(due, seq - anchorSeq);
          shiftedCount += 1;
        }
        const start = addCalendarMonths(due, 1 - anchorSeq);
        order.installmentStartDate = start;
        order.markModified('installments');
      } else {
        row.dueDate = due;
        shiftedCount = 1;
        order.markModified('installments');
      }
    }

    if (hasAmount) {
      const nextAmount = roundMoney2(req.body.amount);
      if (!Number.isFinite(nextAmount) || nextAmount < 0) {
        return res.status(400).json({ error: 'amount must be a non-negative number' });
      }
      row.amount = nextAmount;
      const paidAmt = roundMoney2(row.paidAmount);
      if (paidAmt > nextAmount + 0.001) {
        return res.status(400).json({
          error: 'New amount cannot be less than already paid on this installment',
        });
      }
      if (paidAmt > 0 && Math.abs(paidAmt - nextAmount) <= 0.005) {
        row.paid = true;
      } else if (paidAmt <= 0.005) {
        row.paid = false;
      } else {
        row.paid = false;
      }

      const sumInstallments = roundMoney2(
        (order.installments || []).reduce((s, r) => s + (Number(r.amount) || 0), 0)
      );
      order.totalPrice = sumInstallments;
      const paid = roundMoney2(order.amountPaid);
      if (paid >= sumInstallments - 0.005) {
        order.paymentStatus = 'paid';
        order.amountPaid = sumInstallments;
      } else if (paid > 0) {
        order.paymentStatus = 'partial';
      } else {
        order.paymentStatus = 'unpaid';
      }
    }

    await order.save();

    const afterInstallments = (order.installments || []).map((r) => ({
      _id: r._id,
      sequence: r.sequence,
      dueDate: r.dueDate,
      amount: r.amount,
      paid: r.paid,
      paidAmount: r.paidAmount,
    }));
    const afterRow = afterInstallments.find((r) => String(r._id) === String(row._id));

    const saleLabel =
      order.installmentSaleNumber != null
        ? `تقسيط #${order.installmentSaleNumber}`
        : order.orderNumber != null
          ? `فاتورة #${order.orderNumber}`
          : String(order._id);

    const scopeLabel = applyDueDateShiftToAll
      ? `all unpaid installments (${shiftedCount}) monthly from #${row.sequence} on day ${appliedDayOfMonth}`
      : `installment #${row.sequence}`;

    await auditLog(req, {
      actorUserId: auth.user._id,
      actorName: auth.user.name,
      actorRole: auth.user.role,
      action: 'update',
      module: 'orders',
      entityType: 'Order',
      entityId: order._id,
      entityLabel: applyDueDateShiftToAll
        ? `${saleLabel} · كل الأقساط`
        : `${saleLabel} · قسط #${row.sequence}`,
      message: reason
        ? `${auth.user.role} edited ${scopeLabel} on ${saleLabel}: ${reason}`
        : `${auth.user.role} edited ${scopeLabel} on ${saleLabel}`,
      metadata: {
        reason: reason || undefined,
        adminAction: applyDueDateShiftToAll
          ? 'edit_installment_due_day_all'
          : 'edit_installment_row',
        installmentSaleNumber: order.installmentSaleNumber,
        orderNumber: order.orderNumber,
        installmentId: row._id,
        installmentSequence: row.sequence,
        changedDueDate: hasDueDate,
        changedAmount: hasAmount,
        applyDueDateShiftToAll,
        appliedDayOfMonth: applyDueDateShiftToAll ? appliedDayOfMonth : undefined,
        shiftedInstallmentCount: applyDueDateShiftToAll ? shiftedCount : undefined,
      },
      before: {
        installment: beforeRow,
        installments: applyDueDateShiftToAll ? beforeInstallments : undefined,
        installmentStartDate: beforeStartDate,
        totalPrice: beforeTotal,
        paymentStatus: beforePaymentStatus,
      },
      after: {
        installment: afterRow,
        installments: applyDueDateShiftToAll ? afterInstallments : undefined,
        installmentStartDate: order.installmentStartDate,
        totalPrice: order.totalPrice,
        paymentStatus: order.paymentStatus,
      },
    });

    res.json({
      message: applyDueDateShiftToAll
        ? '✅ Installment due dates updated'
        : '✅ Installment updated',
      orderId: order._id,
      installment: afterRow,
      installments: applyDueDateShiftToAll ? afterInstallments : undefined,
      shiftedInstallmentCount: applyDueDateShiftToAll ? shiftedCount : undefined,
      appliedDayOfMonth: applyDueDateShiftToAll ? appliedDayOfMonth : undefined,
      totalPrice: order.totalPrice,
      paymentStatus: order.paymentStatus,
      reason,
    });
  } catch (err) {
    console.error('❌ adminUpdateInstallmentRow:', err.message);
    res.status(500).json({ error: 'Failed to update installment' });
  }
};
