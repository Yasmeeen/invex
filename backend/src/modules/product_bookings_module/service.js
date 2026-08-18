import mongoose from 'mongoose';
import ProductBooking from '../../DB/models/productBooking.model.js';
import Product from '../../DB/models/product.model.js';
import Client from '../../DB/models/client.model.js';
import User from '../../DB/models/user.model.js';
import Notification from '../../DB/models/notification.model.js';
import { emitToUsers } from '../../realtime/socket.js';
import Branch from '../../DB/models/branch.model.js';
import { auditLog } from '../audit_module/audit.service.js';
import {
  buildTreasurySplitsFromPayment,
  cashAmountFromPaymentSplits,
  isPhysicalCashMethod,
  normalizePaymentFeeAllocations,
  normalizePaymentSplitsRaw,
  totalNetFromPaymentSplits,
} from '../../utils/deposit-payment-splits.js';
import { recordClientCashDrawerReceipt } from '../../utils/client-cash-drawer.js';
import { postPaymentMethodInflows, safeTreasuryPost } from '../../utils/treasury-ledger.js';

const ADMIN_ROLES = ['Super Admin', 'Co Admin'];

/** Allow https (Cloudinary) or http (local /uploads in dev). */
const normalizeDepositProofUrl = (raw) => {
  if (raw == null || raw === '') return '';
  const s = String(raw).trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) return '';
  return s.slice(0, 2048);
};

const MAX_DEPOSIT_PROOF_IMAGES = 10;

function collectDepositProofUrls(depositTransferImageUrl, depositTransferImageUrls) {
  const out = [];
  const push = (u) => {
    const n = normalizeDepositProofUrl(u);
    if (n && !out.includes(n)) {
      out.push(n);
    }
  };
  if (Array.isArray(depositTransferImageUrls)) {
    depositTransferImageUrls.forEach(push);
  }
  push(depositTransferImageUrl);
  return out.slice(0, MAX_DEPOSIT_PROOF_IMAGES);
}

function bookingListMatchForViewer({ productId, product, viewerUserId, viewer }) {
  const pidOid = new mongoose.Types.ObjectId(String(productId));
  const viewerOid = new mongoose.Types.ObjectId(String(viewerUserId));
  const match = {
    product: pidOid,
    status: 'active',
  };

  if (viewer && ADMIN_ROLES.includes(viewer.role)) {
    return match;
  }

  if (viewer?.role === 'Branch Manager' && viewer.branch) {
    const ub = String(viewer.branch);
    if (product?.inWarehouse) {
      match.createdBy = viewerOid;
      return match;
    }
    const pBranch = product?.branch ? String(product.branch) : '';
    if (pBranch && pBranch === ub) {
      match.branch = new mongoose.Types.ObjectId(ub);
      return match;
    }
  }

  match.createdBy = viewerOid;
  return match;
}

function digitsOnly(s) {
  return String(s || '').replace(/\D/g, '');
}

function buildPhoneSearchCandidates(raw) {
  const decoded = decodeURIComponent(String(raw || '').trim());
  const d = digitsOnly(decoded);
  const set = new Set([decoded, d].filter(Boolean));
  if (d.length >= 10) {
    const last10 = d.slice(-10);
    set.add(last10);
    set.add(`0${last10}`);
    set.add(`20${last10}`);
    set.add(`+20${last10}`);
    set.add(`0020${last10}`);
    if (d.startsWith('20') && d.length >= 12) {
      set.add(`0${d.slice(2)}`);
    }
  }
  return [...set].filter(Boolean);
}

async function findClientByPhone(raw) {
  const candidates = buildPhoneSearchCandidates(raw);
  const last10 = digitsOnly(raw).slice(-10);
  let client = await Client.findOne({ phoneNumber: { $in: candidates } });
  if (!client && last10 && last10.length === 10) {
    client = await Client.findOne({
      phoneNumber: { $regex: new RegExp(`${last10}$`) },
    });
  }
  return client;
}

function canonicalPhoneForStorage(raw) {
  const d = digitsOnly(raw);
  if (d.length >= 10) {
    const last10 = d.slice(-10);
    return `0${last10}`;
  }
  return String(raw || '').trim();
}

async function findOrCreateClient({ name, phone, registeredAddress, branchOid }) {
  const existing = await findClientByPhone(phone);
  if (existing) {
    return existing;
  }
  const phoneNumber = canonicalPhoneForStorage(phone);
  if (!phoneNumber) {
    throw new Error('INVALID_PHONE');
  }
  const addr = String(registeredAddress || '').trim();
  if (!addr) {
    throw new Error('INVALID_REGISTERED_ADDRESS');
  }
  const doc = {
    name: String(name || '').trim() || 'Customer',
    phoneNumber,
    address: addr,
    branches: branchOid && mongoose.Types.ObjectId.isValid(String(branchOid)) ? [branchOid] : [],
  };
  return Client.create(doc);
}

async function sumActiveBookedQuantity(productOid) {
  const [agg] = await ProductBooking.aggregate([
    { $match: { product: productOid, status: 'active' } },
    { $group: { _id: null, total: { $sum: { $ifNull: ['$quantity', 1] } } } },
  ]);
  return agg?.total || 0;
}

async function sumActiveConfirmedBookedQuantity(productOid) {
  const [agg] = await ProductBooking.aggregate([
    { $match: { product: productOid, status: 'active', confirmed: true } },
    { $group: { _id: null, total: { $sum: { $ifNull: ['$quantity', 1] } } } },
  ]);
  return agg?.total || 0;
}

