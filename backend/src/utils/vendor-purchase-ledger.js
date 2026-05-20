import mongoose from 'mongoose';
import Vendor from '../DB/models/vendor.model.js';
import PurchasingRequest from '../DB/models/purchasingRequest.model.js';

function unpaidInstallmentsTotal(request) {
  if (!request || request.paymentStatus !== 'Installments') return 0;
  const installments = request.installments || [];
  let sum = 0;
  for (const inst of installments) {
    if (!inst.paid) {
      sum += Number(inst.amount) || 0;
    }
  }
  return Math.round(sum * 100) / 100;
}

/** Unpaid amount on a deferred purchase (we owe the supplier). */
export function deferredPurchaseRemaining(request) {
  if (!request || request.paymentStatus !== 'Deferred') return 0;
  const total = Number(request.totalAmount) || 0;
  const paid = Number(request.amountPaid) || 0;
  return Math.max(0, Math.round((total - paid) * 100) / 100);
}

export async function computePurchasePayableBreakdown(vendorId) {
  const requests = await PurchasingRequest.find({
    supplier: vendorId,
    paymentStatus: { $in: ['Installments', 'Deferred'] },
  }).lean();

  let installments = 0;
  let deferred = 0;
  for (const r of requests) {
    if (r.paymentStatus === 'Installments') {
      installments += unpaidInstallmentsTotal(r);
    } else if (r.paymentStatus === 'Deferred') {
      deferred += deferredPurchaseRemaining(r);
    }
  }
  installments = Math.round(installments * 100) / 100;
  deferred = Math.round(deferred * 100) / 100;
  return {
    installments,
    deferred,
    total: Math.round((installments + deferred) * 100) / 100,
  };
}

/** Sum of unpaid installment + deferred purchase amounts (we owe supplier). */
export async function computePurchasePayable(vendorId) {
  const { total } = await computePurchasePayableBreakdown(vendorId);
  return total;
}

function purchaseLedgerNote(request) {
  const date = request.requestDate
    ? new Date(request.requestDate).toLocaleDateString('ar-EG')
    : '';
  const by = request.requestedBy ? ` — ${request.requestedBy}` : '';
  return `طلب شراء${date ? ` ${date}` : ''}${by}`.trim();
}

function deferredLedgerNote(request) {
  const date = request.requestDate
    ? new Date(request.requestDate).toLocaleDateString('ar-EG')
    : '';
  const by = request.requestedBy ? ` — ${request.requestedBy}` : '';
  return `شراء بالآجل — مستحق علينا${date ? ` ${date}` : ''}${by}`.trim();
}

function stripPurchaseLedgerForRequest(entries, requestId) {
  const rid = String(requestId);
  return (entries || []).filter(
    (e) =>
      !(
        ['purchase', 'purchase_deferred'].includes(e.type) &&
        String(e.purchasingRequestId || '') === rid
      )
  );
}

/**
 * Sync vendor ledger for Installments or Deferred purchases (both: we owe supplier).
 */
export async function syncVendorPurchaseLedger(request, { userId } = {}) {
  const supplierId = request?.supplier;
  if (!supplierId || !mongoose.Types.ObjectId.isValid(String(supplierId))) {
    return;
  }

  const vendor = await Vendor.findById(supplierId);
  if (!vendor) return;

  const rid = String(request._id);
  let rest = stripPurchaseLedgerForRequest(vendor.ledgerEntries, rid);

  const uid = mongoose.Types.ObjectId.isValid(String(userId || ''))
    ? new mongoose.Types.ObjectId(String(userId))
    : undefined;

  if (request.paymentStatus === 'Installments') {
    const amount = Number(request.totalAmount) || 0;
    if (amount > 0) {
      rest.push({
        type: 'purchase',
        amount,
        purchasingRequestId: request._id,
        note: purchaseLedgerNote(request),
        createdAt: request.requestDate || request.createdAt || new Date(),
        createdByUserId: uid,
      });
    }
  } else if (request.paymentStatus === 'Deferred') {
    const amount = Number(request.totalAmount) || 0;
    if (amount > 0) {
      rest.push({
        type: 'purchase_deferred',
        amount,
        purchasingRequestId: request._id,
        note: deferredLedgerNote(request),
        createdAt: request.requestDate || request.createdAt || new Date(),
        createdByUserId: uid,
      });
    }
  }

  vendor.ledgerEntries = rest;
  await vendor.save();
}

/** Log installment payment in vendor ledger (we paid supplier). */
export async function recordVendorInstallmentPayment(request, installment, { userId } = {}) {
  const supplierId = request?.supplier;
  if (!supplierId || !mongoose.Types.ObjectId.isValid(String(supplierId))) {
    return;
  }

  const vendor = await Vendor.findById(supplierId);
  if (!vendor) return;

  const amount = Number(installment?.amount) || 0;
  if (amount <= 0) return;

  const uid = mongoose.Types.ObjectId.isValid(String(userId || ''))
    ? new mongoose.Types.ObjectId(String(userId))
    : undefined;

  const due = installment.dueDate
    ? new Date(installment.dueDate).toLocaleDateString('ar-EG')
    : '';

  vendor.ledgerEntries = vendor.ledgerEntries || [];
  vendor.ledgerEntries.push({
    type: 'purchase_installment_paid',
    amount,
    purchasingRequestId: request._id,
    note: due ? `سداد قسط — استحقاق ${due}` : 'سداد قسط',
    createdAt: new Date(),
    createdByUserId: uid,
  });
  await vendor.save();
}

