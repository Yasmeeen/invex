import mongoose from 'mongoose';
import Vendor from '../DB/models/vendor.model.js';
import VendorCashDrawerReceipt from '../DB/models/vendorCashDrawerReceipt.model.js';
import {
  drawerDocCreatedNearLedgerEntry,
  resolveBranchForCashDrawer,
} from './vendor-cash-drawer.js';

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

export const VENDOR_CASH_DRAWER_INFLOW_LEDGER_TYPES = [
  'received_deposit',
  'opening_debit_payment',
];

export function ledgerEntryAffectsCashDrawerInflow(entry) {
  if (!entry || entry.affectsCashDrawer === false) return false;
  if (entry.affectsCashDrawer === true) return true;
  return VENDOR_CASH_DRAWER_INFLOW_LEDGER_TYPES.includes(String(entry.type || ''));
}

export function buildCashDrawerInflowLedgerFields({ fromCashDrawer, branchId }) {
  const fields = { affectsCashDrawer: Boolean(fromCashDrawer) };
  if (fromCashDrawer && branchId && mongoose.Types.ObjectId.isValid(String(branchId))) {
    fields.branch = new mongoose.Types.ObjectId(String(branchId));
  }
  return fields;
}

export async function recordVendorCashDrawerReceipt({
  branchId,
  userId,
  vendorId,
  amount,
  paymentType = 'received_deposit',
  note,
  paymentTreasurySplits,
}) {
  const resolvedBranch = await resolveBranchForCashDrawer({ userId, branchId });
  if (!resolvedBranch) {
    console.warn('⚠️ Vendor cash drawer receipt skipped: no branch resolved', {
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

  await VendorCashDrawerReceipt.create({
    branch: resolvedBranch,
    vendor: vendorId,
    amount: amt,
    paymentType,
    note: String(note || '').trim().slice(0, 500),
    ...(Array.isArray(paymentTreasurySplits) && paymentTreasurySplits.length
      ? { paymentTreasurySplits }
      : {}),
    recordedBy: uid,
  });

  return resolvedBranch;
}

async function sumFromCashDrawerReceipts(branchOid, start, end) {
  const [agg] = await VendorCashDrawerReceipt.aggregate([
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

async function sumLegacyLedgerCashInflows(branchOid, start, end) {
  const receiptColl = VendorCashDrawerReceipt.collection.name;

  const [agg] = await Vendor.aggregate([
    { $unwind: '$ledgerEntries' },
    {
      $match: {
        'ledgerEntries.createdAt': { $gte: start, $lte: end },
        'ledgerEntries.type': { $in: VENDOR_CASH_DRAWER_INFLOW_LEDGER_TYPES },
        'ledgerEntries.affectsCashDrawer': { $ne: false },
        'ledgerEntries.branch': branchOid,
      },
    },
    {
      $lookup: {
        from: receiptColl,
        let: {
          vId: '$_id',
          pType: '$ledgerEntries.type',
          at: '$ledgerEntries.createdAt',
        },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$vendor', '$$vId'] },
                  { $eq: ['$paymentType', '$$pType'] },
                  { $eq: ['$branch', branchOid] },
                  ...drawerDocCreatedNearLedgerEntry('$$at'),
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

/** Sum supplier cash received for a branch business day. */
export async function sumVendorCashDrawerInflows(branchOid, start, end) {
  const fromReceipts = await sumFromCashDrawerReceipts(branchOid, start, end);
  const fromLedger = await sumLegacyLedgerCashInflows(branchOid, start, end);

  return {
    vendorCashDrawerInflowTotal: round2(fromReceipts.total + fromLedger.total),
    vendorCashDrawerInflowCount: fromReceipts.count + fromLedger.count,
  };
}
