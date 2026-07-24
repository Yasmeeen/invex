import mongoose from 'mongoose';
import Client from '../DB/models/client.model.js';
import ProductPurchaseRequest from '../DB/models/productPurchaseRequest.model.js';
import DailyExpense from '../DB/models/dailyExpense.model.js';
import { buildPhoneSearchCandidates } from './phone-utils.js';
import {
  cashAmountFromTreasurySplits,
  derivePurchaseTreasuryKey,
  derivePurchaseTreasuryLabel,
} from './purchase-treasury-splits.js';
import {
  getEffectivePurchaseTreasuryMethodsFromDb,
  isDeferredPurchaseTreasury,
  treasuryKeyIsCashDrawer,
  treasuryMethodMap,
} from '../modules/settings_module/treasuryMethods.js';
import { normalizeTreasurySplitsInput } from './purchase-treasury-splits.js';
import {
  deferredDeskPurchaseRemaining,
  recordDeskPurchaseDeferredPayment,
} from './desk-purchase-deferred.js';
import { resolveBranchForCashDrawer } from './vendor-cash-drawer.js';
import { buildCashDrawerLedgerFields } from './client-cash-drawer.js';

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function takeTreasurySplitsFromPool(pool, target) {
  let need = round2(target);
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

function clientDeferredPurchaseMatchOr(clientId, phoneNumber) {
  const purchaseMatchOr = [{ 'productPayload.acquiredFrom.clientId': clientId }];
  const phoneCandidates = buildPhoneSearchCandidates(phoneNumber);
  if (phoneCandidates.length) {
    purchaseMatchOr.push({
      'productPayload.acquiredFrom.phone': { $in: phoneCandidates },
      $or: [
        { 'productPayload.acquiredFrom.partyType': 'client' },
        { 'productPayload.acquiredFrom.partyType': { $exists: false } },
        { 'productPayload.acquiredFrom.partyType': null },
      ],
    });
  }
  return purchaseMatchOr;
}

export async function computeClientPayableBreakdown(clientId, phoneNumber) {
  const purchaseMatchOr = clientDeferredPurchaseMatchOr(clientId, phoneNumber);

  const rows = await ProductPurchaseRequest.find({
    $or: purchaseMatchOr,
    status: 'approved',
  })
    .select('amountPaid purchaseTreasurySplits purchaseTreasuryKey productPayload quantity')
    .lean();

  let deferred = 0;
  for (const p of rows) {
    deferred += deferredDeskPurchaseRemaining(p);
  }
  deferred = round2(deferred);

  const client = await Client.findById(clientId).select('creditBalance').lean();
  const prepaid = round2(client?.creditBalance);

  return {
    deferred,
    prepaid,
    total: round2(deferred + prepaid),
  };
}

/**
 * Batch deferred desk-purchase remainings keyed by clientId string.
 * Matches by acquiredFrom.clientId (primary) and optional phone fallback.
 * @param {{ _id: import('mongoose').Types.ObjectId, phoneNumber?: string }[]} clients
 */
export async function computeClientDeferredPayablesByClients(clients) {
  const list = (clients || []).filter((c) => c?._id);
  const map = new Map(list.map((c) => [String(c._id), 0]));
  if (!list.length) return map;

  const clientIds = list.map((c) => c._id);
  const phoneToClientIds = new Map();
  for (const c of list) {
    for (const phone of buildPhoneSearchCandidates(c.phoneNumber)) {
      if (!phoneToClientIds.has(phone)) phoneToClientIds.set(phone, []);
      phoneToClientIds.get(phone).push(String(c._id));
    }
  }
  const phones = [...phoneToClientIds.keys()];

  const rows = await ProductPurchaseRequest.find({
    status: 'approved',
    $or: [
      { 'productPayload.acquiredFrom.clientId': { $in: clientIds } },
      ...(phones.length
        ? [
            {
              'productPayload.acquiredFrom.phone': { $in: phones },
              $or: [
                { 'productPayload.acquiredFrom.partyType': 'client' },
                { 'productPayload.acquiredFrom.partyType': { $exists: false } },
                { 'productPayload.acquiredFrom.partyType': null },
              ],
            },
          ]
        : []),
    ],
  })
    .select(
      'amountPaid purchaseTreasurySplits purchaseTreasuryKey productPayload.acquiredFrom quantity productPayload.netPrice'
    )
    .lean();

  for (const p of rows) {
    const rem = deferredDeskPurchaseRemaining(p);
    if (rem <= 0) continue;
    const af = p.productPayload?.acquiredFrom || {};
    const byClientId = af.clientId ? String(af.clientId) : '';
    if (byClientId && map.has(byClientId)) {
      map.set(byClientId, round2((map.get(byClientId) || 0) + rem));
      continue;
    }
    const phone = String(af.phone || '').trim();
    const phoneMatches = phoneToClientIds.get(phone) || [];
    // Phone fallback: attribute once (first matching client in the batch).
    if (phoneMatches.length) {
      const id = phoneMatches[0];
      map.set(id, round2((map.get(id) || 0) + rem));
    }
  }
  return map;
}

/**
 * Net settlement: reduce deferred desk-purchase remainings (no cash drawer).
 * Oldest approved deferred purchases first.
 */
export async function applyClientDeferredPayableSettlement(
  clientId,
  phoneNumber,
  amount
) {
  let remaining = round2(amount);
  if (remaining <= 0) return 0;

  const purchaseMatchOr = clientDeferredPurchaseMatchOr(clientId, phoneNumber);
  const rows = await ProductPurchaseRequest.find({
    $or: purchaseMatchOr,
    status: 'approved',
  }).sort({ createdAt: 1 });

  let totalApplied = 0;

  for (const purchase of rows) {
    if (remaining <= 0) break;
    const due = deferredDeskPurchaseRemaining(purchase);
    if (due <= 0) continue;
    const apply = Math.min(remaining, due);
    purchase.amountPaid = round2((Number(purchase.amountPaid) || 0) + apply);
    await purchase.save();
    remaining = round2(remaining - apply);
    totalApplied = round2(totalApplied + apply);
  }

  return totalApplied;
}

/**
 * Pay client from purchase treasuries: deferred desk purchases then prepaid refund.
 */
export async function payClientWithTreasury(
  client,
  { userId, branchId, note, paymentTreasurySplits: splitsRaw } = {}
) {
  if (!client?._id) {
    throw new Error('Client not found');
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
    throw new Error('Deferred treasury cannot be used when paying the client');
  }

  const payableBreakdown = await computeClientPayableBreakdown(
    client._id,
    client.phoneNumber
  );
  if (lineTotal > payableBreakdown.total + 0.01) {
    throw new Error('Payment exceeds client credit balance');
  }

  let splitPool = splits.map((s) => ({ ...s }));
  let budget = lineTotal;
  let appliedToPurchases = 0;
  let appliedToPrepaid = 0;

  const phoneCandidates = buildPhoneSearchCandidates(client.phoneNumber);
  const purchaseMatchOr = [{ 'productPayload.acquiredFrom.clientId': client._id }];
  if (phoneCandidates.length) {
    purchaseMatchOr.push({
      'productPayload.acquiredFrom.phone': { $in: phoneCandidates },
      $or: [
        { 'productPayload.acquiredFrom.partyType': 'client' },
        { 'productPayload.acquiredFrom.partyType': { $exists: false } },
        { 'productPayload.acquiredFrom.partyType': null },
      ],
    });
  }

  const purchases = await ProductPurchaseRequest.find({
    $or: purchaseMatchOr,
    status: 'approved',
  }).sort({ createdAt: 1 });

  for (const purchase of purchases) {
    if (budget <= 0) break;
    const due = deferredDeskPurchaseRemaining(purchase);
    if (due <= 0) continue;

    const chunk = Math.min(budget, due);
    const { taken, pool } = takeTreasurySplitsFromPool(splitPool, chunk);
    if (!taken.length) break;

    await recordDeskPurchaseDeferredPayment(purchase._id, {
      userId,
      branchId,
      note: String(note || '').trim() || 'سداد للعميل',
      paymentTreasurySplits: taken,
      amount: chunk,
    });

    splitPool = pool;
    budget = round2(budget - chunk);
    appliedToPurchases = round2(appliedToPurchases + chunk);
  }

  const prepaidBefore = round2(client.creditBalance);
  if (budget > 0 && prepaidBefore > 0) {
    const chunk = Math.min(budget, prepaidBefore);
    const { taken, pool } = takeTreasurySplitsFromPool(splitPool, chunk);
    if (taken.length) {
      const clientDoc = await Client.findById(client._id);
      if (!clientDoc) throw new Error('Client not found');

      const uid = mongoose.Types.ObjectId.isValid(String(userId || ''))
        ? new mongoose.Types.ObjectId(String(userId))
        : undefined;
      const resolvedBranch = await resolveBranchForCashDrawer({ userId, branchId });
      const cashDrawerAmount = cashAmountFromTreasurySplits(taken);
      const payNote =
        String(note || '').trim() || 'سداد للعميل — رصيد مسبق';

      clientDoc.creditBalance = round2((Number(clientDoc.creditBalance) || 0) - chunk);
      clientDoc.ledgerEntries = clientDoc.ledgerEntries || [];
      for (const s of taken) {
        const splitNote = `${payNote}${taken.length > 1 ? ` — ${s.label || s.key}` : ''}`;
        clientDoc.ledgerEntries.push({
          type: 'payout',
          amount: s.amount,
          paymentMethod: s.key,
          note: splitNote,
          createdAt: new Date(),
          createdByUserId: uid,
          ...buildCashDrawerLedgerFields({
            fromCashDrawer: treasuryKeyIsCashDrawer(s.key),
            branchId: treasuryKeyIsCashDrawer(s.key) ? resolvedBranch : undefined,
          }),
        });
      }
      await clientDoc.save();

      if (cashDrawerAmount > 0 && resolvedBranch && uid) {
        const treasuryKey = derivePurchaseTreasuryKey(taken);
        const treasuryLabel = derivePurchaseTreasuryLabel(taken, tMap);
        await DailyExpense.create({
          branch: resolvedBranch,
          amount: cashDrawerAmount,
          expenseType: 'client_prepaid_payout',
          notes: payNote,
          recordedBy: uid,
          expenseTreasuryKey: treasuryKey,
          expenseTreasuryLabel: treasuryLabel,
          expenseTreasurySplits: taken,
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

  const payableAfter = await computeClientPayableBreakdown(client._id, client.phoneNumber);
  const clientFresh = await Client.findById(client._id).lean();

  return {
    applied: lineTotal,
    appliedToPurchases,
    appliedToPrepaid,
    cashDrawerAmount: cashAmountFromTreasurySplits(splits),
    paymentTreasurySplits: splits,
    clientPayable: payableAfter.total,
    clientPayableDeferred: payableAfter.deferred,
    prepaidBalance: round2(clientFresh?.creditBalance),
  };
}