async function recalcProductBookingTotals(productId) {
  const pid = new mongoose.Types.ObjectId(String(productId));
  const total = await sumActiveBookedQuantity(pid);
  const confirmedTotal = await sumActiveConfirmedBookedQuantity(pid);
  await Product.updateOne(
    { _id: pid },
    {
      $set: {
        bookedQuantity: total,
        confirmedBookedQuantity: confirmedTotal,
        bookingStatus: total > 0 ? 'active' : 'none',
        activeBooking: null,
      },
    }
  );
  return total;
}

/**
 * After stock drops (sale), active reservations must not exceed current stock.
 * Cancels / shrinks oldest active bookings until bookedQty <= stock.
 */
export async function reconcileBookingsToStock(productId, { userId, reason } = {}) {
  if (!productId || !mongoose.Types.ObjectId.isValid(String(productId))) {
    return { trimmed: 0 };
  }
  const pid = new mongoose.Types.ObjectId(String(productId));
  const product = await Product.findById(pid).select('stock').lean();
  if (!product) {
    return { trimmed: 0 };
  }
  const stock = Math.max(0, Math.floor(Number(product.stock) || 0));
  let booked = await sumActiveBookedQuantity(pid);
  if (booked <= stock) {
    await recalcProductBookingTotals(pid);
    return { trimmed: 0 };
  }

  let excess = booked - stock;
  const bookings = await ProductBooking.find({ product: pid, status: 'active' }).sort({
    createdAt: 1,
  });
  const uid =
    userId && mongoose.Types.ObjectId.isValid(String(userId))
      ? new mongoose.Types.ObjectId(String(userId))
      : undefined;
  const cancelReason = String(reason || 'Released: stock no longer covers reservation').slice(0, 500);
  let trimmed = 0;

  for (const b of bookings) {
    if (excess <= 0) break;
    const q = Math.max(1, Math.floor(Number(b.quantity) || 1));
    const dep = Math.round((Number(b.depositAmount) || 0) * 100) / 100;
    if (q <= excess) {
      b.status = 'cancelled';
      b.cancelledAt = new Date();
      if (uid) b.cancelledBy = uid;
      b.cancelReason = cancelReason;
      b.depositAmount = 0;
      await b.save();
      excess -= q;
      trimmed += q;
    } else {
      const remainQty = q - excess;
      const remainDep = Math.round(dep * (remainQty / q) * 100) / 100;
      b.quantity = remainQty;
      b.depositAmount = remainDep;
      await b.save();
      trimmed += excess;
      excess = 0;
    }
  }

  await recalcProductBookingTotals(pid);
  return { trimmed };
}

async function isStoreAdmin(userId) {
  if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) {
    return false;
  }
  const u = await User.findById(userId).select('role').lean();
  return u && ADMIN_ROLES.includes(u.role);
}

/** Super Admin / Co Admin: any booking. Branch Manager: branch stock only (not central warehouse). */
async function assertUserMayConfirmBooking(userId, booking) {
  if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) {
    const err = new Error('FORBIDDEN');
    err.code = 'FORBIDDEN';
    throw err;
  }
  const u = await User.findById(userId).select('role branch name').lean();
  if (!u) {
    const err = new Error('FORBIDDEN');
    err.code = 'FORBIDDEN';
    throw err;
  }
  if (ADMIN_ROLES.includes(u.role)) {
    return u;
  }
  if (u.role !== 'Branch Manager') {
    const err = new Error('FORBIDDEN');
    err.code = 'FORBIDDEN';
    throw err;
  }
  if (booking.productInWarehouse) {
    const err = new Error('BRANCH_ONLY');
    err.code = 'BRANCH_ONLY';
    throw err;
  }
  const bid = booking.branch ? String(booking.branch) : '';
  const ub = u.branch ? String(u.branch) : '';
  if (!bid || !ub || bid !== ub) {
    const err = new Error('FORBIDDEN');
    err.code = 'FORBIDDEN';
    throw err;
  }
  return u;
}

