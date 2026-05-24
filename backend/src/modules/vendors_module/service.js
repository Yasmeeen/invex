
import Vendor from "../../DB/models/vendor.model.js";
import Order from "../../DB/models/order.model.js";
import PurchasingRequest from "../../DB/models/purchasingRequest.model.js";
import mongoose from "mongoose";
import { buildPhoneSearchCandidates, digitsOnly } from "../../utils/phone-utils.js";
import {
  computeSupplierOwesFromOrders,
  computeSupplierOwesUs,
  orderAmountRemaining,
} from "../../utils/vendor-balance-utils.js";
import {
  buildNetBalanceMessage,
  buildSettlementPreview,
  computeTotalCreditOwed,
} from "../../utils/vendor-balance-summary.js";
import {
  applyPurchasePayableSettlement,
  computePurchasePayableBreakdown,
  deferredPurchaseRemaining,
  recordVendorDeferredPayment,
  syncVendorPurchaseLedger,
  unpaidInstallmentsTotal,
} from "../../utils/vendor-purchase-ledger.js";
import {
  buildCashDrawerLedgerFields,
  recordVendorCashDrawerPayment,
  resolveBranchForCashDrawer,
} from "../../utils/vendor-cash-drawer.js";
import {
  buildCashDrawerInflowLedgerFields,
  recordVendorCashDrawerReceipt,
} from "../../utils/vendor-cash-drawer-inflow.js";
import {
  buildTreasurySplitsFromPayment,
  cashAmountFromPaymentSplits,
  isPhysicalCashMethod,
  normalizePaymentFeeAllocations,
  normalizePaymentSplitsRaw,
  totalNetFromPaymentSplits,
} from "../../utils/deposit-payment-splits.js";

// 📌 Create Vendor
export const createVendor = async (req, res) => {
  try {
    const {
      nameOfcompany,
      name,
      email,
      address,
      phone,
      transactionCurrency,
      paymentTerms,
      categories
    } = req.body;


    
    if  (
        !nameOfcompany ||
        !name ||
        !phone ||
        !paymentTerms ||
        paymentTerms.length === 0 ||
        !categories ||
        categories.length === 0
      ) {
      return res.status(400).json({ message: 'Please fill all required fields' });
    }

    const vendor = new Vendor({
      nameOfcompany,
      name,
      email,
      address,
      phone,
      transactionCurrency,
      paymentTerms,
      categories
    });

    const savedVendor = await vendor.save();
    res.status(201).json(savedVendor);
  } catch (error) {
    console.error('Error creating vendor:', error);
    res.status(500).json({ message: 'Server error while creating vendor' });
  }
};

// 📌 Get Vendors (with pagination + search)
export const getVendors = async (req, res) => {
    try {
      const { page = 1, limit = 10, search = '' } = req.query;
  
      const query = search
        ? {
            $or: [
              { nameOfcompany: { $regex: search, $options: 'i' } },
              { name: { $regex: search, $options: 'i' } },
              { phone: { $regex: search, $options: 'i' } },
            ],
          }
        : {};
  
      const totalCount = await Vendor.countDocuments(query);
      const totalPages = Math.ceil(totalCount / limit);
      const currentPage = parseInt(page);
      const nextPage = currentPage < totalPages ? currentPage + 1 : null;
      const prevPage = currentPage > 1 ? currentPage - 1 : null;
  
      const vendors = await Vendor.find(query)
        .populate('categories', 'name')
        .skip((currentPage - 1) * limit)
        .limit(parseInt(limit))
        .sort({ createdAt: -1 });
  
      res.json({
        vendors,
        meta: {
          currentPage,
          nextPage,
          prevPage,
          totalCount,
          totalPages,
        },
      });
    } catch (error) {
      console.error('Error fetching vendors:', error);
      res.status(500).json({ message: 'Server error while fetching vendors' });
    }
  };
  

// 📌 Get Vendor by ID
export const getVendorById = async (req, res) => {
  try {
    const vendor = await Vendor.findById(req.params.id).populate('categories', 'name');

    if (!vendor) {
      return res.status(404).json({ message: 'Vendor not found' });
    }

    res.json(vendor);
  } catch (error) {
    console.error('Error fetching vendor:', error);
    res.status(500).json({ message: 'Server error while fetching vendor' });
  }
};

