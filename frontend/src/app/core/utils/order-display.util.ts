import { InvoiceReturnRecord, Order, OrderProductLine } from '@core/models/products.model';
import { normalizeMongoId } from './mongo-id.util';

/** Pay later / بيع بالآجل / تقسيط — can be partially paid after sale. */
export function isPayLaterMethod(method: string | null | undefined): boolean {
  const m = String(method ?? '')
    .trim()
    .toLowerCase();
  return m === 'credit' || m === 'installment';
}

/** Sale has an installment schedule (even if paymentMethod is mixed historically). */
export function orderHasInstallmentSchedule(order: { installments?: unknown[] } | null | undefined): boolean {
  return Array.isArray(order?.installments) && order!.installments!.length > 0;
}

/** Customer sale paid via installment plan (not plain credit). */
export function isInstallmentSale(order: {
  paymentMethod?: string | null;
  installments?: unknown[];
} | null | undefined): boolean {
  if (!order) return false;
  if (String(order.paymentMethod ?? '').trim().toLowerCase() === 'installment') {
    return true;
  }
  return orderHasInstallmentSchedule(order);
}

export function orderInstallmentMonths(order: {
  installmentPlanSnapshot?: { months?: number } | null;
  installments?: unknown[];
} | null | undefined): number {
  const fromSnap = Number(order?.installmentPlanSnapshot?.months);
  if (Number.isFinite(fromSnap) && fromSnap > 0) {
    return Math.floor(fromSnap);
  }
  if (Array.isArray(order?.installments) && order!.installments!.length) {
    return order!.installments!.length;
  }
  return 0;
}