export const createProductBooking = async (req, res) => {
  try {
    const {
      productId,
      quantity: qtyRaw,
      customerName,
      customerPhone,
      pickupType,
      shippingAddress,
      registeredAddress,
      depositAmount,
      paymentSplits,
      paymentMethodSplits,
      paymentFeeAllocations,
      depositTransferImageUrl,
      depositTransferImageUrls,
      transferReferencePhone,
      userId,
      branchId: branchIdBody,
    } = req.body;

    if (!productId || !mongoose.Types.ObjectId.isValid(String(productId))) {
      return res.status(400).json({ error: 'Valid productId is required' });
    }
    const quantity = Math.max(1, Math.floor(Number(qtyRaw)) || 1);
    if (!customerName || !String(customerName).trim()) {
      return res.status(400).json({ error: 'Customer name is required' });
    }
    if (!customerPhone || !String(customerPhone).trim()) {
      return res.status(400).json({ error: 'Customer phone is required' });
    }
    if (!['branch_pickup', 'online_shipping'].includes(pickupType)) {
      return res.status(400).json({ error: 'Invalid pickup type' });
    }
    const registeredAddrTrim = String(registeredAddress ?? '').trim();
    const shippingAddrTrim = String(shippingAddress ?? '').trim();
    if (pickupType === 'online_shipping' && !shippingAddrTrim) {
      return res.status(400).json({ error: 'Shipping address is required for online shipping' });
    }
    if (
      pickupType === 'online_shipping' &&
      registeredAddrTrim &&
      shippingAddrTrim &&
      registeredAddrTrim === shippingAddrTrim
    ) {
      return res
        .status(400)
        .json({ error: 'Shipping address must differ from the registered customer address' });
    }

    const splitsRaw = paymentSplits ?? paymentMethodSplits;
    let depositPayments = normalizePaymentSplitsRaw(splitsRaw);
    const feeAllocations = normalizePaymentFeeAllocations(paymentFeeAllocations);

    let dep;
    if (depositPayments.length) {
      dep = totalNetFromPaymentSplits(depositPayments);
    } else {
      dep = Number(depositAmount);
      if (Number.isNaN(dep) || dep < 0) {
        return res.status(400).json({ error: 'Valid deposit amount is required' });
      }
      dep = Math.round(dep * 100) / 100;
      if (dep > 0) {
        // Legacy clients: treat plain deposit amount as cash so drawer still updates.
        depositPayments = [{ method: 'cash', amount: dep }];
      }
    }

    const depositProofUrls = collectDepositProofUrls(depositTransferImageUrl, depositTransferImageUrls);
    if (depositProofUrls.length > MAX_DEPOSIT_PROOF_IMAGES) {
      return res.status(400).json({ error: `At most ${MAX_DEPOSIT_PROOF_IMAGES} deposit images allowed` });
    }
    // Legacy: reject invalid single URL if client sent only invalid URL and no valid URLs in array
    const hadSingleRaw = depositTransferImageUrl != null && String(depositTransferImageUrl).trim() !== '';
    if (
      hadSingleRaw &&
      depositProofUrls.length === 0 &&
      (!Array.isArray(depositTransferImageUrls) || depositTransferImageUrls.length === 0)
    ) {
      return res.status(400).json({ error: 'Invalid deposit transfer image URL' });
    }
    if (Array.isArray(depositTransferImageUrls) && depositTransferImageUrls.length > 0 && depositProofUrls.length === 0) {
      return res.status(400).json({ error: 'Invalid deposit transfer image URL(s)' });
    }

    const hasNonCashDeposit = depositPayments.some((s) => !isPhysicalCashMethod(s.method));
    const transferRefRaw = String(transferReferencePhone || '').trim();
    const needsTransferRef = hasNonCashDeposit || depositProofUrls.length > 0;
    if (needsTransferRef && !transferRefRaw) {
      return res
        .status(400)
        .json({ error: 'Transfer reference phone is required when non-cash deposit or transfer proof is provided' });
    }
    let transferRefStored = '';
    if (transferRefRaw) {
      const transferRefDigits = digitsOnly(transferRefRaw);
      if (transferRefDigits.length < 10) {
        return res.status(400).json({ error: 'Invalid transfer reference phone' });
      }
      transferRefStored = canonicalPhoneForStorage(transferRefRaw);
    }
    if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    const pid = product._id;
    const alreadyBooked = await sumActiveBookedQuantity(pid);
    const transferReserved = Number(product.transferReservedQuantity) || 0;
    const capacity = Math.max(0, Number(product.stock) - transferReserved);
    if (alreadyBooked + quantity > capacity) {
      return res.status(400).json({
        error: `Only ${Math.max(0, capacity - alreadyBooked)} unit(s) available to book`,
      });
    }

    const branchOid = product.branch || null;
    const unitPrice = Math.round((Number(product.price) || 0) * 100) / 100;

    let client;
    try {
      client = await findOrCreateClient({
        name: customerName,
        phone: customerPhone,
        registeredAddress: registeredAddrTrim,
        branchOid,
      });
    } catch (e) {
      if (e.message === 'INVALID_PHONE') {
        return res.status(400).json({ error: 'Invalid phone number' });
      }
      if (e.message === 'INVALID_REGISTERED_ADDRESS') {
        return res.status(400).json({
          error: 'Registered address is required for new customers',
        });
      }
      if (e.code === 11000) {
        return res.status(409).json({ error: 'Phone number already registered' });
      }
      throw e;
    }

    const booking = await ProductBooking.create({
      product: pid,
      branch: branchOid,
      productInWarehouse: !!product.inWarehouse,
      client: client._id,
      customerName: String(customerName).trim(),
      customerPhone: String(customerPhone).trim(),
      quantity,
      pickupType,
      shippingAddress: String(shippingAddress || '').trim(),
      depositAmount: dep,
      depositPayments,
      depositPaymentFeeAllocations: feeAllocations,
      productUnitPrice: unitPrice,
      productNameSnapshot: String(product.name || '').trim(),
      productCodeSnapshot: String(product.code || '').trim(),
      depositTransferImageUrls: depositProofUrls,
      depositTransferImageUrl: depositProofUrls[0] || '',
      transferReferencePhone: transferRefStored,
      bookingDate: new Date(),
      status: 'active',
      createdBy: userId,
    });

    const cashDrawerAmount = cashAmountFromPaymentSplits(depositPayments, feeAllocations);
    if (cashDrawerAmount > 0) {
      const treasuryAudit = buildTreasurySplitsFromPayment(depositPayments, feeAllocations);
      try {
        await recordClientCashDrawerReceipt({
          branchId: branchIdBody || branchOid,
          userId,
          clientId: client._id,
          amount: cashDrawerAmount,
          paymentType: 'booking_deposit',
          note: `Booking deposit — ${product.name || product.code || booking._id}`,
          paymentTreasurySplits: treasuryAudit,
        });
      } catch (drawerErr) {
        console.warn('⚠️ booking cash drawer receipt:', drawerErr?.message || drawerErr);
      }
    }

    await safeTreasuryPost('booking_deposit', async () => {
      await postPaymentMethodInflows({
        branchId: branchOid,
        methodAmounts: depositPayments,
        feeAllocations,
        sourceType: 'booking_deposit',
        sourceId: booking._id,
        note: `Booking deposit — ${product.name || product.code || booking._id}`,
        createdBy: userId,
      });
    });

    await recalcProductBookingTotals(pid);

    const populated = await ProductBooking.findById(booking._id)
      .populate('createdBy', 'name')
      .populate('client', 'name phoneNumber');

    // Persist + emit notification (Super Admin / Co Admin / all Branch Managers)
    try {
      const recipients = await User.find({
        role: { $in: ['Super Admin', 'Co Admin', 'Branch Manager'] },
      })
        .select('_id role branch')
        .lean();
      const recipientIds = recipients.map((u) => u._id);

      const branchId = product.branch || null;
      const branchName = branchId
        ? (await Branch.findById(branchId).select('name').lean())?.name || null
        : null;
      const locationLabel = product.inWarehouse
        ? 'Warehouse'
        : branchName
          ? branchName
          : 'Branch';

      const notification = await Notification.create({
        type: 'booking_created',
        title: 'New booking',
        body: `${product.name} ×${quantity} (${locationLabel})`,
        data: {
          bookingId: booking._id,
          productId: product._id,
          productName: product.name,
          productCode: product.code,
          quantity,
          branchId,
          branchName,
          inWarehouse: !!product.inWarehouse,
          createdById: userId,
          bookingDate: booking.bookingDate,
        },
        recipients: recipientIds,
        readBy: [],
      });

      emitToUsers(recipientIds, 'notification:new', {
        notification,
      });
    } catch (notifyErr) {
      console.warn('⚠️ booking notification:', notifyErr?.message || notifyErr);
    }

    await auditLog(req, {
      action: 'create',
      module: 'bookings',
      entityType: 'ProductBooking',
      entityId: booking?._id,
      message: `Booking created ${product?.code || ''}`.trim(),
      entityLabel:
        product?.code && product?.name
          ? `${product.code} — ${product.name} ×${quantity}`
          : undefined,
      metadata: {
        productId: pid,
        productCode: product?.code,
        productName: product?.name,
        quantity,
        pickupType,
        depositAmount: dep,
        bookingDate: booking.bookingDate,
        branchId: branchOid,
        inWarehouse: !!product.inWarehouse,
        customerName: booking.customerName,
        status: booking.status,
      },
      after: { status: booking.status, confirmed: booking.confirmed || false },
    });

    return res.status(201).json({
      message: '✅ Booking created',
      booking: populated,
    });
  } catch (error) {
    console.error('❌ createProductBooking:', error.message);
    return res.status(500).json({ error: 'Failed to create booking' });
  }
};

