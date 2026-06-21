import { isDeferredPurchaseTreasury, treasuryMethodMap } from '../modules/settings_module/treasuryMethods.js';
import { resolvePurchaseTreasurySplits } from './purchase-treasury-splits.js';
import { isClientCreditOrder } from './client-order-utils.js';

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function normalizePayMethod(raw) {
  const s = String(raw || '')
    .trim()
    .toLowerCase();
  return s || 'cash';
}

/** Proportional allocation of refundTotal across weighted rows. */
export function proportionalRefundRows(rows, refundTotal, getWeight, buildRow) {
  const total = round2(refundTotal);
  if (total <= 0 || !rows?.length) return [];

  const weights = rows.map((r) => Math.max(0, Number(getWeight(r)) || 0));
  const weightSum = round2(weights.reduce((a, b) => a + b, 0));
  if (weightSum <= 0) return [];

  const out = [];
  let allocated = 0;
  for (let i = 0; i < rows.length; i++) {
    const amt =
      i === rows.length - 1 ? round2(total - allocated) : round2(total * (weights[i] / weightSum));
    if (amt > 0) out.push(buildRow(rows[i], amt));
    allocated = round2(allocated + amt);
  }
  return out;
}

function originalSalesPaymentMap(order) {
  const map = {};
  const pays = (order?.payments || []).filter(
    (p) => p.countsTowardInvoice !== false && Number(p.amount) > 0
  );
  if (pays.length) {
    for (const p of pays) {
      const m = normalizePayMethod(p.method);
      map[m] = round2((map[m] || 0) + Number(p.amount || 0));
    }
    return map;
  }
  const m = normalizePayMethod(order?.paymentMethod);
  map[m] = round2(Number(order?.amountPaid) || Number(order?.totalPrice) || 0);
  return map;
}

export function buildSalesRefundPaymentSplits(order, refundTotal) {
  const total = round2(refundTotal);
  if (total <= 0) return [];

  const map = originalSalesPaymentMap(order);
  const keys = Object.keys(map).filter((k) => map[k] > 0);
  if (!keys.length) {
    return [{ method: normalizePayMethod(order?.paymentMethod), amount: total }];
  }

  return proportionalRefundRows(
    keys.map((method) => ({ method, weight: map[method] })),
    total,
    (r) => r.weight,
    (r, amount) => ({ method: r.method, amount })
  );
}

/**
 * Apply cash-portion choice for sales returns.
 * @returns {{ refundPaymentSplits, refundTreasurySplits, cashRefundVia, cashDrawerAmount }}
 */
export function finalizeSalesRefundSplits(
  refundPaymentSplits,
  { cashRefundVia = 'drawer', cashTreasuryKey, cashTreasuryLabel, tMap = new Map() } = {}
) {
  const via = String(cashRefundVia || 'drawer').toLowerCase() === 'treasury' ? 'treasury' : 'drawer';
  const splits = (refundPaymentSplits || []).map((s) => ({
    method: normalizePayMethod(s.method),
    amount: round2(s.amount),
  }));

  let cashAmount = 0;
  const nonCash = [];
  for (const s of splits) {
    if (s.method === 'cash' && s.amount > 0) {
      cashAmount = round2(cashAmount + s.amount);
    } else if (s.amount > 0) {
      nonCash.push(s);
    }
  }

  let refundTreasurySplits;
  if (cashAmount > 0 && via === 'treasury') {
    const key = String(cashTreasuryKey || '')
      .trim()
      .toLowerCase();
    if (!key || key === 'deferred') {
      throw new Error('Valid purchase treasury is required for non-drawer cash refund');
    }
    const label =
      String(cashTreasuryLabel || '').trim() || String(tMap.get(key) || key).trim() || key;
    refundTreasurySplits = [{ key, label, amount: cashAmount }];
    return {
      refundPaymentSplits: nonCash.length ? nonCash : undefined,
      refundTreasurySplits,
      cashRefundVia: 'treasury',
      cashDrawerAmount: 0,
    };
  }

  return {
    refundPaymentSplits: splits.length ? splits : undefined,
    refundTreasurySplits: undefined,
    cashRefundVia: 'drawer',
    cashDrawerAmount: cashAmount,
  };
}

