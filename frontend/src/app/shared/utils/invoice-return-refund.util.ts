import { Order } from '@core/models/products.model';
import { isPayLaterMethod } from '@core/utils/order-display.util';
import { PurchaseTreasurySplit } from '@shared/services/product-purchase-requests.service';

export type RefundAllocationRow = {
  kind: 'payment' | 'treasury' | 'credit' | 'deferred';
  key: string;
  label: string;
  amount: number;
};

export type CashRefundVia = 'drawer' | 'treasury';

function round2(n: number): number {
  return Math.round(Number(n || 0) * 100) / 100;
}

function normalizePayMethod(raw: string | undefined | null): string {
  const s = String(raw || '')
    .trim()
    .toLowerCase();
  return s || 'cash';
}

function proportionalRows<T>(
  rows: T[],
  total: number,
  weight: (row: T) => number,
  build: (row: T, amount: number) => RefundAllocationRow
): RefundAllocationRow[] {
  const refundTotal = round2(total);
  if (refundTotal <= 0 || !rows.length) return [];

  const weights = rows.map((r) => Math.max(0, Number(weight(r)) || 0));
  const weightSum = round2(weights.reduce((a, b) => a + b, 0));
  if (weightSum <= 0) return [];

  const out: RefundAllocationRow[] = [];
  let allocated = 0;
  for (let i = 0; i < rows.length; i++) {
    const amt =
      i === rows.length - 1 ? round2(refundTotal - allocated) : round2(refundTotal * (weights[i] / weightSum));
    if (amt > 0) out.push(build(rows[i], amt));
    allocated = round2(allocated + amt);
  }
  return out;
}

function originalSalesPaymentMap(order: Order): Record<string, number> {
  const map: Record<string, number> = {};
  const pays = (order.payments || []).filter(
    (p) => (p as any).countsTowardInvoice !== false && Number(p.amount) > 0
  );
  if (pays.length) {
    for (const p of pays) {
      const m = normalizePayMethod(p.method);
      map[m] = round2((map[m] || 0) + Number(p.amount || 0));
    }
    return map;
  }
  const m = normalizePayMethod(order.paymentMethod);
  map[m] = round2(Number(order.amountPaid) || Number(order.totalPrice) || 0);
  return map;
}

export function salesRefundCashDue(order: Order, refundTotal: number): number {
  if (!isPayLaterMethod(order.paymentMethod)) return round2(refundTotal);
  const currentTotal = round2(Number(order.totalPrice) || 0);
  const newTotal = round2(Math.max(0, currentTotal - refundTotal));
  const alreadyPaid = round2(Number(order.amountPaid) || 0);
  return round2(Math.max(0, alreadyPaid - newTotal));
}

export function salesCreditAdjustment(order: Order, refundTotal: number): number {
  if (!isPayLaterMethod(order.paymentMethod)) return 0;
  const currentTotal = round2(Number(order.totalPrice) || 0);
  const alreadyPaid = round2(Number(order.amountPaid) || 0);
  return round2(Math.min(refundTotal, Math.max(0, currentTotal - alreadyPaid)));
}

export function buildSalesRefundPreview(
  order: Order,
  refundTotal: number,
  paymentLabel: (method: string) => string
): RefundAllocationRow[] {
  const total = round2(refundTotal);
  if (total <= 0) return [];

  const creditAdj = salesCreditAdjustment(order, total);
  const cashDue = salesRefundCashDue(order, total);
  const rows: RefundAllocationRow[] = [];

  if (creditAdj > 0) {
    rows.push({
      kind: 'credit',
      key: 'credit',
      label: paymentLabel('credit'),
      amount: creditAdj,
    });
  }

  if (cashDue <= 0) return rows;

  const map = originalSalesPaymentMap(order);
  const keys = Object.keys(map).filter((k) => map[k] > 0);
  const paymentRows = proportionalRows(
    keys.map((method) => ({ method, weight: map[method] })),
    cashDue,
    (r) => r.weight,
    (r, amount) => ({
      kind: 'payment',
      key: r.method,
      label: paymentLabel(r.method),
      amount,
    })
  );
  return rows.concat(paymentRows);
}