export const confirmProductBooking = async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.body;

    if (!mongoose.Types.ObjectId.isValid(String(id))) {
      return res.status(400).json({ error: 'Invalid booking id' });
    }
    if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const booking = await ProductBooking.findById(id);
    if (!booking || booking.status !== 'active') {
      return res.status(404).json({ error: 'Active booking not found' });
    }
    if (booking.confirmed) {
      return res.status(400).json({ error: 'Booking already confirmed' });
    }

    let actor;
    try {
      actor = await assertUserMayConfirmBooking(userId, booking);
    } catch (e) {
      if (e.code === 'BRANCH_ONLY') {
        return res.status(403).json({
          error: 'Only store admins can confirm warehouse bookings',
        });
      }
      return res.status(403).json({ error: 'You are not allowed to confirm this booking' });
    }

    const productForStock = await Product.findById(booking.product)
      .select('stock transferReservedQuantity')
      .lean();
    if (!productForStock) {
      return res.status(404).json({ error: 'Product not found' });
    }
    const totalBookedQty = await sumActiveBookedQuantity(booking.product);
    const stock = Math.max(0, Number(productForStock.stock) || 0);
    const transferReserved = Number(productForStock.transferReservedQuantity) || 0;
    const capacity = Math.max(0, stock - transferReserved);
    if (totalBookedQty > capacity) {
      return res.status(400).json({
        error: 'Not enough stock to confirm bookings for this product',
        code: 'INSUFFICIENT_STOCK_FOR_BOOKING',
      });
    }

    booking.confirmed = true;
    booking.confirmedAt = new Date();
    booking.confirmedBy = userId;
    await booking.save();
    await recalcProductBookingTotals(booking.product);

    const populated = await ProductBooking.findById(booking._id)
      .populate('confirmedBy', 'name')
      .populate('createdBy', 'name')
      .lean();

    const product = await Product.findById(booking.product).select('name code branch inWarehouse').lean();

    const creatorId = booking.createdBy ? String(booking.createdBy) : '';
    if (creatorId && creatorId !== String(userId)) {
      try {
        const branchId = product?.branch || booking.branch || null;
        const branchName = branchId
          ? (await Branch.findById(branchId).select('name').lean())?.name || null
          : null;
        const locationLabel = product?.inWarehouse
          ? 'Warehouse'
          : branchName || 'Branch';

        const confirmerName = (actor && actor.name) || 'Manager';

        const notification = await Notification.create({
          type: 'booking_confirmed',
          title: 'Booking confirmed',
          body: `${product?.name || 'Product'} — confirmed by ${confirmerName} (${locationLabel})`,
          data: {
            bookingId: booking._id,
            productId: product?._id,
            productName: product?.name,
            productCode: product?.code,
            confirmedById: userId,
            confirmedByName: confirmerName,
            branchId,
            branchName,
            inWarehouse: !!product?.inWarehouse,
            quantity: booking.quantity,
          },
          recipients: [booking.createdBy],
          readBy: [],
        });

        emitToUsers([booking.createdBy], 'notification:new', { notification });
      } catch (notifyErr) {
        console.warn('⚠️ booking confirm notification:', notifyErr?.message || notifyErr);
      }
    }

    await auditLog(req, {
      action: 'confirm',
      module: 'bookings',
      entityType: 'ProductBooking',
      entityId: booking?._id,
      message: `Booking confirmed ${booking.productCodeSnapshot || ''}`.trim(),
      entityLabel:
        booking.productCodeSnapshot && booking.productNameSnapshot
          ? `${booking.productCodeSnapshot} — ${booking.productNameSnapshot} ×${booking.quantity}`
          : undefined,
      metadata: {
        productId: booking.product,
        productCode: booking.productCodeSnapshot,
        productName: booking.productNameSnapshot,
        quantity: booking.quantity,
        status: booking.status,
      },
      after: { confirmed: true, confirmedAt: booking.confirmedAt, confirmedBy: booking.confirmedBy, status: booking.status },
    });

    return res.json({
      message: '✅ Booking confirmed',
      booking: populated,
    });
  } catch (error) {
    console.error('❌ confirmProductBooking:', error.message);
    return res.status(500).json({ error: 'Failed to confirm booking' });
  }
};

