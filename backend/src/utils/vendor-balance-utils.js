import Order from '../DB/models/order.model.js';
import Vendor from '../DB/models/vendor.model.js';

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

/** Batch unpaid supplier-sale remainings keyed by vendorId string. */
export async function computeSupplierOwesFromOrdersByVendorIds(vendorIds) {
  const ids = (vendorIds || []).filter(Boolean);
  const map = new Map(ids.map((id) => [String(id), 0]));
  if (!ids.length) return map;

  const orders = await Order.find({
    partyType: 'supplier',
    vendorId: { $in: ids },
    status: { $ne: 'restored' },
  })
    .select('vendorId totalPrice amountPaid')
    .lean();

  for (const o of orders) {
    const key = String(o.vendorId);
    map.set(key, Math.round(((map.get(key) || 0) + orderAmountRemaining(o)) * 100) / 100);
  }
  return map;
}

/** Unpaid balances on supplier sales + opening debit (مدين — المورد عليه). */
export async function computeSupplierOwesUs(vendorId) {
  const owesFromOrders = await computeSupplierOwesFromOrders(vendorId);
  const vendor = await Vendor.findById(vendorId).select('openingDebitBalance').lean();
  const opening = Math.round((Number(vendor?.openingDebitBalance) || 0) * 100) / 100;
  return Math.round((owesFromOrders + opening) * 100) / 100;
}