// 📌 Update Vendor
export const updateVendor = async (req, res) => {
  try {
    const {
      nameOfcompany,
      name,
      email,
      phone,
      address,
      transactionCurrency,
      paymentTerms,
      categories,
    } = req.body;

    const vendor = await Vendor.findById(req.params.id);
    if (!vendor) {
      return res.status(404).json({ message: 'Vendor not found' });
    }

    vendor.nameOfcompany = nameOfcompany || vendor.nameOfcompany;
    vendor.name = name || vendor.name;
    vendor.email = email || vendor.email;
    vendor.transactionCurrency = transactionCurrency || vendor.transactionCurrency;
    vendor.paymentTerms = paymentTerms || vendor.paymentTerms;
    vendor.categories = categories || vendor.categories;
    vendor.phone = phone || vendor.phone;
    vendor.address = address || vendor.address


    const updatedVendor = await vendor.save();
    res.json(updatedVendor);
  } catch (error) {
    console.error('Error updating vendor:', error);
    res.status(500).json({ message: 'Server error while updating vendor' });
  }
};

/** GET supplier by phone (cashier lookup). */
export const getVendorByPhone = async (req, res) => {
  try {
    const param = req.params.phone;
    if (!param) {
      return res.status(400).json({ message: 'Phone is required' });
    }

    const candidates = buildPhoneSearchCandidates(param);
    const last10 = digitsOnly(param).slice(-10);

    let vendor = await Vendor.findOne({ phone: { $in: candidates } });

    if (!vendor && last10 && last10.length === 10) {
      vendor = await Vendor.findOne({
        phone: { $regex: new RegExp(`${last10}$`) },
      });
    }

    if (!vendor) {
      return res.status(404).json({ message: 'Vendor not found' });
    }

    res.json({
      _id: vendor._id,
      name: vendor.name,
      nameOfcompany: vendor.nameOfcompany,
      address: vendor.address,
      phone: vendor.phone,
      email: vendor.email,
    });
  } catch (error) {
    console.error('Error fetching vendor by phone:', error);
    res.status(500).json({ message: 'Server error while fetching vendor' });
  }
};

