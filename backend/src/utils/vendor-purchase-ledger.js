import mongoose from 'mongoose';
import Vendor from '../DB/models/vendor.model.js';
import PurchasingRequest from '../DB/models/purchasingRequest.model.js';
import {
  buildCashDrawerLedgerFields,
  recordVendorCashDrawerPayment,
  resolveBranchForCashDrawer,
} from './vendor-cash-drawer.js';
import {
  cashAmountFromTreasurySplits,
  derivePurchaseTreasuryKey,
  derivePurchaseTreasuryLabel,
  normalizeTreasurySplitsInput,
} from './purchase-treasury-splits.js';
import {
  getEffectivePurchaseTreasuryMethodsFromDb,
  isDeferredPurchaseTreasury,
  treasuryKeyIsCashDrawer,
  treasuryMethodMap,
} from '../modules/settings_module/treasuryMethods.js';

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

/** Batch purchase payable totals keyed by vendorId string. */
export async function computePurchasePayablesByVendorIds(vendorIds) {
  const ids = (vendorIds || []).filter(Boolean);
  const map = new Map(ids.map((id) => [String(id), 0]));
  if (!ids.length) return map;

  const requests = await PurchasingRequest.find({
    supplier: { $in: ids },
    paymentStatus: { $in: ['Installments', 'Deferred'] },
  }).lean();

  for (const r of requests) {
    const key = String(r.supplier);
    let add = 0;
    if (r.paymentStatus === 'Installments') {
      add = unpaidInstallmentsTotal(r);
    } else if (r.paymentStatus === 'Deferred') {
      add = deferredPurchaseRemaining(r);
    }
    map.set(key, Math.round(((map.get(key) || 0) + add) * 100) / 100);
  }
  return map;
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

/** Record payment for one unpaid installment (treasury splits + optional cash drawer). */
export async function recordVendorInstallmentPaymentWithTreasury(
  request,
  installmentId,
  { userId, branchId, note, paymentTreasurySplits: splitsRaw } = {}
) {
  const supplierId = request?.supplier;
  if (!supplierId || !mongoose.Types.ObjectId.isValid(String(supplierId))) {
    throw new Error('Invalid supplier');
  }
  if (request.paymentStatus !== 'Installments') {
    throw new Error('Not an installment purchase');
  }
  if (!installmentId || !mongoose.Types.ObjectId.isValid(String(installmentId))) {
    throw new Error('Valid installmentId is required');
  }

  const installment = request.installments?.id
    ? request.installments.id(installmentId)
    : (request.installments || []).find((i) => String(i._id) === String(installmentId));

  if (!installment) {
    throw new Error('Installment not found');
  }
  if (installment.paid) {
    throw new Error('Installment already paid');
  }

  const instAmount = Math.round((Number(installment.amount) || 0) * 100) / 100;
  if (instAmount <= 0) {
    throw new Error('Invalid installment amount');
  }

  const treasuryMethods = await getEffectivePurchaseTreasuryMethodsFromDb();
  const tMap = treasuryMethodMap(treasuryMethods);

  const treasuryNorm = normalizeTreasurySplitsInput({
    purchaseTreasurySplits: splitsRaw,
    purchaseTreasuryKey: undefined,
    lineTotal: instAmount,
    treasuryMethods,
    tMap,
  });
  if (treasuryNorm.error) {
    throw new Error(treasuryNorm.error);
  }

  const splits = treasuryNorm.splits || [];
  if (splits.some((s) => isDeferredPurchaseTreasury(s.key))) {
    throw new Error('Deferred treasury cannot be used when paying an installment');
  }

  installment.paid = true;
  request.markModified('installments');
  await request.save();

  const vendor = await Vendor.findById(supplierId);
  if (!vendor) throw new Error('Vendor not found');

  const uid = mongoose.Types.ObjectId.isValid(String(userId || ''))
    ? new mongoose.Types.ObjectId(String(userId))
    : undefined;

  const resolvedBranch = await resolveBranchForCashDrawer({ userId, branchId });
  const cashDrawerAmount = cashAmountFromTreasurySplits(splits);
  const splitsNote = formatTreasurySplitsNote(splits);
  const due = installment.dueDate
    ? new Date(installment.dueDate).toLocaleDateString('ar-EG')
    : '';
  const baseNote =
    String(note || '').trim() ||
    (due
      ? `سداد قسط — استحقاق ${due}${splitsNote ? ` (${splitsNote})` : ''}`
      : splitsNote
        ? `سداد قسط (${splitsNote})`
        : 'سداد قسط');

  vendor.ledgerEntries = vendor.ledgerEntries || [];
  for (const s of splits) {
    const splitNote = `${baseNote}${splits.length > 1 ? ` — ${s.label || s.key}` : ''}`;
    vendor.ledgerEntries.push({
      type: 'purchase_installment_paid',
      amount: s.amount,
      purchasingRequestId: request._id,
      note: splitNote,
      createdAt: new Date(),
      createdByUserId: uid,
      ...buildCashDrawerLedgerFields({
        fromCashDrawer: treasuryKeyIsCashDrawer(s.key),
        branchId: treasuryKeyIsCashDrawer(s.key) ? resolvedBranch : undefined,
      }),
    });
  }
  await vendor.save();

  if (cashDrawerAmount > 0) {
    await recordVendorCashDrawerPayment({
      branchId,
      userId,
      vendorId: vendor._id,
      amount: cashDrawerAmount,
      paymentType: 'purchase_installment_paid',
      purchasingRequestId: request._id,
      note: baseNote,
      paymentTreasurySplits: splits,
    });
  }

  return {
    applied: instAmount,
    installmentId: String(installment._id),
    cashDrawerAmount,
    paymentTreasurySplits: splits,
    remainingInstallments: unpaidInstallmentsTotal(request),
  };
}

/** Log installment payment in vendor ledger (we paid supplier). */
export async function recordVendorInstallmentPayment(
  request,
  installment,
  { userId, branchId, fromCashDrawer = false } = {}
) {
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

  const resolvedBranch = fromCashDrawer
    ? await resolveBranchForCashDrawer({ userId, branchId })
    : null;

  const due = installment.dueDate
    ? new Date(installment.dueDate).toLocaleDateString('ar-EG')
    : '';
  const note = due ? `سداد قسط — استحقاق ${due}` : 'سداد قسط';

  vendor.ledgerEntries = vendor.ledgerEntries || [];
  vendor.ledgerEntries.push({
    type: 'purchase_installment_paid',
    amount,
    purchasingRequestId: request._id,
    note,
    createdAt: new Date(),
    createdByUserId: uid,
    ...buildCashDrawerLedgerFields({ fromCashDrawer, branchId: resolvedBranch }),
  });
  await vendor.save();

  if (fromCashDrawer) {
    await recordVendorCashDrawerPayment({
      branchId,
      userId,
      vendorId: vendor._id,
      amount,
      paymentType: 'purchase_installment_paid',
      purchasingRequestId: request._id,
      note,
    });
  }
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
    ...buildCashDrawerLedgerFields({ fromCashDrawer: false }),
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
      fromCashDrawer: false,
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

function formatTreasurySplitsNote(splits) {
  return (splits || [])
    .map((s) => `${s.label || s.key}: ${s.amount}`)
    .join(' · ');
}

/** Record our payment to supplier on a deferred purchase. */
export async function recordVendorDeferredPayment(
  request,
  payAmount,
  { userId, branchId, note, paymentTreasurySplits: splitsRaw } = {}
) {
  const supplierId = request?.supplier;
  if (!supplierId || !mongoose.Types.ObjectId.isValid(String(supplierId))) {
    throw new Error('Invalid supplier');
  }
  if (request.paymentStatus !== 'Deferred') {
    throw new Error('Not a deferred purchase');
  }

  const remaining = deferredPurchaseRemaining(request);
  if (remaining <= 0) {
    throw new Error('Nothing remaining to pay');
  }

  const treasuryMethods = await getEffectivePurchaseTreasuryMethodsFromDb();
  const tMap = treasuryMethodMap(treasuryMethods);

  let splits = [];
  let lineTotal = Math.round(Number(payAmount) * 100) / 100;
  if (Array.isArray(splitsRaw) && splitsRaw.length) {
    lineTotal = Math.round(
      splitsRaw.reduce((acc, row) => acc + (Number(row?.amount) || 0), 0) * 100
    ) / 100;
  }

  if (!Number.isFinite(lineTotal) || lineTotal <= 0) {
    throw new Error('Valid payment amount is required');
  }
  if (lineTotal > remaining + 0.01) {
    throw new Error('Payment exceeds remaining balance');
  }

  const treasuryNorm = normalizeTreasurySplitsInput({
    purchaseTreasurySplits: splitsRaw,
    purchaseTreasuryKey: undefined,
    lineTotal,
    treasuryMethods,
    tMap,
  });
  if (treasuryNorm.error) {
    throw new Error(treasuryNorm.error);
  }

  splits = treasuryNorm.splits;
  const applied = lineTotal;
  const cashDrawerAmount = cashAmountFromTreasurySplits(splits);
  const treasuryKey = derivePurchaseTreasuryKey(splits);
  const treasuryLabel = derivePurchaseTreasuryLabel(splits, tMap);

  request.amountPaid = Math.round(((Number(request.amountPaid) || 0) + applied) * 100) / 100;
  const uid = mongoose.Types.ObjectId.isValid(String(userId || ''))
    ? new mongoose.Types.ObjectId(String(userId))
    : undefined;

  request.deferredPayments = request.deferredPayments || [];
  request.deferredPayments.push({
    amount: applied,
    paidAt: new Date(),
    recordedBy: uid,
    paymentTreasuryKey: treasuryKey,
    paymentTreasuryLabel: treasuryLabel,
    paymentTreasurySplits: splits,
    note: String(note || '').trim(),
  });

  await request.save();

  const vendor = await Vendor.findById(supplierId);
  if (!vendor) throw new Error('Vendor not found');

  const resolvedBranch = await resolveBranchForCashDrawer({ userId, branchId });
  const splitsNote = formatTreasurySplitsNote(splits);
  const payNote =
    String(note || '').trim() ||
    (splitsNote ? `سداد للمورد — شراء بالآجل (${splitsNote})` : 'سداد للمورد — شراء بالآجل');

  vendor.ledgerEntries = vendor.ledgerEntries || [];
  for (const s of splits) {
    const splitNote = `${payNote}${splits.length > 1 ? ` — ${s.label || s.key}` : ''}`;
    vendor.ledgerEntries.push({
      type: 'purchase_deferred_paid',
      amount: s.amount,
      purchasingRequestId: request._id,
      note: splitNote,
      createdAt: new Date(),
      createdByUserId: uid,
      ...buildCashDrawerLedgerFields({
        fromCashDrawer: treasuryKeyIsCashDrawer(s.key),
        branchId: treasuryKeyIsCashDrawer(s.key) ? resolvedBranch : undefined,
      }),
    });
  }
  await vendor.save();

  if (cashDrawerAmount > 0) {
    await recordVendorCashDrawerPayment({
      branchId,
      userId,
      vendorId: vendor._id,
      amount: cashDrawerAmount,
      paymentType: 'purchase_deferred_paid',
      purchasingRequestId: request._id,
      note: payNote,
      paymentTreasurySplits: splits,
    });
  }

  return {
    applied,
    cashDrawerAmount,
    amountPaid: request.amountPaid,
    remaining: deferredPurchaseRemaining(request),
    paymentTreasurySplits: splits,
  };
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

/** Take treasury lines from a pool until `target` amount is allocated. */
function takeTreasurySplitsFromPool(pool, target) {
  let need = Math.round(Number(target) * 100) / 100;
  const taken = [];
  if (need <= 0) return { taken, pool };

  const nextPool = pool.map((row) => ({ ...row, amount: round2(row.amount) }));

  for (const row of nextPool) {
    if (need <= 0) break;
    if (row.amount <= 0) continue;
    const slice = Math.min(need, row.amount);
    if (slice > 0) {
      taken.push({ key: row.key, label: row.label, amount: slice });
      row.amount = round2(row.amount - slice);
      need = round2(need - slice);
    }
  }

  return { taken, pool: nextPool.filter((r) => r.amount > 0) };
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * Pay supplier from purchase treasuries: reduces purchase payables then prepaid (creditBalance).
 */
export async function payVendorSupplierWithTreasury(
  vendor,
  { userId, branchId, note, paymentTreasurySplits: splitsRaw } = {}
) {
  if (!vendor?._id) {
    throw new Error('Vendor not found');
  }

  const treasuryMethods = await getEffectivePurchaseTreasuryMethodsFromDb();
  const tMap = treasuryMethodMap(treasuryMethods);

  const lineTotal = round2(
    (splitsRaw || []).reduce((acc, row) => acc + (Number(row?.amount) || 0), 0)
  );
  if (lineTotal <= 0) {
    throw new Error('Valid payment amount is required');
  }

  const treasuryNorm = normalizeTreasurySplitsInput({
    purchaseTreasurySplits: splitsRaw,
    purchaseTreasuryKey: undefined,
    lineTotal,
    treasuryMethods,
    tMap,
  });
  if (treasuryNorm.error) {
    throw new Error(treasuryNorm.error);
  }

  const splits = treasuryNorm.splits || [];
  if (splits.some((s) => isDeferredPurchaseTreasury(s.key))) {
    throw new Error('Deferred treasury cannot be used when paying the supplier');
  }

  const payableBreakdown = await computePurchasePayableBreakdown(vendor._id);
  const prepaidBefore = round2(vendor.creditBalance);
  const maxPay = round2(payableBreakdown.total + prepaidBefore);
  if (lineTotal > maxPay + 0.01) {
    throw new Error('Payment exceeds supplier credit balance');
  }

  let splitPool = splits.map((s) => ({ ...s }));
  let budget = lineTotal;
  let appliedToPurchases = 0;
  let appliedToPrepaid = 0;

  const requests = await PurchasingRequest.find({
    supplier: vendor._id,
    paymentStatus: { $in: ['Deferred', 'Installments'] },
  }).sort({ requestDate: 1 });

  for (const req of requests) {
    if (budget <= 0) break;

    if (req.paymentStatus === 'Deferred') {
      const due = deferredPurchaseRemaining(req);
      if (due <= 0) continue;
      const chunk = Math.min(budget, due);
      const { taken, pool } = takeTreasurySplitsFromPool(splitPool, chunk);
      if (!taken.length) break;
      await recordVendorDeferredPayment(req, chunk, {
        userId,
        branchId,
        note: String(note || '').trim() || 'سداد للمورد',
        paymentTreasurySplits: taken,
      });
      splitPool = pool;
      budget = round2(budget - chunk);
      appliedToPurchases = round2(appliedToPurchases + chunk);
      continue;
    }

    if (req.paymentStatus === 'Installments') {
      let reqDoc = await PurchasingRequest.findById(req._id);
      for (const inst of reqDoc?.installments || []) {
        if (budget <= 0) break;
        if (inst.paid) continue;
        const instAmount = round2(inst.amount);
        if (instAmount <= 0 || instAmount > budget + 0.001) continue;

        const { taken, pool } = takeTreasurySplitsFromPool(splitPool, instAmount);
        if (!taken.length) break;

        await recordVendorInstallmentPaymentWithTreasury(reqDoc, inst._id, {
          userId,
          branchId,
          note: String(note || '').trim() || 'سداد للمورد',
          paymentTreasurySplits: taken,
        });
        splitPool = pool;
        budget = round2(budget - instAmount);
        appliedToPurchases = round2(appliedToPurchases + instAmount);
        reqDoc = await PurchasingRequest.findById(req._id);
      }
    }
  }

  if (budget > 0 && prepaidBefore > 0) {
    const chunk = Math.min(budget, prepaidBefore);
    const { taken, pool } = takeTreasurySplitsFromPool(splitPool, chunk);
    if (taken.length) {
      const vendorDoc = await Vendor.findById(vendor._id);
      if (!vendorDoc) throw new Error('Vendor not found');

      const uid = mongoose.Types.ObjectId.isValid(String(userId || ''))
        ? new mongoose.Types.ObjectId(String(userId))
        : undefined;
      const resolvedBranch = await resolveBranchForCashDrawer({ userId, branchId });
      const cashDrawerAmount = cashAmountFromTreasurySplits(taken);
      const splitsNote = formatTreasurySplitsNote(taken);
      const payNote =
        String(note || '').trim() ||
        (splitsNote ? `سداد للمورد — رصيد مسبق (${splitsNote})` : 'سداد للمورد — رصيد مسبق');

      vendorDoc.creditBalance = round2((Number(vendorDoc.creditBalance) || 0) - chunk);
      vendorDoc.ledgerEntries = vendorDoc.ledgerEntries || [];
      for (const s of taken) {
        const splitNote = `${payNote}${taken.length > 1 ? ` — ${s.label || s.key}` : ''}`;
        vendorDoc.ledgerEntries.push({
          type: 'purchase_deferred_paid',
          amount: s.amount,
          note: splitNote,
          createdAt: new Date(),
          createdByUserId: uid,
          ...buildCashDrawerLedgerFields({
            fromCashDrawer: treasuryKeyIsCashDrawer(s.key),
            branchId: treasuryKeyIsCashDrawer(s.key) ? resolvedBranch : undefined,
          }),
        });
      }
      await vendorDoc.save();

      if (cashDrawerAmount > 0) {
        await recordVendorCashDrawerPayment({
          branchId,
          userId,
          vendorId: vendorDoc._id,
          amount: cashDrawerAmount,
          paymentType: 'purchase_deferred_paid',
          note: payNote,
          paymentTreasurySplits: taken,
        });
      }

      appliedToPrepaid = chunk;
      budget = round2(budget - chunk);
      splitPool = pool;
    }
  }

  if (budget > 0.01) {
    throw new Error('Could not apply full payment amount');
  }

  const purchasePayableBreakdown = await computePurchasePayableBreakdown(vendor._id);
  const vendorFresh = await Vendor.findById(vendor._id).lean();

  return {
    applied: lineTotal,
    appliedToPurchases,
    appliedToPrepaid,
    cashDrawerAmount: cashAmountFromTreasurySplits(splits),
    paymentTreasurySplits: splits,
    purchasePayable: purchasePayableBreakdown.total,
    purchasePayableInstallments: purchasePayableBreakdown.installments,
    purchasePayableDeferred: purchasePayableBreakdown.deferred,
    prepaidBalance: round2(vendorFresh?.creditBalance),
  };
}

export { unpaidInstallmentsTotal };