export const cancelProductBooking = async (req, res) => {
  try {
    const { id } = req.params;
    const { userId, reason } = req.body;

    if (!mongoose.Types.ObjectId.isValid(String(id))) {
      return res.status(400).json({ error: 'Invalid booking id' });
    }
    if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const booking = await ProductBooking.findById(id);
    if (!booking || booking.status !== 'active') {
      return res.status(404).json({ error: 'Active booking not found' });
    }

    const actor = await User.findById(userId).select('role').lean();
    if (!actor) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (actor.role === 'Moderator') {
      return res.status(403).json({ error: 'Moderators cannot cancel bookings' });
    }

    const admin = ADMIN_ROLES.includes(actor.role);
    if (!admin && String(booking.createdBy) !== String(userId)) {
      return res.status(403).json({ error: 'You can only cancel bookings you created' });
    }

    booking.status = 'cancelled';
    booking.cancelledAt = new Date();
    booking.cancelledBy = userId;
    if (reason) {
      booking.cancelReason = String(reason).trim();
    }
    await booking.save();

    await recalcProductBookingTotals(booking.product);

    await auditLog(req, {
      action: 'cancel',
      module: 'bookings',
      entityType: 'ProductBooking',
      entityId: booking?._id,
      message: `Booking cancelled ${booking.productCodeSnapshot || ''}`.trim(),
      entityLabel:
        booking.productCodeSnapshot && booking.productNameSnapshot
          ? `${booking.productCodeSnapshot} — ${booking.productNameSnapshot} ×${booking.quantity}`
          : undefined,
      metadata: {
        reason: booking.cancelReason || '',
        productId: booking.product,
        productCode: booking.productCodeSnapshot,
        productName: booking.productNameSnapshot,
        quantity: booking.quantity,
        status: booking.status,
      },
      after: { status: booking.status, cancelledAt: booking.cancelledAt, cancelledBy: booking.cancelledBy },
    });

    return res.json({ message: '✅ Booking cancelled' });
  } catch (error) {
    console.error('❌ cancelProductBooking:', error.message);
    return res.status(500).json({ error: 'Failed to cancel booking' });
  }
};