/** GET supplier account history: balances, orders, ledger. */
export const getVendorHistory = async (req, res) => {
  try {
    const vendor = await Vendor.findById(req.params.id).populate('categories', 'name');
    if (!vendor) {
      return res.status(404).json({ message: 'Vendor not found' });
    }

    const owesFromSales = await computeSupplierOwesFromOrders(vendor._id);
    const owesFromOpeningBalance =
      Math.round((Number(vendor.openingDebitBalance) || 0) * 100) / 100;
    const supplierOwesUs = Math.round((owesFromSales + owesFromOpeningBalance) * 100) / 100;
    const prepaidBalance = Math.round((Number(vendor.creditBalance) || 0) * 100) / 100;
    const buyerPrepaidBalance =
      Math.round((Number(vendor.buyerPrepaidBalance) || 0) * 100) / 100;
    const purchasePayableBreakdown = await computePurchasePayableBreakdown(vendor._id);
    const purchasePayable = purchasePayableBreakdown.total;
    const weOweSupplier = computeTotalCreditOwed(
      prepaidBalance,
      purchasePayable,
      buyerPrepaidBalance
    );
    const ledgerPurchases = await PurchasingRequest.find({
      supplier: vendor._id,
      paymentStatus: { $in: ['Installments', 'Deferred'] },
    }).lean();

    const linkedInstallmentIds = new Set(
      (vendor.ledgerEntries || [])
        .filter((e) => e.type === 'purchase' && e.purchasingRequestId)
        .map((e) => String(e.purchasingRequestId))
    );
    const linkedDeferredIds = new Set(
      (vendor.ledgerEntries || [])
        .filter((e) => e.type === 'purchase_deferred' && e.purchasingRequestId)
        .map((e) => String(e.purchasingRequestId))
    );
    for (const pr of ledgerPurchases) {
      const needsInstallment =
        pr.paymentStatus === 'Installments' && !linkedInstallmentIds.has(String(pr._id));
      const needsDeferred =
        pr.paymentStatus === 'Deferred' &&
        (!linkedDeferredIds.has(String(pr._id)) ||
          !(vendor.ledgerEntries || []).some(
            (e) =>
              e.type === 'purchase_deferred' &&
              String(e.purchasingRequestId) === String(pr._id) &&
              String(e.note || '').includes('مستحق علينا')
          ));
      if (needsInstallment || needsDeferred) {
        try {
          await syncVendorPurchaseLedger(pr);
        } catch (backfillErr) {
          console.error('⚠️ Vendor purchase ledger backfill:', backfillErr.message);
        }
      }
    }

    const vendorRefreshed = await Vendor.findById(vendor._id);
    const ledgerSource = vendorRefreshed || vendor;

    const purchasingRequests = await PurchasingRequest.find({
      supplier: vendor._id,
      paymentStatus: { $in: ['Installments', 'Deferred'] },
    })
      .select(
        'requestDate requestedBy status totalAmount installments paymentStatus amountPaid createdAt'
      )
      .sort({ requestDate: -1 })
      .limit(100)
      .lean();

    const purchasingRequestsWithRemaining = purchasingRequests.map((pr) => ({
      ...pr,
      remaining:
        pr.paymentStatus === 'Deferred'
          ? deferredPurchaseRemaining(pr)
          : unpaidInstallmentsTotal(pr),
      amountPaid: Number(pr.amountPaid) || 0,
    }));

    const orders = await Order.find({
      partyType: 'supplier',
      vendorId: vendor._id,
    })
      .select(
        'orderNumber clientName clientPhoneNumber totalPrice amountPaid paymentStatus paymentMethod status createdAt'
      )
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    const ordersWithRemaining = orders.map((o) => ({
      ...o,
      remaining: orderAmountRemaining(o),
    }));

    const netBalanceMessage = buildNetBalanceMessage(supplierOwesUs, weOweSupplier);
    const settlementPreview = buildSettlementPreview(supplierOwesUs, weOweSupplier);

    res.json({
      vendor,
      supplierOwesUs,
      owesFromSales,
      owesFromOpeningBalance,
      weOweSupplier,
      prepaidBalance,
      buyerPrepaidBalance,
      purchasePayable,
      purchasePayableInstallments: purchasePayableBreakdown.installments,
      purchasePayableDeferred: purchasePayableBreakdown.deferred,
      canSettle: settlementPreview.canSettle,
      settlementPreview,
      netBalanceMessage,
      orders: ordersWithRemaining,
      purchasingRequests: purchasingRequestsWithRemaining,
      ledgerEntries: (ledgerSource.ledgerEntries || []).slice().reverse(),
    });
  } catch (error) {
    console.error('Error fetching vendor history:', error);
    res.status(500).json({ message: 'Server error while fetching vendor history' });
  }
};

