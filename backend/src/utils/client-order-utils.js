import Order from '../DB/models/order.model.js';
import { orderAmountRemaining } from './vendor-balance-utils.js';

/** 1 loyalty point per 10 EGP on completed sales (configurable ratio). */
export const CLIENT_POINTS_PER_EGP = 0.1;

export function isClientCreditOrder(order) {
  return (
    String(order?.paymentMethod || '')
      .trim()
      .toLowerCase() === 'credit'
  );
}

export function pointsEarnedForOrder(order) {
  if (!order || order.status === 'restored') return 0;
  const total = Number(order.totalPrice) || 0;
  if (total <= 0) return 0;
  return Math.floor(total * CLIENT_POINTS_PER_EGP);
}

/** Sum remaining on unpaid/partial pay-later (بيع بالآجل) client orders. */
export async function computeClientCreditDue(clientId) {
  const orders = await Order.find({
    clientId,
    partyType: { $in: [null, 'client'] },
    paymentMethod: 'credit',
    paymentStatus: { $in: ['unpaid', 'partial'] },
    status: { $ne: 'restored' },
  }).lean();

  let total = 0;
  for (const o of orders) {
    total += orderAmountRemaining(o);
  }
  return Math.round(total * 100) / 100;
}