/** Listings filtered: non-admins only see their own active bookings. Summary totals are store-wide. */
export const getBookingByProductId = async (req, res) => {
  try {
    const { productId } = req.params;
    const { viewerUserId } = req.query;

    if (!mongoose.Types.ObjectId.isValid(String(productId))) {
      return res.status(400).json({ error: 'Invalid product id' });
    }
    if (!viewerUserId || !mongoose.Types.ObjectId.isValid(String(viewerUserId))) {
      return res.status(400).json({ error: 'viewerUserId query is required' });
    }

    const product = await Product.findById(productId)
      .select('stock name code branch inWarehouse transferReservedQuantity')
      .lean();
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const viewer = await User.findById(viewerUserId).select('role branch').lean();
    const match = bookingListMatchForViewer({
      productId,
      product,
      viewerUserId,
      viewer,
    });

    const [bookings, totalBookedQty] = await Promise.all([
      ProductBooking.find(match)
        .sort({ createdAt: -1 })
        .populate('createdBy', 'name _id')
        .populate('confirmedBy', 'name _id')
        .populate('client', 'name phoneNumber address')
        .lean(),
      sumActiveBookedQuantity(new mongoose.Types.ObjectId(String(productId))),
    ]);

    const transferReserved = Number(product.transferReservedQuantity) || 0;
    const capacity = Math.max(0, (product.stock || 0) - transferReserved);
    const availableToBook = Math.max(0, capacity - totalBookedQty);

    return res.json({
      bookings,
      summary: {
        totalBookedQty,
        stock: product.stock,
        transferReservedQuantity: transferReserved,
        availableToBook,
      },
    });
  } catch (error) {
    console.error('❌ getBookingByProductId:', error.message);
    return res.status(500).json({ error: 'Failed to fetch bookings' });
  }
};

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildBookingsReportMatch(query) {
  const {
    from,
    to,
    branch_id: branchId,
    product_id: productId,
    customer_phone: customerPhone,
    created_by: createdBy,
    status,
    confirmed,
    search,
  } = query;

  const match = {};
  if (from || to) {
    match.bookingDate = {};
    if (from) {
      match.bookingDate.$gte = new Date(from);
    }
    if (to) {
      const t = new Date(to);
      t.setHours(23, 59, 59, 999);
      match.bookingDate.$lte = t;
    }
  }
  if (branchId && mongoose.Types.ObjectId.isValid(String(branchId))) {
    match.branch = new mongoose.Types.ObjectId(String(branchId));
  }
  if (productId && mongoose.Types.ObjectId.isValid(String(productId))) {
    match.product = new mongoose.Types.ObjectId(String(productId));
  }
  if (createdBy && mongoose.Types.ObjectId.isValid(String(createdBy))) {
    match.createdBy = new mongoose.Types.ObjectId(String(createdBy));
  }
  if (status === 'active' || status === 'cancelled') {
    match.status = status;
  }
  if (confirmed === 'true') {
    match.confirmed = true;
  }
  if (confirmed === 'false') {
    match.confirmed = false;
  }
  /* warehouse_only is applied in getBookingsReport via Product.inWarehouse (current stock location). */

  const extraAnd = [];
  if (customerPhone && String(customerPhone).trim()) {
    extraAnd.push({
      customerPhone: new RegExp(escapeRegex(String(customerPhone).trim()), 'i'),
    });
  }
  if (search && String(search).trim()) {
    const s = escapeRegex(String(search).trim());
    extraAnd.push({
      $or: [{ customerPhone: new RegExp(s, 'i') }, { customerName: new RegExp(s, 'i') }],
    });
  }
  if (extraAnd.length === 1) {
    Object.assign(match, extraAnd[0]);
  } else if (extraAnd.length > 1) {
    match.$and = [...(match.$and || []), ...extraAnd];
  }

  return match;
}

/**
 * Limit bookings to products that currently have warehouse stock (Product.inWarehouse === true).
 * Booking.productInWarehouse is historical and does not update when a product is moved.
 */
async function applyWarehouseOnlyProductFilter(match, query) {
  const wo = query.warehouse_only === 'true' || query.warehouse_only === true;
  if (!wo) return;
  const whIds = await Product.find({ inWarehouse: true }).distinct('_id');
  const allowed = new Set(whIds.map((id) => String(id)));
  if (match.product) {
    const pid = String(match.product);
    if (!allowed.has(pid)) {
      match.product = { $in: [] };
    }
  } else {
    match.product = whIds.length ? { $in: whIds } : { $in: [] };
  }
}

