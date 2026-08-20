import Order from '../DB/models/order.model.js';
import Client from '../DB/models/client.model.js';
import { orderAmountRemaining } from './vendor-balance-utils.js';

/** 1 loyalty point per 10 EGP on completed sales (configurable ratio). */
export const CLIENT_POINTS_PER_EGP = 0.1;

export function isClientCreditOrder(order) {
  const m = String(order?.paymentMethod || '')
    .trim()
    .toLowerCase();
  if (m === 'credit' || m === 'installment') return true;
  if (Array.isArray(order?.installments) && order.installments.length > 0) return true;
  return false;
}

export function pointsEarnedForOrder(order) {
  if (!order || order.status === 'restored') return 0;
  const total = Number(order.totalPrice) || 0;
  if (total <= 0) return 0;
  return Math.floor(total * CLIENT_POINTS_PER_EGP);
}

/** Sum remaining on unpaid/partial pay-later (بيع بالآجل) client orders only. */
export async function computeClientCreditDueFromOrders(clientId) {
  const orders = await Order.find({
    clientId,
    partyType: { $in: [null, 'client'] },
    paymentMethod: { $in: ['credit', 'installment'] },
    paymentStatus: { $in: ['unpaid', 'partial'] },
    status: { $ne: 'restored' },
  }).lean();

  let total = 0;
  for (const o of orders) {
    total += orderAmountRemaining(o);
  }
  return Math.round(total * 100) / 100;
}

/** @deprecated alias — use computeClientCreditDueFromOrders */
export async function computeClientCreditDue(clientId) {
  return computeClientCreditDueFromOrders(clientId);
}

/** Total client debit = credit sales remaining + opening debit (مدين — العميل عليه). */
export async function computeClientOwesUs(clientId) {
  const fromOrders = await computeClientCreditDueFromOrders(clientId);
  const client = await Client.findById(clientId).select('openingDebitBalance').lean();
  const opening = Math.round((Number(client?.openingDebitBalance) || 0) * 100) / 100;
  return Math.round((fromOrders + opening) * 100) / 100;
}