/** Apply settlement credit against deferred purchase (netting — no cash). */
export async function applyDeferredSettlementCredit(request, payAmount, { userId, note } = {}) {
  const remaining = deferredPurchaseRemaining(request);
  const applied = Math.min(Math.round(Number(payAmount) * 100) / 100, remaining);
  if (applied <= 0) return 0;

  request.amountPaid = Math.round(((Number(request.amountPaid) || 0) + applied) * 100) / 100;
  await request.save();

  const supplierId = request?.supplier;
  if (!supplierId || !mongoose.Types.ObjectId.isValid(String(supplierId))) {
    return applied;
  }

  const vendor = await Vendor.findById(supplierId);
  if (!vendor) return applied;

  const uid = mongoose.Types.ObjectId.isValid(String(userId || ''))
    ? new mongoose.Types.ObjectId(String(userId))
    : undefined;

  vendor.ledgerEntries = vendor.ledgerEntries || [];
  vendor.ledgerEntries.push({
    type: 'purchase_deferred_paid',
    amount: applied,
    purchasingRequestId: request._id,
    note: String(note || '').trim() || 'مقاصة — شراء بالآجل',
    createdAt: new Date(),
    createdByUserId: uid,
  });
  await vendor.save();

  return applied;
}

/** Apply settlement credit against unpaid installments on a request. */
export async function applyInstallmentSettlementCredit(request, payAmount, { userId, note } = {}) {
  if (!request || request.paymentStatus !== 'Installments') return 0;

  let budget = Math.round(Number(payAmount) * 100) / 100;
  if (budget <= 0) return 0;

  const installments = request.installments || [];
  let applied = 0;

  for (const inst of installments) {
    if (budget <= 0) break;
    if (inst.paid) continue;
    const instAmount = Math.round((Number(inst.amount) || 0) * 100) / 100;
    if (instAmount <= 0 || instAmount > budget + 0.001) continue;

    inst.paid = true;
    budget = Math.round((budget - instAmount) * 100) / 100;
    applied = Math.round((applied + instAmount) * 100) / 100;
    await recordVendorInstallmentPayment(request, inst, {
      userId,
      note: String(note || '').trim() || 'مقاصة — سداد قسط',
    });
  }

  if (applied > 0) {
    request.markModified('installments');
    await request.save();
  }

  return applied;
}

/** Reduce purchase payables (deferred + installments) via settlement netting. */
export async function applyPurchasePayableSettlement(vendorId, amount, { userId, note } = {}) {
  let remaining = Math.round(Number(amount) * 100) / 100;
  if (remaining <= 0) return 0;

  const requests = await PurchasingRequest.find({
    supplier: vendorId,
    paymentStatus: { $in: ['Deferred', 'Installments'] },
  }).sort({ requestDate: 1 });

  let totalApplied = 0;
  const settlementNote = String(note || 'Balance settlement (netting)').trim();

  for (const req of requests) {
    if (remaining <= 0) break;

    if (req.paymentStatus === 'Deferred') {
      const applied = await applyDeferredSettlementCredit(req, remaining, {
        userId,
        note: settlementNote,
      });
      remaining = Math.round((remaining - applied) * 100) / 100;
      totalApplied = Math.round((totalApplied + applied) * 100) / 100;
    } else if (req.paymentStatus === 'Installments') {
      const applied = await applyInstallmentSettlementCredit(req, remaining, {
        userId,
        note: settlementNote,
      });
      remaining = Math.round((remaining - applied) * 100) / 100;
      totalApplied = Math.round((totalApplied + applied) * 100) / 100;
    }
  }

  return totalApplied;
}

/** Record our payment to supplier on a deferred purchase. */
export async function recordVendorDeferredPayment(
  request,
  payAmount,
  { userId, note } = {}
) {
  const supplierId = request?.supplier;
  if (!supplierId || !mongoose.Types.ObjectId.isValid(String(supplierId))) {
    throw new Error('Invalid supplier');
  }
  if (request.paymentStatus !== 'Deferred') {
    throw new Error('Not a deferred purchase');
  }

  const remaining = deferredPurchaseRemaining(request);
  const applied = Math.min(Math.round(Number(payAmount) * 100) / 100, remaining);
  if (applied <= 0) {
    throw new Error('Nothing remaining to pay');
  }

  request.amountPaid = Math.round(((Number(request.amountPaid) || 0) + applied) * 100) / 100;
  await request.save();

  const vendor = await Vendor.findById(supplierId);
  if (!vendor) throw new Error('Vendor not found');

  const uid = mongoose.Types.ObjectId.isValid(String(userId || ''))
    ? new mongoose.Types.ObjectId(String(userId))
    : undefined;

  vendor.ledgerEntries = vendor.ledgerEntries || [];
  vendor.ledgerEntries.push({
    type: 'purchase_deferred_paid',
    amount: applied,
    purchasingRequestId: request._id,
    note: String(note || '').trim() || 'سداد للمورد — شراء بالآجل',
    createdAt: new Date(),
    createdByUserId: uid,
  });
  await vendor.save();

  return { applied, amountPaid: request.amountPaid, remaining: deferredPurchaseRemaining(request) };
}

/** Remove all ledger rows linked to a deleted purchasing request. */
export async function removeVendorPurchaseLedger(purchasingRequestId, supplierId) {
  if (!supplierId || !mongoose.Types.ObjectId.isValid(String(supplierId))) {
    return;
  }
  const vendor = await Vendor.findById(supplierId);
  if (!vendor) return;

  const rid = String(purchasingRequestId);
  vendor.ledgerEntries = (vendor.ledgerEntries || []).filter(
    (e) => String(e.purchasingRequestId || '') !== rid
  );
  await vendor.save();
}

export { unpaidInstallmentsTotal };