/** Analytics + paginated rows for reports UI (branch from ng-select → branch_id). */
export const getBookingsReport = async (req, res) => {
  try {
    const match = buildBookingsReportMatch(req.query);
    await applyWarehouseOnlyProductFilter(match, req.query);
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
    const skip = (page - 1) * limit;

    const [agg] = await ProductBooking.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          totalBookings: { $sum: 1 },
          totalUnits: { $sum: { $ifNull: ['$quantity', 1] } },
          totalDeposits: { $sum: { $ifNull: ['$depositAmount', 0] } },
          activeCount: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } },
          cancelledCount: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
          confirmedActive: {
            $sum: {
              $cond: [{ $and: [{ $eq: ['$status', 'active'] }, '$confirmed'] }, 1, 0],
            },
          },
        },
      },
    ]);

    const summary = agg
      ? {
          totalBookings: agg.totalBookings || 0,
          totalUnits: agg.totalUnits || 0,
          totalDeposits: agg.totalDeposits || 0,
          activeCount: agg.activeCount || 0,
          cancelledCount: agg.cancelledCount || 0,
          confirmedActive: agg.confirmedActive || 0,
          pendingConfirmation: Math.max(
            0,
            (agg.activeCount || 0) - (agg.confirmedActive || 0)
          ),
        }
      : {
          totalBookings: 0,
          totalUnits: 0,
          totalDeposits: 0,
          activeCount: 0,
          cancelledCount: 0,
          confirmedActive: 0,
          pendingConfirmation: 0,
        };

    const byBranch = await ProductBooking.aggregate([
      { $match: match },
      { $lookup: { from: 'branches', localField: 'branch', foreignField: '_id', as: 'b' } },
      { $lookup: { from: 'products', localField: 'product', foreignField: '_id', as: 'p' } },
      {
        $addFields: {
          branchLabel: {
            $cond: [
              { $eq: [{ $ifNull: [{ $arrayElemAt: ['$p.inWarehouse', 0] }, false] }, true] },
              'Warehouse',
              { $ifNull: [{ $arrayElemAt: ['$b.name', 0] }, '—'] },
            ],
          },
        },
      },
      {
        $group: {
          _id: '$branchLabel',
          totalBookings: { $sum: 1 },
          totalUnits: { $sum: { $ifNull: ['$quantity', 1] } },
        },
      },
      { $sort: { totalBookings: -1 } },
      { $project: { branchName: '$_id', totalBookings: 1, totalUnits: 1, _id: 0 } },
    ]);

    const topProducts = await ProductBooking.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$product',
          bookingCount: { $sum: 1 },
          totalQty: { $sum: { $ifNull: ['$quantity', 1] } },
        },
      },
      { $sort: { totalQty: -1 } },
      { $limit: 10 },
      { $lookup: { from: 'products', localField: '_id', foreignField: '_id', as: 'p' } },
      {
        $project: {
          productName: { $arrayElemAt: ['$p.name', 0] },
          productCode: { $arrayElemAt: ['$p.code', 0] },
          bookingCount: 1,
          totalQty: 1,
          _id: 0,
        },
      },
    ]);

    const bookingsOverTime = await ProductBooking.aggregate([
      { $match: match },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$bookingDate' } },
          count: { $sum: 1 },
          units: { $sum: { $ifNull: ['$quantity', 1] } },
        },
      },
      { $sort: { _id: 1 } },
      { $project: { period: '$_id', count: 1, units: 1, _id: 0 } },
    ]);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const upcomingMatch = {
      status: 'active',
      bookingDate: { $gte: todayStart },
    };
    if (match.branch) upcomingMatch.branch = match.branch;
    if (match.product) upcomingMatch.product = match.product;
    if (match.customerPhone) upcomingMatch.customerPhone = match.customerPhone;
    if (match.createdBy) upcomingMatch.createdBy = match.createdBy;
    if (match.confirmed === true || match.confirmed === false) {
      upcomingMatch.confirmed = match.confirmed;
    }

    const upcoming = await ProductBooking.find(upcomingMatch)
      .sort({ bookingDate: 1 })
      .limit(15)
      .populate('product', 'name code')
      .populate('branch', 'name')
      .lean();

    const [bookings, totalCount] = await Promise.all([
      ProductBooking.find(match)
        .sort({ bookingDate: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('product', 'name code inWarehouse')
        .populate('branch', 'name')
        .populate('createdBy', 'name')
        .populate('confirmedBy', 'name')
        .populate('client', 'name phoneNumber')
        .lean(),
      ProductBooking.countDocuments(match),
    ]);

    return res.json({
      summary,
      byBranch,
      topProducts,
      bookingsOverTime,
      upcoming,
      bookings,
      meta: {
        totalCount,
        page,
        limit,
      },
    });
  } catch (error) {
    console.error('❌ getBookingsReport:', error.message);
    return res.status(500).json({ error: 'Failed to build bookings report' });
  }
};

export const listProductBookings = async (req, res) => {
  try {
    const {
      status = 'active',
      branch_id: branchId,
      from,
      to,
      page = 1,
      limit = 100,
    } = req.query;

    const match = {};
    if (status === 'active' || status === 'cancelled') {
      match.status = status;
    }
    if (branchId && mongoose.Types.ObjectId.isValid(String(branchId))) {
      match.branch = new mongoose.Types.ObjectId(String(branchId));
    }
    if (from || to) {
      match.bookingDate = {};
      if (from) {
        match.bookingDate.$gte = new Date(from);
      }
      if (to) {
        const t = new Date(to);
        t.setHours(23, 59, 59, 999);
        match.bookingDate.$lte = t;
      }
    }

    const skip = (Math.max(1, Number(page)) - 1) * Math.min(200, Math.max(1, Number(limit)));
    const lim = Math.min(200, Math.max(1, Number(limit)));

    const [bookings, total] = await Promise.all([
      ProductBooking.find(match)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(lim)
        .populate('product', 'name code price branch inWarehouse stock bookedQuantity confirmedBookedQuantity')
        .populate('createdBy', 'name')
        .populate('client', 'name phoneNumber')
        .lean(),
      ProductBooking.countDocuments(match),
    ]);

    return res.json({
      bookings,
      meta: {
        totalCount: total,
        page: Number(page),
        limit: lim,
      },
    });
  } catch (error) {
    console.error('❌ listProductBookings:', error.message);
    return res.status(500).json({ error: 'Failed to list bookings' });
  }
};

/**
 * Cashier: active reservations on a product (who holds them).
 * Used for the red “reserved for customer X” warning at checkout — not viewer-scoped.
 */
export const getActiveReservationsForProduct = async (req, res) => {
  try {
    const productId = String(req.params.productId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ error: 'Invalid product id' });
    }

    const bookings = await ProductBooking.find({
      product: new mongoose.Types.ObjectId(productId),
      status: 'active',
    })
      .sort({ bookingDate: 1, createdAt: 1 })
      .select(
        '_id product client customerName customerPhone quantity depositAmount productUnitPrice confirmed createdAt bookingDate'
      )
      .lean();

    return res.json({
      bookings: (bookings || []).map((b) => ({
        _id: b._id,
        productId: b.product,
        clientId: b.client,
        customerName: b.customerName || '',
        customerPhone: b.customerPhone || '',
        quantity: Math.max(1, Math.floor(Number(b.quantity) || 1)),
        depositAmount: Math.round((Number(b.depositAmount) || 0) * 100) / 100,
        productUnitPrice: Math.round((Number(b.productUnitPrice) || 0) * 100) / 100,
        confirmed: Boolean(b.confirmed),
        createdAt: b.createdAt,
        bookingDate: b.bookingDate,
      })),
    });
  } catch (error) {
    console.error('❌ getActiveReservationsForProduct:', error.message);
    return res.status(500).json({ error: 'Failed to load product reservations' });
  }
};