/** POST net settlement between supplier debt and our prepaid balance. */
export const settleVendorBalances = async (req, res) => {
  try {
    const vendor = await Vendor.findById(req.params.id);
    if (!vendor) {
      return res.status(404).json({ message: 'Vendor not found' });
    }

    const supplierOwesUs = await computeSupplierOwesUs(vendor._id);
    const prepaidBefore = Math.round((Number(vendor.creditBalance) || 0) * 100) / 100;
    const buyerPrepaidBefore =
      Math.round((Number(vendor.buyerPrepaidBalance) || 0) * 100) / 100;
    const purchasePayableBefore = await computePurchasePayableBreakdown(vendor._id);
    const totalCreditBefore = computeTotalCreditOwed(
      prepaidBefore,
      purchasePayableBefore.total,
      buyerPrepaidBefore
    );
    const settleAmount = Math.min(supplierOwesUs, totalCreditBefore);

    if (settleAmount <= 0) {
      return res.status(400).json({
        message: 'No overlapping balances to settle',
        supplierOwesUs,
        weOweSupplier: totalCreditBefore,
        prepaidBalance: prepaidBefore,
        purchasePayable: purchasePayableBefore.total,
      });
    }

    let remaining = settleAmount;
    const unpaidOrders = await Order.find({
      partyType: 'supplier',
      vendorId: vendor._id,
      status: { $ne: 'restored' },
    }).sort({ createdAt: 1 });

    const uid = mongoose.Types.ObjectId.isValid(String(req.body?.userId || ''))
      ? new mongoose.Types.ObjectId(String(req.body.userId))
      : undefined;

    for (const order of unpaidOrders) {
      if (remaining <= 0) break;
      const orderRem = orderAmountRemaining(order);
      if (orderRem <= 0) continue;

      const apply = Math.min(remaining, orderRem);
      order.payments = order.payments || [];
      order.payments.push({
        amount: apply,
        paidAt: new Date(),
        paidByUserId: uid,
        method: 'settlement',
        note: 'Balance settlement (netting)',
      });
      const paid = Number(order.amountPaid) || 0;
      order.amountPaid = Math.round((paid + apply) * 100) / 100;
      const total = Number(order.totalPrice) || 0;
      order.paymentStatus =
        order.amountPaid >= total - 0.001
          ? 'paid'
          : order.amountPaid > 0
            ? 'partial'
            : 'unpaid';
      await order.save();
      remaining = Math.round((remaining - apply) * 100) / 100;
    }

    if (remaining > 0) {
      const openingBefore =
        Math.round((Number(vendor.openingDebitBalance) || 0) * 100) / 100;
      const fromOpening = Math.min(remaining, openingBefore);
      vendor.openingDebitBalance = Math.round((openingBefore - fromOpening) * 100) / 100;
      remaining = Math.round((remaining - fromOpening) * 100) / 100;
    }

    let creditToReduce = settleAmount;
    const fromBuyerPrepaid = Math.min(creditToReduce, buyerPrepaidBefore);
    vendor.buyerPrepaidBalance = Math.round((buyerPrepaidBefore - fromBuyerPrepaid) * 100) / 100;
    creditToReduce = Math.round((creditToReduce - fromBuyerPrepaid) * 100) / 100;

    const fromPrepaid = Math.min(creditToReduce, prepaidBefore);
    vendor.creditBalance = Math.round((prepaidBefore - fromPrepaid) * 100) / 100;
    creditToReduce = Math.round((creditToReduce - fromPrepaid) * 100) / 100;

    if (creditToReduce > 0) {
      await applyPurchasePayableSettlement(vendor._id, creditToReduce, {
        userId: uid,
        note: 'Balance settlement (netting)',
      });
    }

    vendor.ledgerEntries = vendor.ledgerEntries || [];
    vendor.ledgerEntries.push({
      type: 'settlement',
      amount: settleAmount,
      note: String(req.body?.note || 'Balance settlement').trim(),
      createdAt: new Date(),
      createdByUserId: uid,
    });
    await vendor.save();

    const newOwesFromSales = await computeSupplierOwesFromOrders(vendor._id);
    const newOwesFromOpening =
      Math.round((Number(vendor.openingDebitBalance) || 0) * 100) / 100;
    const newSupplierOwesUs = await computeSupplierOwesUs(vendor._id);
    const newPrepaid = Math.round((Number(vendor.creditBalance) || 0) * 100) / 100;
    const newBuyerPrepaid =
      Math.round((Number(vendor.buyerPrepaidBalance) || 0) * 100) / 100;
    const newPayableBreakdown = await computePurchasePayableBreakdown(vendor._id);
    const newWeOwe = computeTotalCreditOwed(
      newPrepaid,
      newPayableBreakdown.total,
      newBuyerPrepaid
    );
    const netBalanceMessage = buildNetBalanceMessage(newSupplierOwesUs, newWeOwe);
    const settlementPreview = buildSettlementPreview(newSupplierOwesUs, newWeOwe);

    res.json({
      message: 'Balances settled',
      settled: settleAmount,
      supplierOwesUs: newSupplierOwesUs,
      owesFromSales: newOwesFromSales,
      owesFromOpeningBalance: newOwesFromOpening,
      weOweSupplier: newWeOwe,
      prepaidBalance: newPrepaid,
      buyerPrepaidBalance: newBuyerPrepaid,
      purchasePayable: newPayableBreakdown.total,
      purchasePayableInstallments: newPayableBreakdown.installments,
      purchasePayableDeferred: newPayableBreakdown.deferred,
      netBalanceMessage,
      settlementPreview,
    });
  } catch (error) {
    console.error('Error settling vendor balances:', error);
    res.status(500).json({ message: 'Server error while settling balances' });
  }
};

