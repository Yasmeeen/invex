import mongoose from 'mongoose';
import Client from '../DB/models/client.model.js';
import ClientCashDrawerReceipt from '../DB/models/clientCashDrawerReceipt.model.js';
import { resolveBranchForCashDrawer } from './vendor-cash-drawer.js';

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

export const CLIENT_CASH_DRAWER_LEDGER_TYPES = ['deposit'];

export function ledgerEntryAffectsCashDrawer(entry) {
  if (!entry || entry.affectsCashDrawer === false) return false;
  if (entry.affectsCashDrawer === true) return true;
  return CLIENT_CASH_DRAWER_LEDGER_TYPES.includes(String(entry.type || ''));
}

export function buildCashDrawerLedgerFields({ fromCashDrawer, branchId }) {
  const fields = { affectsCashDrawer: Boolean(fromCashDrawer) };
  if (fromCashDrawer && branchId && mongoose.Types.ObjectId.isValid(String(branchId))) {
    fields.branch = new mongoose.Types.ObjectId(String(branchId));
  }
  return fields;
}

export async function recordClientCashDrawerReceipt({
  branchId,
  userId,
  clientId,
  amount,
  paymentType = 'deposit',
  note,
  paymentTreasurySplits,
}) {
  const resolvedBranch = await resolveBranchForCashDrawer({ userId, branchId });
  if (!resolvedBranch) {
    console.warn('⚠️ Client cash drawer receipt skipped: no branch resolved', {
      clientId: String(clientId),
      paymentType,
    });
    return null;
  }

  const amt = round2(amount);
  if (amt <= 0) return null;

  const uid = mongoose.Types.ObjectId.isValid(String(userId || ''))
    ? new mongoose.Types.ObjectId(String(userId))
    : undefined;

  await ClientCashDrawerReceipt.create({
    branch: resolvedBranch,
    client: clientId,
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
  const [agg] = await ClientCashDrawerReceipt.aggregate([
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
  const receiptColl = ClientCashDrawerReceipt.collection.name;

  const [agg] = await Client.aggregate([
    { $unwind: '$ledgerEntries' },
    {
      $match: {
        'ledgerEntries.createdAt': { $gte: start, $lte: end },
        'ledgerEntries.type': { $in: CLIENT_CASH_DRAWER_LEDGER_TYPES },
        'ledgerEntries.affectsCashDrawer': { $ne: false },
        'ledgerEntries.branch': branchOid,
      },
    },
    {
      $lookup: {
        from: receiptColl,
        let: {
          cId: '$_id',
          amt: '$ledgerEntries.amount',
          pType: '$ledgerEntries.type',
        },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$client', '$$cId'] },
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

/** Sum client deposit cash received for a branch business day. */
export async function sumClientCashDrawerInflows(branchOid, start, end) {
  const fromReceipts = await sumFromCashDrawerReceipts(branchOid, start, end);
  const fromLedger = await sumLegacyLedgerCashInflows(branchOid, start, end);

  return {
    clientDepositCashDrawerTotal: round2(fromReceipts.total + fromLedger.total),
    clientDepositCashDrawerCount: fromReceipts.count + fromLedger.count,
  };
}