/**
 * Cashier: active bookings for a client (by phone and/or clientId).
 * Not scoped by viewer — any cashier may apply deposit credit for the matching customer.
 */
export const getActiveBookingsForCheckout = async (req, res) => {
  try {
    const phone = String(req.query.phone || '').trim();
    const clientId = String(req.query.clientId || '').trim();
    const productId = String(req.query.productId || '').trim();

    if (!phone && !clientId) {
      return res.status(400).json({ error: 'phone or clientId is required' });
    }

    const or = [];
    if (clientId && mongoose.Types.ObjectId.isValid(clientId)) {
      or.push({ client: new mongoose.Types.ObjectId(clientId) });
    }
    if (phone) {
      const candidates = buildPhoneSearchCandidates(phone);
      if (candidates.length) {
        or.push({ customerPhone: { $in: candidates } });
        const last10 = digitsOnly(phone).slice(-10);
        if (last10.length === 10) {
          or.push({ customerPhone: { $regex: new RegExp(`${last10}$`) } });
        }
      }
    }
    if (!or.length) {
      return res.json({ bookings: [] });
    }

    const match = {
      status: 'active',
      $or: or,
    };
    if (productId && mongoose.Types.ObjectId.isValid(productId)) {
      match.product = new mongoose.Types.ObjectId(productId);
    }

    const bookings = await ProductBooking.find(match)
      .sort({ createdAt: 1 })
      .select(
        '_id product client customerName customerPhone quantity depositAmount productUnitPrice productNameSnapshot productCodeSnapshot confirmed createdAt bookingDate'
      )
      .populate('product', 'name code price')
      .lean();

    return res.json({
      bookings: (bookings || []).map((b) => ({
        _id: b._id,
        productId: b.product?._id || b.product,
        productName: b.product?.name || b.productNameSnapshot || '',
        productCode: b.product?.code || b.productCodeSnapshot || '',
        clientId: b.client,
        customerName: b.customerName,
        customerPhone: b.customerPhone,
        quantity: Math.max(1, Math.floor(Number(b.quantity) || 1)),
        depositAmount: Math.round((Number(b.depositAmount) || 0) * 100) / 100,
        productUnitPrice: Math.round((Number(b.productUnitPrice) || 0) * 100) / 100,
        confirmed: Boolean(b.confirmed),
        createdAt: b.createdAt,
        bookingDate: b.bookingDate,
      })),
    });
  } catch (error) {
    console.error('❌ getActiveBookingsForCheckout:', error.message);
    return res.status(500).json({ error: 'Failed to load active bookings' });
  }
};

/**
 * Apply deposit credit from bookings on sale.
 * allocations: [{ bookingId, quantityApplied, creditApplied }]
 * Fully consumed bookings are cancelled; partially used bookings shrink qty/deposit.
 */
export async function consumeBookingsForSale({ allocations, userId, orderId, session }) {
  const rows = (Array.isArray(allocations) ? allocations : [])
    .map((a) => ({
      bookingId: String(a?.bookingId || a?._id || '').trim(),
      quantityApplied: Math.max(0, Math.floor(Number(a?.quantityApplied) || 0)),
      creditApplied: Math.round((Number(a?.creditApplied) || 0) * 100) / 100,
    }))
    .filter((a) => mongoose.Types.ObjectId.isValid(a.bookingId) && a.quantityApplied > 0);

  if (!rows.length) {
    return { consumedIds: [], updatedIds: [], creditApplied: 0 };
  }

  const uid =
    userId && mongoose.Types.ObjectId.isValid(String(userId))
      ? new mongoose.Types.ObjectId(String(userId))
      : undefined;

  const consumedIds = [];
  const updatedIds = [];
  let creditApplied = 0;
  const productIds = new Set();

  for (const row of rows) {
    const q = ProductBooking.findOne({
      _id: new mongoose.Types.ObjectId(row.bookingId),
      status: 'active',
    });
    if (session) q.session(session);
    const b = await q;
    if (!b) continue;

    const bookedQty = Math.max(1, Math.floor(Number(b.quantity) || 1));
    const take = Math.min(bookedQty, row.quantityApplied);
    if (take <= 0) continue;

    const dep = Math.round((Number(b.depositAmount) || 0) * 100) / 100;
    const portionCredit =
      row.creditApplied > 0
        ? Math.min(row.creditApplied, dep)
        : Math.round((dep * (take / bookedQty)) * 100) / 100;
    creditApplied += portionCredit;

    if (b.product) productIds.add(String(b.product));

    if (take >= bookedQty) {
      b.status = 'cancelled';
      b.cancelledAt = new Date();
      if (uid) b.cancelledBy = uid;
      b.cancelReason = orderId
        ? `Deposit applied on sale ${orderId}`
        : 'Deposit applied on sale';
      b.depositAmount = 0;
      if (session) await b.save({ session });
      else await b.save();
      consumedIds.push(String(b._id));
    } else {
      const remainQty = bookedQty - take;
      const remainDep = Math.round(Math.max(0, dep - portionCredit) * 100) / 100;
      b.quantity = remainQty;
      b.depositAmount = remainDep;
      if (session) await b.save({ session });
      else await b.save();
      updatedIds.push(String(b._id));
    }
  }

  for (const pid of productIds) {
    await recalcProductBookingTotals(pid);
  }

  return {
    consumedIds,
    updatedIds,
    creditApplied: Math.round(creditApplied * 100) / 100,
  };
}