/** POST record our payment to supplier on a deferred (آجل) purchase. */
export const recordVendorDeferredPurchasePayment = async (req, res) => {
  try {
    const { purchasingRequestId, paymentTreasurySplits: splitsRaw, amount: amountRaw } =
      req.body || {};

    let amount = Number(amountRaw);
    if (Array.isArray(splitsRaw) && splitsRaw.length) {
      amount = splitsRaw.reduce((acc, row) => acc + (Number(row?.amount) || 0), 0);
    }
    amount = Math.round(amount * 100) / 100;

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ message: 'Valid amount is required' });
    }
    if (!purchasingRequestId || !mongoose.Types.ObjectId.isValid(String(purchasingRequestId))) {
      return res.status(400).json({ message: 'Valid purchasingRequestId is required' });
    }

    const vendor = await Vendor.findById(req.params.id);
    if (!vendor) {
      return res.status(404).json({ message: 'Vendor not found' });
    }

    const request = await PurchasingRequest.findOne({
      _id: purchasingRequestId,
      supplier: vendor._id,
      paymentStatus: 'Deferred',
    });

    if (!request) {
      return res.status(404).json({ message: 'Deferred purchasing request not found' });
    }

    const result = await recordVendorDeferredPayment(request, amount, {
      userId: req.body?.userId,
      branchId: req.body?.branchId,
      note: req.body?.note,
      paymentTreasurySplits: splitsRaw,
    });

    const purchasePayableBreakdown = await computePurchasePayableBreakdown(vendor._id);

    res.json({
      message: 'Payment recorded',
      ...result,
      purchasePayable: purchasePayableBreakdown.total,
      purchasePayableInstallments: purchasePayableBreakdown.installments,
      purchasePayableDeferred: purchasePayableBreakdown.deferred,
    });
  } catch (error) {
    const msg = error?.message || 'Failed to record payment';
    const status = msg.includes('Nothing remaining') ? 400 : 500;
    console.error('Error recording deferred purchase payment:', error);
    res.status(status).json({ message: msg });
  }
};

/** POST set one-time opening debit (pre-system credit sales). */
export const setVendorOpeningDebitBalance = async (req, res) => {
  try {
    const vendor = await Vendor.findById(req.params.id);
    if (!vendor) {
      return res.status(404).json({ message: 'Vendor not found' });
    }

    const amount = Math.round((Number(req.body?.amount) || 0) * 100) / 100;
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ message: 'Valid amount is required' });
    }

    const existing = Math.round((Number(vendor.openingDebitBalance) || 0) * 100) / 100;
    const alreadySet = (vendor.ledgerEntries || []).some((e) => e.type === 'opening_debit');
    if (existing > 0 || alreadySet) {
      return res.status(400).json({
        message: 'Opening debit balance already set',
        openingDebitBalance: existing,
      });
    }

    const uid = mongoose.Types.ObjectId.isValid(String(req.body?.userId || ''))
      ? new mongoose.Types.ObjectId(String(req.body.userId))
      : undefined;

    const note =
      String(req.body?.note || 'Opening debit — pre-system credit sales').trim() ||
      'Opening debit — pre-system credit sales';

    vendor.openingDebitBalance = amount;
    vendor.ledgerEntries = vendor.ledgerEntries || [];
    vendor.ledgerEntries.push({
      type: 'opening_debit',
      amount,
      note,
      affectsCashDrawer: false,
      createdAt: new Date(),
      createdByUserId: uid,
    });
    await vendor.save();

    const owesFromSales = await computeSupplierOwesFromOrders(vendor._id);
    const supplierOwesUs = await computeSupplierOwesUs(vendor._id);

    res.json({
      message: 'Opening debit balance set',
      openingDebitBalance: vendor.openingDebitBalance,
      owesFromOpeningBalance: vendor.openingDebitBalance,
      owesFromSales,
      supplierOwesUs,
    });
  } catch (error) {
    console.error('Error setting vendor opening debit:', error);
    res.status(500).json({ message: 'Server error while setting opening debit balance' });
  }
};

