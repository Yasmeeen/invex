import mongoose from 'mongoose';
import ProductPurchaseRequest from '../DB/models/productPurchaseRequest.model.js';
import DailyExpense from '../DB/models/dailyExpense.model.js';
import {
  getEffectivePurchaseTreasuryMethodsFromDb,
  treasuryMethodMap,
} from '../modules/settings_module/treasuryMethods.js';
import {
  cashAmountFromTreasurySplits,
  derivePurchaseTreasuryKey,
  derivePurchaseTreasuryLabel,
  deskPurchaseLineTotal,
  normalizeTreasurySplitsInput,
} from './purchase-treasury-splits.js';
import { resolveBranchForCashDrawer } from './vendor-cash-drawer.js';
import { postTreasurySplitOutflows, safeTreasuryPost } from './treasury-ledger.js';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Store pays customer/supplier the exchange difference (trade-in credit > sale total).
 * Records treasury splits on the trade-in purchase; cash drawer via daily expense.
 */
export async function recordExchangeSettlement(
  purchaseId,
  { orderId, amount: amountRaw, paymentTreasurySplits: splitsRaw, userId, branchId, note } = {}
) {
  if (!purchaseId) {
    throw new Error('Purchase id is required');
  }

  const purchase = await ProductPurchaseRequest.findById(purchaseId);
  if (!purchase) {
    throw new Error('Purchase not found');
  }
  if (!purchase.isExchangeTradeIn) {
    throw new Error('Not an exchange trade-in purchase');
  }
  if (purchase.status !== 'approved') {
    throw new Error('Trade-in purchase is not approved');
  }
  if (purchase.exchangeSettlementSplits?.length) {
    throw new Error('Exchange settlement already recorded');
  }

  let lineTotal = round2(amountRaw);
  if (Array.isArray(splitsRaw) && splitsRaw.length) {
    lineTotal = round2(splitsRaw.reduce((acc, row) => acc + (Number(row?.amount) || 0), 0));
  }
  if (!Number.isFinite(lineTotal) || lineTotal <= 0) {
    throw new Error('Valid settlement amount is required');
  }

  const treasuryMethods = await getEffectivePurchaseTreasuryMethodsFromDb();
  const tMap = treasuryMethodMap(treasuryMethods);
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

  const splits = treasuryNorm.splits;
  const cashDrawerAmount = cashAmountFromTreasurySplits(splits);
  const treasuryKey = derivePurchaseTreasuryKey(splits);
  const treasuryLabel = derivePurchaseTreasuryLabel(splits, tMap);

  purchase.exchangeSettlementSplits = splits;
  purchase.purchaseTreasuryKey = treasuryKey;
  purchase.purchaseTreasuryLabel = treasuryLabel;
  if (orderId && mongoose.Types.ObjectId.isValid(String(orderId))) {
    purchase.linkedExchangeOrderId = new mongoose.Types.ObjectId(String(orderId));
  }
  purchase.markModified('exchangeSettlementSplits');
  await purchase.save();

  await safeTreasuryPost('exchange_settlement', async () => {
    const resolvedBranch = await resolveBranchForCashDrawer({
      userId,
      branchId: branchId || purchase.branch,
    });
    if (!resolvedBranch) return;
    await postTreasurySplitOutflows({
      branchId: resolvedBranch,
      splits,
      sourceType: 'desk_purchase',
      sourceId: purchase._id,
      note: String(note || '').trim() || 'Exchange settlement',
      createdBy: userId,
    });
  });

  if (cashDrawerAmount > 0) {
    const resolvedBranch = await resolveBranchForCashDrawer({
      userId,
      branchId: branchId || purchase.branch,
    });
    const uid =
      userId && mongoose.Types.ObjectId.isValid(String(userId))
        ? new mongoose.Types.ObjectId(String(userId))
        : null;
    if (resolvedBranch && uid) {
      const pp = purchase.productPayload || {};
      const af = pp.acquiredFrom || {};
      const partyLabel = String(af.displayName || af.name || af.phone || 'client').trim();
      await DailyExpense.create({
        branch: resolvedBranch,
        amount: cashDrawerAmount,
        expenseType: 'exchange_settlement_paid',
        notes:
          String(note || '').trim() ||
          `فرق استبدال — ${partyLabel}${pp.name ? ` · ${pp.name}` : ''}`,
        recordedBy: uid,
        expenseTreasuryKey: treasuryKey,
        expenseTreasuryLabel: treasuryLabel,
        expenseTreasurySplits: splits,
      });
    }
  }

  return {
    applied: lineTotal,
    cashDrawerAmount,
    purchaseLineTotal: deskPurchaseLineTotal(purchase),
    paymentTreasurySplits: splits,
  };
}