export function buildPurchaseNonDeferredRefundSplits(purchase, refundTotal, tMap = new Map()) {
  const total = round2(refundTotal);
  if (total <= 0) return { refundTreasurySplits: [], deferredAdjustmentAmount: 0 };

  const original = resolvePurchaseTreasurySplits(purchase);
  const deferredOrig = original.filter((s) => isDeferredPurchaseTreasury(s.key));
  const nonDeferred = original.filter((s) => !isDeferredPurchaseTreasury(s.key));

  const origTotal = round2(original.reduce((a, s) => a + s.amount, 0));
  const deferredOrigTotal = round2(deferredOrig.reduce((a, s) => a + s.amount, 0));

  let deferredAdjustmentAmount = 0;
  let treasuryRefundTotal = total;

  if (origTotal > 0 && deferredOrigTotal > 0) {
    deferredAdjustmentAmount = round2(total * (deferredOrigTotal / origTotal));
    treasuryRefundTotal = round2(total - deferredAdjustmentAmount);
  }

  if (treasuryRefundTotal <= 0.001) {
    return { refundTreasurySplits: [], deferredAdjustmentAmount };
  }

  if (!nonDeferred.length) {
    return { refundTreasurySplits: [], deferredAdjustmentAmount: total };
  }

  const refundTreasurySplits = proportionalRefundRows(
    nonDeferred,
    treasuryRefundTotal,
    (r) => r.amount,
    (r, amount) => ({
      key: r.key,
      label: String(r.label || tMap.get(r.key) || r.key).trim() || r.key,
      amount,
    })
  );

  return { refundTreasurySplits, deferredAdjustmentAmount };
}

/** Apply cash drawer vs purchase-treasury choice on purchase return splits. */
export function finalizePurchaseRefundSplits(
  refundTreasurySplits,
  { cashRefundVia = 'drawer', cashTreasuryKey, cashTreasuryLabel, tMap = new Map() } = {}
) {
  const via = String(cashRefundVia || 'drawer').toLowerCase() === 'treasury' ? 'treasury' : 'drawer';
  const splits = (refundTreasurySplits || []).map((s) => ({
    key: String(s.key || '')
      .trim()
      .toLowerCase(),
    label: String(s.label || '').trim(),
    amount: round2(s.amount),
  }));

  let cashAmount = 0;
  const rest = [];
  for (const s of splits) {
    if (!s.key || s.amount <= 0) continue;
    if (s.key === 'cash') {
      cashAmount = round2(cashAmount + s.amount);
    } else {
      rest.push(s);
    }
  }

  if (cashAmount > 0 && via === 'treasury') {
    const key = String(cashTreasuryKey || '')
      .trim()
      .toLowerCase();
    if (!key || key === 'deferred' || key === 'cash') {
      throw new Error('Valid non-cash purchase treasury is required');
    }
    const label =
      String(cashTreasuryLabel || '').trim() || String(tMap.get(key) || key).trim() || key;
    const existing = rest.find((s) => s.key === key);
    if (existing) {
      existing.amount = round2(existing.amount + cashAmount);
    } else {
      rest.push({ key, label, amount: cashAmount });
    }
    return { refundTreasurySplits: rest, cashRefundVia: 'treasury', cashDrawerAmount: 0 };
  }

  const out = [];
  if (cashAmount > 0) out.push({ key: 'cash', label: splits.find((s) => s.key === 'cash')?.label || 'Cash', amount: cashAmount });
  for (const s of rest) out.push(s);

  return {
    refundTreasurySplits: out,
    cashRefundVia: 'drawer',
    cashDrawerAmount: cashAmount,
  };
}

export function salesRefundCashDue(order, refundTotal) {
  if (!isClientCreditOrder(order)) return round2(refundTotal);
  const currentTotal = round2(Number(order.totalPrice) || 0);
  const newTotal = round2(Math.max(0, currentTotal - refundTotal));
  const alreadyPaid = round2(Number(order.amountPaid) || 0);
  return round2(Math.max(0, alreadyPaid - newTotal));
}

export function salesCreditAdjustment(order, refundTotal) {
  if (!isClientCreditOrder(order)) return 0;
  const currentTotal = round2(Number(order.totalPrice) || 0);
  const alreadyPaid = round2(Number(order.amountPaid) || 0);
  return round2(Math.min(refundTotal, Math.max(0, currentTotal - alreadyPaid)));
}