/** POST pay down opening debit (supplier pays pre-system debt). */
export const payVendorOpeningDebitBalance = async (req, res) => {
  try {
    const vendor = await Vendor.findById(req.params.id);
    if (!vendor) {
      return res.status(404).json({ message: 'Vendor not found' });
    }

    const amount = Math.round((Number(req.body?.amount) || 0) * 100) / 100;
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ message: 'Valid amount is required' });
    }

    const openingBefore = Math.round((Number(vendor.openingDebitBalance) || 0) * 100) / 100;
    if (openingBefore <= 0) {
      return res.status(400).json({ message: 'No opening debit balance to pay' });
    }

    const applied = Math.min(amount, openingBefore);
    const method = String(req.body?.method || 'cash').trim().toLowerCase() || 'cash';
    const note = String(req.body?.note || 'Opening debit payment').trim();

    const uid = mongoose.Types.ObjectId.isValid(String(req.body?.userId || ''))
      ? new mongoose.Types.ObjectId(String(req.body.userId))
      : undefined;

    const branchId = await resolveBranchForCashDrawer({
      userId: req.body?.userId,
      branchId: req.body?.branchId,
    });
    const fromCashDrawer = isPhysicalCashMethod(method);

    vendor.openingDebitBalance = Math.round((openingBefore - applied) * 100) / 100;
    vendor.ledgerEntries = vendor.ledgerEntries || [];
    vendor.ledgerEntries.push({
      type: 'opening_debit_payment',
      amount: applied,
      note: `${note}${method ? ` — ${method}` : ''}`,
      createdAt: new Date(),
      createdByUserId: uid,
      ...buildCashDrawerInflowLedgerFields({
        fromCashDrawer,
        branchId: fromCashDrawer ? branchId : undefined,
      }),
    });
    await vendor.save();

    if (fromCashDrawer && applied > 0) {
      await recordVendorCashDrawerReceipt({
        branchId: req.body?.branchId,
        userId: req.body?.userId,
        vendorId: vendor._id,
        amount: applied,
        paymentType: 'opening_debit_payment',
        note,
      });
    }

    const owesFromSales = await computeSupplierOwesFromOrders(vendor._id);
    const supplierOwesUs = await computeSupplierOwesUs(vendor._id);

    res.json({
      message: 'Opening debit payment recorded',
      applied,
      openingDebitBalance: vendor.openingDebitBalance,
      owesFromOpeningBalance: vendor.openingDebitBalance,
      owesFromSales,
      supplierOwesUs,
      cashDrawerAmount: fromCashDrawer ? applied : 0,
    });
  } catch (error) {
    console.error('Error paying vendor opening debit:', error);
    res.status(500).json({ message: 'Server error while recording opening debit payment' });
  }
};

/** POST pay supplier in advance (we purchase FROM them — cash leaves drawer). */
export const addVendorDeposit = async (req, res) => {
  try {
    const vendor = await Vendor.findById(req.params.id);
    if (!vendor) {
      return res.status(404).json({ message: 'Vendor not found' });
    }

    const splitsRaw = req.body?.paymentSplits ?? req.body?.paymentMethodSplits;
    let splits = normalizePaymentSplitsRaw(splitsRaw);
    const feeAllocations = normalizePaymentFeeAllocations(req.body?.paymentFeeAllocations);

    if (!splits.length) {
      const amount = Number(req.body?.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ message: 'Valid amount is required' });
      }
      splits = [{ method: 'cash', amount: Math.round(amount * 100) / 100 }];
    }

    const applied = totalNetFromPaymentSplits(splits);
    if (applied <= 0) {
      return res.status(400).json({ message: 'Valid amount is required' });
    }

    vendor.creditBalance =
      Math.round(((Number(vendor.creditBalance) || 0) + applied) * 100) / 100;

    const uid = mongoose.Types.ObjectId.isValid(String(req.body?.userId || ''))
      ? new mongoose.Types.ObjectId(String(req.body.userId))
      : undefined;

    const branchId = await resolveBranchForCashDrawer({
      userId: req.body?.userId,
      branchId: req.body?.branchId,
    });

    const note = String(req.body?.note || 'Prepaid payment to supplier').trim();
    const treasuryAudit = buildTreasurySplitsFromPayment(splits, feeAllocations);
    const cashDrawerAmount = cashAmountFromPaymentSplits(splits, feeAllocations);

    vendor.ledgerEntries = vendor.ledgerEntries || [];
    for (const s of splits) {
      const splitNote = `${note}${splits.length > 1 ? ` — ${s.method}` : ''}`;
      vendor.ledgerEntries.push({
        type: 'deposit',
        amount: s.amount,
        note: splitNote,
        createdAt: new Date(),
        createdByUserId: uid,
        ...buildCashDrawerLedgerFields({
          fromCashDrawer: isPhysicalCashMethod(s.method),
          branchId: isPhysicalCashMethod(s.method) ? branchId : undefined,
        }),
      });
    }
    await vendor.save();

    if (cashDrawerAmount > 0) {
      await recordVendorCashDrawerPayment({
        branchId: req.body?.branchId,
        userId: req.body?.userId,
        vendorId: vendor._id,
        amount: cashDrawerAmount,
        paymentType: 'deposit',
        note,
        paymentTreasurySplits: treasuryAudit,
      });
    }

    res.json({
      message: 'Deposit recorded',
      weOweSupplier: vendor.creditBalance,
      prepaidBalance: vendor.creditBalance,
      cashDrawerAmount,
      paymentTreasurySplits: treasuryAudit,
    });
  } catch (error) {
    console.error('Error adding vendor deposit:', error);
    res.status(500).json({ message: 'Server error while recording deposit' });
  }
};

