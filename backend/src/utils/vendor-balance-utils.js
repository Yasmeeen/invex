import Order from '../DB/models/order.model.js';

export function orderAmountRemaining(order) {
  const total = Number(order?.totalPrice) || 0;
  const paid = Number(order?.amountPaid) || 0;
  return Math.max(0, Math.round((total - paid) * 100) / 100);
}

/** Unpaid supplier sales only (excludes purchase payables). */
export async function computeSupplierOwesFromOrders(vendorId) {
  const orders = await Order.find({
    partyType: 'supplier',
    vendorId,
    status: { $ne: 'restored' },
  }).lean();

  let total = 0;
  for (const o of orders) {
    total += orderAmountRemaining(o);
  }
  return Math.round(total * 100) / 100;
}

/** Unpaid balances on supplier sales (مدين — المورد عليه). */
export async function computeSupplierOwesUs(vendorId) {
  return computeSupplierOwesFromOrders(vendorId);
}
