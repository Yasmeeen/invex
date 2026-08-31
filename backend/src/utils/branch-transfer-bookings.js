import mongoose from 'mongoose';
import ProductBooking from '../DB/models/productBooking.model.js';
import { recalcProductBookingTotals } from '../modules/product_bookings_module/service.js';

export function bookingPickupBranchId(booking) {
  if (String(booking?.pickupType || '') !== 'branch_pickup') {
    return null;
  }
  const pickup = booking.pickupBranch?._id || booking.pickupBranch;
  if (pickup) {
    return String(pickup);
  }
  const legacy = booking.branch?._id || booking.branch;
  return legacy ? String(legacy) : null;
}

export function bookingPickupBranchName(booking) {
  const fromPickup = booking?.pickupBranch;
  if (fromPickup && typeof fromPickup === 'object' && String(fromPickup.name || '').trim()) {
    return String(fromPickup.name).trim();
  }
  const fromBranch = booking?.branch;
  if (fromBranch && typeof fromBranch === 'object' && String(fromBranch.name || '').trim()) {
    return String(fromBranch.name).trim();
  }
  return String(booking?.shippingAddress || '').trim();
}

export function transferAvailableQty({ stock, bookedTotal, transferReserved, bookedForDestination }) {
  const st = Math.max(0, Number(stock) || 0);
  const booked = Math.max(0, Number(bookedTotal) || 0);
  const reserved = Math.max(0, Number(transferReserved) || 0);
  const extra = Math.max(0, Number(bookedForDestination) || 0);
  const free = Math.max(0, st - booked - reserved);
  return free + extra;
}

export async function bookedQuantityForPickupBranch(productOid, toBranchId, { session } = {}) {
  const dest = String(toBranchId || '');
  if (!dest || !productOid) {
    return 0;
  }
  const oid =
    productOid instanceof mongoose.Types.ObjectId
      ? productOid
      : new mongoose.Types.ObjectId(String(productOid));
  const q = ProductBooking.find({
    product: oid,
    status: 'active',
    pickupType: 'branch_pickup',
  }).select('quantity pickupBranch branch pickupType');
  if (session) {
    q.session(session);
  }
  const rows = await q.lean();
  let total = 0;
  for (const b of rows) {
    if (bookingPickupBranchId(b) === dest) {
      total += Math.max(1, Math.floor(Number(b.quantity) || 1));
    }
  }
  return total;
}

/**
 * Move oldest pickup bookings whose pickup branch is the transfer destination.
 * Whole bookings only (no split).
 */
export async function movePickupBookingsWithTransfer({
  sourceProductId,
  destinationProduct,
  toBranchId,
  quantity,
  session,
}) {
  const dest = String(toBranchId || '');
  const destProductId = destinationProduct?._id;
  let remaining = Math.max(0, Math.floor(Number(quantity) || 0));
  if (!dest || !destProductId || remaining < 1 || !sourceProductId) {
    return [];
  }

  const q = ProductBooking.find({
    product: sourceProductId,
    status: 'active',
    pickupType: 'branch_pickup',
  }).sort({ createdAt: 1 });
  if (session) {
    q.session(session);
  }
  const list = await q;
  const moved = [];
  for (const booking of list) {
    if (remaining <= 0) {
      break;
    }
    if (bookingPickupBranchId(booking) !== dest) {
      continue;
    }
    const qty = Math.max(1, Math.floor(Number(booking.quantity) || 1));
    if (qty > remaining) {
      continue;
    }
    booking.product = destProductId;
    booking.branch = toBranchId;
    booking.pickupBranch = toBranchId;
    booking.productInWarehouse = false;
    await booking.save(session ? { session } : undefined);
    remaining -= qty;
    moved.push(booking);
  }

  if (moved.length) {
    await recalcProductBookingTotals(sourceProductId, { session });
    await recalcProductBookingTotals(destProductId, { session });
  }
  return moved;
}

export async function attachRemotePickupTransfers(productDocs) {
  const list = (Array.isArray(productDocs) ? productDocs : [productDocs]).filter(Boolean);
  if (!list.length) {
    return productDocs;
  }
  const ids = list.map((p) => p._id).filter(Boolean);
  const bookings = await ProductBooking.find({
    product: { $in: ids },
    status: 'active',
    pickupType: 'branch_pickup',
  })
    .select('product quantity pickupBranch branch pickupType shippingAddress')
    .populate('pickupBranch', 'name')
    .populate('branch', 'name')
    .lean();

  const byProduct = new Map();
  for (const b of bookings) {
    const pid = String(b.product);
    if (!byProduct.has(pid)) {
      byProduct.set(pid, []);
    }
    byProduct.get(pid).push(b);
  }

  for (const p of list) {
    const loc = p.branch?._id || p.branch;
    const locStr = loc ? String(loc) : '';
    const rows = byProduct.get(String(p._id)) || [];
    const map = new Map();
    for (const b of rows) {
      const destId = bookingPickupBranchId(b);
      if (!destId || destId === locStr) {
        continue;
      }
      const name = bookingPickupBranchName(b);
      const prev = map.get(destId) || { branchId: destId, branchName: name, quantity: 0 };
      prev.quantity += Math.max(1, Math.floor(Number(b.quantity) || 1));
      if (name) {
        prev.branchName = name;
      }
      map.set(destId, prev);
    }
    p.remotePickupTransfers = [...map.values()];
  }
  return productDocs;
}