/** POST receive prepaid deposit from supplier (they buy FROM us — cash enters drawer). */
export const addVendorReceivedDeposit = async (req, res) => {
  try {
    const vendor = await Vendor.findById(req.params.id);
    if (!vendor) {
      return res.status(404).json({ message: 'Vendor not found' });
    }

    const splitsRaw = req.body?.paymentSplits ?? req.body?.paymentMethodSplits;
    let splits = normalizePaymentSplitsRaw(splitsRaw);
    const feeAllocations = normalizePaymentFeeAllocations(req.body?.paymentFeeAllocations);

    if (!splits.length) {
      const amount = Number(req.body?.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ message: 'Valid amount is required' });
      }
      splits = [{ method: 'cash', amount: Math.round(amount * 100) / 100 }];
    }

    const applied = totalNetFromPaymentSplits(splits);
    if (applied <= 0) {
      return res.status(400).json({ message: 'Valid amount is required' });
    }

    vendor.buyerPrepaidBalance =
      Math.round(((Number(vendor.buyerPrepaidBalance) || 0) + applied) * 100) / 100;

    const uid = mongoose.Types.ObjectId.isValid(String(req.body?.userId || ''))
      ? new mongoose.Types.ObjectId(String(req.body.userId))
      : undefined;

    const branchId = await resolveBranchForCashDrawer({
      userId: req.body?.userId,
      branchId: req.body?.branchId,
    });

    const note = String(req.body?.note || 'Supplier prepaid deposit received').trim();
    const treasuryAudit = buildTreasurySplitsFromPayment(splits, feeAllocations);
    const cashDrawerAmount = cashAmountFromPaymentSplits(splits, feeAllocations);

    vendor.ledgerEntries = vendor.ledgerEntries || [];
    for (const s of splits) {
      const splitNote = `${note}${splits.length > 1 ? ` — ${s.method}` : ''}`;
      vendor.ledgerEntries.push({
        type: 'received_deposit',
        amount: s.amount,
        note: splitNote,
        createdAt: new Date(),
        createdByUserId: uid,
        ...buildCashDrawerInflowLedgerFields({
          fromCashDrawer: isPhysicalCashMethod(s.method),
          branchId: isPhysicalCashMethod(s.method) ? branchId : undefined,
        }),
      });
    }
    await vendor.save();

    if (cashDrawerAmount > 0) {
      await recordVendorCashDrawerReceipt({
        branchId: req.body?.branchId,
        userId: req.body?.userId,
        vendorId: vendor._id,
        amount: cashDrawerAmount,
        paymentType: 'received_deposit',
        note,
        paymentTreasurySplits: treasuryAudit,
      });
    }

    const purchasePayableBreakdown = await computePurchasePayableBreakdown(vendor._id);
    const prepaidBalance = Math.round((Number(vendor.creditBalance) || 0) * 100) / 100;
    const weOweSupplier = computeTotalCreditOwed(
      prepaidBalance,
      purchasePayableBreakdown.total,
      vendor.buyerPrepaidBalance
    );

    res.json({
      message: 'Received deposit recorded',
      buyerPrepaidBalance: vendor.buyerPrepaidBalance,
      weOweSupplier,
      cashDrawerAmount,
      paymentTreasurySplits: treasuryAudit,
    });
  } catch (error) {
    console.error('Error adding vendor received deposit:', error);
    res.status(500).json({ message: 'Server error while recording received deposit' });
  }
};

// 📌 Delete Vendor
export const deleteVendor = async (req, res) => {
  try {
    const vendor = await Vendor.findById(req.params.id);

    if (!vendor) {
      return res.status(404).json({ message: 'Vendor not found' });
    }

    await vendor.deleteOne();
    res.json({ message: 'Vendor deleted successfully' });
  } catch (error) {
    console.error('Error deleting vendor:', error);
    res.status(500).json({ message: 'Server error while deleting vendor' });
  }
};


