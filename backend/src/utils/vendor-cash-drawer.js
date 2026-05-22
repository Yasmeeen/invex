import mongoose from 'mongoose';
import User from '../DB/models/user.model.js';
import Branch from '../DB/models/branch.model.js';
import Vendor from '../DB/models/vendor.model.js';
import VendorCashDrawerPayment from '../DB/models/vendorCashDrawerPayment.model.js';

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

/** Ledger types that leave the physical cash drawer when paid in cash. */
export const VENDOR_CASH_DRAWER_LEDGER_TYPES = [
  'deposit',
  'purchase_deferred_paid',
  'purchase_installment_paid',
];

export function ledgerEntryAffectsCashDrawer(entry) {
  if (!entry || entry.affectsCashDrawer === false) return false;
  if (entry.affectsCashDrawer === true) return true;
  return VENDOR_CASH_DRAWER_LEDGER_TYPES.includes(String(entry.type || ''));
}

/** Resolve branch from the acting user (cashier / manager). */
export async function resolveBranchFromUserId(userId) {
  if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) {
    return null;
  }
  const user = await User.findById(userId).select('branch').lean();
  const b = user?.branch;
  if (!b) return null;
  if (mongoose.Types.ObjectId.isValid(String(b))) {
    return new mongoose.Types.ObjectId(String(b));
  }
  return null;
}

/** Prefer explicit branchId from client; else user branch; else only branch in DB. */
export async function resolveBranchForCashDrawer({ userId, branchId: branchIdRaw } = {}) {
  const explicit = String(branchIdRaw || '').trim();
  if (explicit && mongoose.Types.ObjectId.isValid(explicit)) {
    return new mongoose.Types.ObjectId(explicit);
  }

  const fromUser = await resolveBranchFromUserId(userId);
  if (fromUser) return fromUser;

  const branchCount = await Branch.countDocuments();
  if (branchCount === 1) {
    const only = await Branch.findOne().select('_id').lean();
    return only?._id ? new mongoose.Types.ObjectId(String(only._id)) : null;
  }

  return null;
}

export function buildCashDrawerLedgerFields({ fromCashDrawer, branchId }) {
  const fields = { affectsCashDrawer: Boolean(fromCashDrawer) };
  if (fromCashDrawer && branchId && mongoose.Types.ObjectId.isValid(String(branchId))) {
    fields.branch = new mongoose.Types.ObjectId(String(branchId));
  }
  return fields;
}

/**
 * Persist drawer outflow (used by drawer close). Returns resolved branch id or null.
 */
export async function recordVendorCashDrawerPayment({
  branchId,
  userId,
  vendorId,
  amount,
  paymentType,
  purchasingRequestId,
  note,
  paymentTreasurySplits,
}) {
  const resolvedBranch = await resolveBranchForCashDrawer({ userId, branchId });
  if (!resolvedBranch) {
    console.warn('⚠️ Vendor cash drawer payment skipped: no branch resolved', {
      vendorId: String(vendorId),
      paymentType,
    });
    return null;
  }

  const amt = round2(amount);
  if (amt <= 0) return null;

  const uid = mongoose.Types.ObjectId.isValid(String(userId || ''))
    ? new mongoose.Types.ObjectId(String(userId))
    : undefined;

  const prId =
    purchasingRequestId && mongoose.Types.ObjectId.isValid(String(purchasingRequestId))
      ? new mongoose.Types.ObjectId(String(purchasingRequestId))
      : undefined;

  await VendorCashDrawerPayment.create({
    branch: resolvedBranch,
    vendor: vendorId,
    amount: amt,
    paymentType,
    purchasingRequestId: prId,
    note: String(note || '').trim().slice(0, 500),
    ...(Array.isArray(paymentTreasurySplits) && paymentTreasurySplits.length
      ? { paymentTreasurySplits }
      : {}),
    recordedBy: uid,
  });

  return resolvedBranch;
}

async function sumFromCashDrawerPayments(branchOid, start, end) {
  const [agg] = await VendorCashDrawerPayment.aggregate([
    {
      $match: {
        branch: branchOid,
        createdAt: { $gte: start, $lte: end },
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: '$amount' },
        count: { $sum: 1 },
      },
    },
  ]);

  return {
    total: round2(agg?.total || 0),
    count: Number(agg?.count || 0),
  };
}

/** Ledger rows not mirrored in VendorCashDrawerPayment (legacy / missing branch). */
async function sumLegacyLedgerCashOutflows(branchOid, start, end) {
  const branchCount = await Branch.countDocuments();
  const orphanBranchFilter =
    branchCount <= 1
      ? [{ 'ledgerEntries.branch': { $exists: false } }, { 'ledgerEntries.branch': null }]
      : [];

  const paymentColl = VendorCashDrawerPayment.collection.name;

  const [agg] = await Vendor.aggregate([
    { $unwind: '$ledgerEntries' },
    {
      $match: {
        'ledgerEntries.createdAt': { $gte: start, $lte: end },
        'ledgerEntries.type': { $in: VENDOR_CASH_DRAWER_LEDGER_TYPES },
        'ledgerEntries.affectsCashDrawer': { $ne: false },
        $or: [{ 'ledgerEntries.branch': branchOid }, ...orphanBranchFilter],
      },
    },
    {
      $lookup: {
        from: paymentColl,
        let: {
          vId: '$_id',
          amt: '$ledgerEntries.amount',
          pType: '$ledgerEntries.type',
        },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$vendor', '$$vId'] },
                  { $eq: ['$amount', '$$amt'] },
                  { $eq: ['$paymentType', '$$pType'] },
                  { $eq: ['$branch', branchOid] },
                ],
              },
            },
          },
          { $limit: 1 },
        ],
        as: 'dup',
      },
    },
    { $match: { dup: { $size: 0 } } },
    {
      $group: {
        _id: null,
        total: { $sum: '$ledgerEntries.amount' },
        count: { $sum: 1 },
      },
    },
  ]);

  return {
    total: round2(agg?.total || 0),
    count: Number(agg?.count || 0),
  };
}

/** Sum supplier cash payments for a branch business day. */
export async function sumVendorCashDrawerOutflows(branchOid, start, end) {
  const fromPayments = await sumFromCashDrawerPayments(branchOid, start, end);
  const fromLedger = await sumLegacyLedgerCashOutflows(branchOid, start, end);

  return {
    vendorCashDrawerTotal: round2(fromPayments.total + fromLedger.total),
    vendorCashDrawerPaymentCount: fromPayments.count + fromLedger.count,
  };
}
