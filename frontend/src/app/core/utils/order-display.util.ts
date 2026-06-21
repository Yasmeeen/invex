import { InvoiceReturnRecord, Order, OrderProductLine } from '@core/models/products.model';
import { normalizeMongoId } from './mongo-id.util';

/** Pay later / بيع بالآجل — only method that can be partially paid after sale. */
export function isPayLaterMethod(method: string | null | undefined): boolean {
  return String(method ?? '')
    .trim()
    .toLowerCase() === 'credit';
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
