import mongoose from 'mongoose';
import ProductBooking from '../../DB/models/productBooking.model.js';
import Product from '../../DB/models/product.model.js';
import Client from '../../DB/models/client.model.js';
import User from '../../DB/models/user.model.js';
import Notification from '../../DB/models/notification.model.js';
import { emitToUsers } from '../../realtime/socket.js';
import Branch from '../../DB/models/branch.model.js';

const ADMIN_ROLES = ['Super Admin', 'Co Admin'];

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

async function findOrCreateClient({ name, phone, address, branchOid }) {
  const existing = await findClientByPhone(phone);
  if (existing) {
    return existing;
  }
  const phoneNumber = canonicalPhoneForStorage(phone);
  if (!phoneNumber) {
    throw new Error('INVALID_PHONE');
  }
  const doc = {
    name: String(name || '').trim() || 'Customer',
    phoneNumber,
    address: String(address || '').trim(),
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

async function recalcProductBookingTotals(productId) {
  const pid = new mongoose.Types.ObjectId(String(productId));
  const total = await sumActiveBookedQuantity(pid);
  await Product.updateOne(
    { _id: pid },
    {
      $set: {
        bookedQuantity: total,
        bookingStatus: total > 0 ? 'active' : 'none',
        activeBooking: null,
      },
    }
  );
  return total;
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
      depositAmount,
      bookingDate,
      userId,
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
    if (pickupType === 'online_shipping' && !String(shippingAddress || '').trim()) {
      return res.status(400).json({ error: 'Shipping address is required for online shipping' });
    }
    const dep = Number(depositAmount);
    if (Number.isNaN(dep) || dep < 0) {
      return res.status(400).json({ error: 'Valid deposit amount is required' });
    }
    if (!bookingDate) {
      return res.status(400).json({ error: 'Booking date is required' });
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
    if (alreadyBooked + quantity > product.stock) {
      return res.status(400).json({
        error: `Only ${Math.max(0, product.stock - alreadyBooked)} unit(s) available to book`,
      });
    }

    const branchOid = product.branch || null;

    let client;
    try {
      client = await findOrCreateClient({
        name: customerName,
        phone: customerPhone,
        address: pickupType === 'online_shipping' ? shippingAddress : '',
        branchOid,
      });
    } catch (e) {
      if (e.message === 'INVALID_PHONE') {
        return res.status(400).json({ error: 'Invalid phone number' });
      }
      if (e.code === 11000) {
        return res.status(409).json({ error: 'Phone number already registered' });
      }
      throw e;
    }

    const booking = await ProductBooking.create({
      product,
      branch: branchOid,
      productInWarehouse: !!product.inWarehouse,
      client: client._id,
      customerName: String(customerName).trim(),
      customerPhone: String(customerPhone).trim(),
      quantity,
      pickupType,
      shippingAddress: String(shippingAddress || '').trim(),
      depositAmount: dep,
      bookingDate: new Date(bookingDate),
      status: 'active',
      createdBy: userId,
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

    booking.confirmed = true;
    booking.confirmedAt = new Date();
    booking.confirmedBy = userId;
    await booking.save();

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

    const admin = await isStoreAdmin(userId);
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
      .select('stock name code branch inWarehouse')
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

    const availableToBook = Math.max(0, (product.stock || 0) - totalBookedQty);

    return res.json({
      bookings,
      summary: {
        totalBookedQty,
        stock: product.stock,
        availableToBook,
      },
    });
  } catch (error) {
    console.error('❌ getBookingByProductId:', error.message);
    return res.status(500).json({ error: 'Failed to fetch bookings' });
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
        .populate('product', 'name code price branch inWarehouse stock bookedQuantity')
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