export function salesCashPortionAmount(preview: RefundAllocationRow[]): number {
  return round2(
    preview.filter((r) => r.kind === 'payment' && r.key === 'cash').reduce((a, r) => a + r.amount, 0)
  );
}

export function resolvePurchaseTreasurySplitsLocal(purchase: any): PurchaseTreasurySplit[] {
  const splits = Array.isArray(purchase?.purchaseTreasurySplits) ? purchase.purchaseTreasurySplits : [];
  if (splits.length) {
    return splits.map((s: any) => ({
      key: String(s.key || '').trim().toLowerCase(),
      label: String(s.label || s.key || '').trim(),
      amount: round2(Number(s.amount) || 0),
    }));
  }
  const q = Math.max(1, Math.floor(Number(purchase?.quantity) || 1));
  const net = round2(Number(purchase?.productPayload?.netPrice) || 0);
  const total = round2(net * q);
  const key = String(purchase?.purchaseTreasuryKey || 'cash').trim().toLowerCase();
  const label = String(purchase?.purchaseTreasuryLabel || key).trim();
  return [{ key, label, amount: total }];
}

export function buildPurchaseRefundPreview(
  purchase: any,
  refundTotal: number,
  treasuryLabel: (key: string, fallback?: string) => string
): RefundAllocationRow[] {
  const total = round2(refundTotal);
  if (total <= 0) return [];

  const original = resolvePurchaseTreasurySplitsLocal(purchase);
  const deferred = original.filter((s) => s.key === 'deferred');
  const nonDeferred = original.filter((s) => s.key !== 'deferred');

  const origTotal = round2(original.reduce((a, s) => a + s.amount, 0));
  const deferredTotal = round2(deferred.reduce((a, s) => a + s.amount, 0));

  const rows: RefundAllocationRow[] = [];
  if (origTotal > 0 && deferredTotal > 0) {
    const defAmt = round2(total * (deferredTotal / origTotal));
    if (defAmt > 0) {
      rows.push({
        kind: 'deferred',
        key: 'deferred',
        label: treasuryLabel('deferred', 'Deferred'),
        amount: defAmt,
      });
    }
  }

  const treasuryRefundTotal = round2(total - rows.reduce((a, r) => a + r.amount, 0));
  if (treasuryRefundTotal <= 0 || !nonDeferred.length) return rows;

  const treasuryRows = proportionalRows(
    nonDeferred,
    treasuryRefundTotal,
    (r) => r.amount,
    (r, amount) => ({
      kind: 'treasury',
      key: r.key,
      label: treasuryLabel(r.key, r.label),
      amount,
    })
  );
  return rows.concat(treasuryRows);
}

export function purchaseCashPortionAmount(preview: RefundAllocationRow[]): number {
  return round2(
    preview.filter((r) => r.kind === 'treasury' && r.key === 'cash').reduce((a, r) => a + r.amount, 0)
  );
}

export function applyCashViaToPreview(
  preview: RefundAllocationRow[],
  cashVia: CashRefundVia,
  treasuryKey: string,
  treasuryLabel: string
): RefundAllocationRow[] {
  const cashAmt =
    preview.find((r) => (r.kind === 'payment' || r.kind === 'treasury') && r.key === 'cash')?.amount || 0;
  if (cashAmt <= 0 || cashVia === 'drawer') return preview;

  const key = String(treasuryKey || '').trim().toLowerCase();
  if (!key || key === 'cash' || key === 'deferred') return preview;

  const next = preview.filter((r) => !((r.kind === 'payment' || r.kind === 'treasury') && r.key === 'cash'));
  const existing = next.find((r) => r.kind === 'treasury' && r.key === key);
  if (existing) {
    existing.amount = round2(existing.amount + cashAmt);
  } else {
    next.push({
      kind: 'treasury',
      key,
      label: treasuryLabel,
      amount: cashAmt,
    });
  }
  return next;
}