/** Typical monthly installment amount (first schedule row; last may differ by rounding). */
export function orderInstallmentMonthlyAmount(order: {
  installments?: Array<{ amount?: number }> | null;
} | null | undefined): number {
  const list = order?.installments;
  if (!Array.isArray(list) || !list.length) return 0;
  const n = Number(list[0]?.amount);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

export function countUnpaidSaleInstallments(
  installments: Array<{ paid?: boolean; amount?: number; paidAmount?: number }> | null | undefined
): number {
  if (!Array.isArray(installments)) return 0;
  return installments.filter((r) => {
    if (r?.paid) return false;
    const amount = Math.round((Number(r?.amount) || 0) * 100) / 100;
    const paidAmount = Math.round((Number(r?.paidAmount) || 0) * 100) / 100;
    return amount - paidAmount > 0.001;
  }).length;
}

function toMoney(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number' && Number.isFinite(v)) {
    return v;
  }
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/**
 * List / dialogs: for non–pay-later, show full invoice as paid (settled at checkout;
 * DB may still have amountPaid 0 on older rows). For credit, use amountPaid and status.
 */
export function orderDisplayPaid(order: Order | null | undefined): number {
  if (!order) return 0;
  const total = toMoney(order.totalPrice);
  if (!isPayLaterMethod(order.paymentMethod)) {
    return total;
  }
  const paidStored = toMoney(order.amountPaid);
  if (order.paymentStatus === 'paid' || paidStored >= total) {
    return total;
  }
  return paidStored;
}

export function orderDisplayRemaining(order: Order | null | undefined): number {
  if (!order) return 0;
  const total = toMoney(order.totalPrice);
  if (!isPayLaterMethod(order.paymentMethod)) {
    return 0;
  }
  const paidStored = toMoney(order.amountPaid);
  if (order.paymentStatus === 'paid' || paidStored >= total) {
    return 0;
  }
  return Math.max(0, Math.round((total - paidStored) * 100) / 100);
}

/** Plain deferred credit (بيع بالآجل) — not installment. */
export function isCreditOnlySale(order: {
  paymentMethod?: string | null;
  installments?: unknown[];
} | null | undefined): boolean {
  if (!order) return false;
  if (isInstallmentSale(order)) return false;
  return String(order.paymentMethod ?? '').trim().toLowerCase() === 'credit';
}

/** Fully or partially returned — balance may be zero without installments being paid off. */
export function isOrderReturned(order: { status?: string | null } | null | undefined): boolean {
  const s = String(order?.status ?? '')
    .trim()
    .toLowerCase();
  return s === 'restored' || s === 'partially_restored';
}

/** Credit invoice with no remaining balance (fully settled by payment — not by return). */
export function isPayLaterSettled(order: Order | null | undefined): boolean {
  if (!order || isOrderReturned(order)) return false;
  return isPayLaterMethod(order.paymentMethod) && orderDisplayRemaining(order) <= 0;
}

/** Credit invoice still owed (unpaid or partial). */
export function isPayLaterOutstanding(order: Order | null | undefined): boolean {
  if (!order || isOrderReturned(order)) return false;
  return isPayLaterMethod(order.paymentMethod) && orderDisplayRemaining(order) > 0;
}

export function isInstallmentOutstanding(order: Order | null | undefined): boolean {
  if (!order || isOrderReturned(order)) return false;
  return isInstallmentSale(order) && orderDisplayRemaining(order) > 0;
}

export function isInstallmentSettled(order: Order | null | undefined): boolean {
  if (!order || isOrderReturned(order)) return false;
  return isInstallmentSale(order) && orderDisplayRemaining(order) <= 0;
}

export function isCreditOnlyOutstanding(order: Order | null | undefined): boolean {
  if (!order || isOrderReturned(order)) return false;
  return isCreditOnlySale(order) && orderDisplayRemaining(order) > 0;
}

export function isCreditOnlySettled(order: Order | null | undefined): boolean {
  if (!order || isOrderReturned(order)) return false;
  return isCreditOnlySale(order) && orderDisplayRemaining(order) <= 0;
}

export function orderInstallmentPlanName(order: {
  installmentPlanSnapshot?: { name?: string } | null;
} | null | undefined): string {
  return String(order?.installmentPlanSnapshot?.name || '').trim();
}

/** Normalize product id on order line items (string / ObjectId / `{ _id }`). */
export function lineProductId(raw: unknown): string {
  return normalizeMongoId(raw) || String(raw ?? '').trim();
}

/** Sum returned units for a line from `order.returns` history (fallback when `returnedQuantity` is stale). */
export function returnedQtyFromHistory(
  returns: InvoiceReturnRecord[] | undefined,
  productId: unknown
): number {
  const pid = lineProductId(productId);
  if (!pid || !returns?.length) return 0;
  let sum = 0;
  for (const ret of returns) {
    for (const item of ret.items || []) {
      if (lineProductId(item.productId) === pid) {
        sum += Math.max(0, Math.floor(Number(item.quantity) || 0));
      }
    }
  }
  return sum;
}

/** Remaining returnable units on one sales invoice line. */
export function orderLineRemainingQty(line: OrderProductLine, order?: Order | null): number {
  const sold = Math.max(0, Math.floor(Number(line.quantity) || 0));
  const fromLine = Math.max(0, Math.floor(Number(line.returnedQuantity) || 0));
  const fromHistory = order ? returnedQtyFromHistory(order.returns, line.productId) : 0;
  const returned = Math.max(fromLine, fromHistory);
  return Math.max(0, sold - returned);
}

/** Units still eligible for a sales invoice return. */
export function orderReturnableUnitCount(order: Order | null | undefined): number {
  if (!order?.products?.length) return 0;
  return order.products.reduce((acc, line) => acc + orderLineRemainingQty(line, order), 0);
}

/** Show return action until every line is fully returned (status `restored`). */
export function canReturnOrder(order: Order | null | undefined): boolean {
  if (!order?._id) return false;
  if (order.status === 'restored') return false;
  return orderReturnableUnitCount(order) > 0;
}

export function hasOrderReturns(order: Order | null | undefined): boolean {
  return Array.isArray(order?.returns) && order!.returns!.length > 0;
}

export function hasPurchaseReturns(purchase: { returns?: unknown[] } | null | undefined): boolean {
  return Array.isArray(purchase?.returns) && purchase!.returns!.length > 0;
}

/** Sum returned units from purchase return history. */
export function purchaseReturnedFromHistory(purchase: { returns?: InvoiceReturnRecord[] } | null | undefined): number {
  if (!purchase?.returns?.length) return 0;
  return purchase.returns.reduce(
    (acc, ret) => acc + Math.max(0, Math.floor(Number(ret.quantity) || 0)),
    0
  );
}

/** Remaining returnable quantity on a desk purchase invoice. */
export function purchaseReturnableQty(purchase: { quantity?: number; returnedQuantity?: number; returns?: InvoiceReturnRecord[] } | null | undefined): number {
  const q = Math.max(1, Math.floor(Number(purchase?.quantity) || 1));
  const fromField = Math.max(0, Math.floor(Number(purchase?.returnedQuantity) || 0));
  const fromHistory = purchaseReturnedFromHistory(purchase);
  const returned = Math.max(fromField, fromHistory);
  return Math.max(0, q - returned);
}

export function canReturnPurchase(purchase: {
  status?: string;
  isExchangeTradeIn?: boolean;
  quantity?: number;
  returnedQuantity?: number;
  returns?: InvoiceReturnRecord[];
} | null | undefined): boolean {
  const s = String(purchase?.status || '').toLowerCase();
  if (!purchase || purchase.isExchangeTradeIn) return false;
  if (s === 'returned' || s === 'rejected' || s === 'pending') return false;
  return purchaseReturnableQty(purchase) > 0;
}
