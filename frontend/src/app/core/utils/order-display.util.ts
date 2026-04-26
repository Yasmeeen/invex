import { Order } from '@core/models/products.model';

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
