import mongoose from 'mongoose';
import Branch from '../../DB/models/branch.model.js';
import Client from '../../DB/models/client.model.js';
import Order from '../../DB/models/order.model.js';
import Product from '../../DB/models/product.model.js';
import Category from '../../DB/models/category.model.js';
import EcommerceChannelReservation from '../../DB/models/ecommerceChannelReservation.model.js';
import OnlineOrder from '../../DB/models/onlineOrder.model.js';
import {
  getIntegrationConfig,
  notifyProductChanged,
  buildCatalogPayload,
  pushFullCatalog,
} from './catalogSync.js';
import { ensureOnlineBranch } from './onlineBranch.js';
import { emitOnlineOrderCreatedAlert } from './crmOrders.js';
import {
  createBookingFromEcommerceOrder,
  cancelBookingsForEcommerceOrder,
  markBookingsPaidOnlineForEcommerceOrder,
  reconcileBookingsToStock,
  recalcProductBookingTotals,
  emitBookingCreatedNotification,
} from '../product_bookings_module/service.js';

function sellable(product) {
  const stock = Number(product.stock) || 0;
  const transfer = Number(product.transferReservedQuantity) || 0;
  const booked = Number(product.bookedQuantity) || 0;
  const ecom = Number(product.ecommerceReservedQuantity) || 0;
  return Math.max(0, stock - transfer - booked - ecom);
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

async function branchForWebsiteOrder() {
  const any = await Branch.findOne().sort({ createdAt: 1 });
  if (any) return any;
  return ensureOnlineBranch();
}

function websiteOrderQuery(ecommerceOrderId) {
  const id = String(ecommerceOrderId || '').trim();
  return {
    channel: 'website',
    $or: [{ crmOrderId: id }, { reservationKey: `ecommerce:${id}` }],
  };
}

function snapshotLine(line) {
  const qty = Math.max(0.001, Number(line?.quantity) || 1);
  const unit = Math.max(0, Number(line?.unitPrice) || 0);
  return {
    name: String(line?.name || 'Product').trim() || 'Product',
    code: String(line?.code || '').trim(),
    imageUrl: String(line?.imageUrl || '').trim(),
    invexProductId: '',
    quantity: qty,
    saleUnit: 'piece',
    basePrice: unit,
    discountPercent: 0,
    unitPrice: unit,
    lineTotal: roundMoney(unit * qty),
    stockSnapshot: 0,
  };
}

/**
 * Orders-only mode: store products stay on the website.
 * The order is recorded under online orders → website, with no Invex stock hold.
 */
async function createWebsiteOrderFromEcommerce(req, res) {
  try {
    const {
      ecommerceOrderId,
      ecommerceOrderNumber,
      customer,
      items,
      pickupType,
      pickupLocation,
      paymentMethod,
      subtotal,
      shippingFee,
      totalAmount,
    } = req.body || {};
    const id = String(ecommerceOrderId || '').trim();
    if (!id || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'ecommerceOrderId and items are required' });
    }

    const existing = await OnlineOrder.findOne(websiteOrderQuery(id));
    if (existing) {
      return res.status(200).json({ ok: true, alreadyReserved: true, onlineOrderId: existing._id });
    }

    const phone = String(customer?.phone || '').trim();
    if (!phone) {
      return res.status(400).json({ error: 'customer phone is required' });
    }

    const branch = await branchForWebsiteOrder();
    const snapshots = items.map(snapshotLine);
    const linesTotal = roundMoney(snapshots.reduce((sum, line) => sum + line.lineTotal, 0));
    const shipping = Math.max(0, Number(shippingFee) || 0);
    const orderTotal = Number.isFinite(Number(totalAmount))
      ? roundMoney(totalAmount)
      : roundMoney(linesTotal + shipping);
    const isPickup = pickupType === 'branch_pickup';
    const address = String(customer?.address || '').trim();
    const notes = [
      shipping > 0 ? `Shipping: ${roundMoney(shipping)}` : '',
      isPickup && pickupLocation ? `Pickup: ${String(pickupLocation).trim()}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    const onlineOrder = await OnlineOrder.create({
      crmOrderId: id,
      crmOrderNumber: String(ecommerceOrderNumber || id),
      reservationKey: `ecommerce:${id}`,
      customer: {
        name: String(customer?.name || 'Online customer').trim() || 'Online customer',
        phone,
        address,
      },
      branch: branch._id,
      branchSnapshot: { name: branch.name, address: branch.storeAddress || '' },
      items: snapshots,
      subtotal: Number.isFinite(Number(subtotal)) ? roundMoney(subtotal) : linesTotal,
      total: orderTotal,
      notes,
      paymentMethod: String(paymentMethod || ''),
      deliveryMethod: isPickup ? 'pickup' : 'shipping',
      deliveryAddress: isPickup ? String(pickupLocation || address).trim() : address,
      channel: 'website',
      createdBySnapshot: { id: '', name: 'E-commerce' },
      status: 'pending',
      statusHistory: [{ status: 'pending', source: 'website', actorName: 'E-commerce' }],
    });

    void emitOnlineOrderCreatedAlert(onlineOrder).catch((err) => {
      console.warn('website online order alert:', err?.message || err);
    });
    return res.status(201).json({ ok: true, onlineOrderId: onlineOrder._id, channel: 'website' });
  } catch (err) {
    console.error('createWebsiteOrderFromEcommerce:', err);
    return res.status(400).json({ error: err.message || 'Website order failed' });
  }
}

async function isOrdersOnlyMode() {
  const cfg = await getIntegrationConfig();
  return cfg.catalogMode === 'orders_only';
}

/**
 * Reserve Invex stock for an e-commerce order (prevents POS double-sale).
 * Body: { ecommerceOrderId, ecommerceOrderNumber, customer, items: [{ invexProductId, quantity, unitPrice }] }
 */
export async function reserveFromEcommerce(req, res) {
  if (await isOrdersOnlyMode()) {
    return createWebsiteOrderFromEcommerce(req, res);
  }
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const {
      ecommerceOrderId,
      ecommerceOrderNumber,
      customer,
      items,
      pickupType,
      pickupLocation,
      pickupBranchId,
      invexBranchId,
      paymentMethod,
      paymentStatus,
    } = req.body || {};
    const bookingPickupType =
      pickupType === 'branch_pickup' ? 'branch_pickup' : 'online_shipping';
    const bookingPickupLocation = String(pickupLocation || '').trim();
    const bookingPickupBranchId = String(pickupBranchId || invexBranchId || '').trim();
    const paidOnline =
      String(paymentMethod || '').toLowerCase() === 'online' &&
      String(paymentStatus || '').toLowerCase() === 'paid';

    if (!ecommerceOrderId || !Array.isArray(items) || items.length === 0) {
      await session.abortTransaction();
      return res.status(400).json({ error: 'ecommerceOrderId and items are required' });
    }

    const existing = await EcommerceChannelReservation.find({
      ecommerceOrderId: String(ecommerceOrderId),
      status: 'active',
    }).session(session);
    if (existing.length) {
      await session.abortTransaction();
      return res.status(200).json({ ok: true, alreadyReserved: true, count: existing.length });
    }

    const created = [];
    const bookings = [];
    for (const line of items) {
      const productId = line.invexProductId;
      const qty = Math.max(1, Number(line.quantity) || 1);
      if (!productId) continue;
      if (!mongoose.Types.ObjectId.isValid(String(productId))) {
        throw new Error(`Invalid invexProductId: ${productId}`);
      }
      const product = await Product.findById(productId).session(session);
      if (!product) throw new Error(`Product not found: ${productId}`);
      if (sellable(product) < qty) {
        throw new Error(`Not enough stock for ${product.name} (${product.code})`);
      }

      const booking = await createBookingFromEcommerceOrder({
        product,
        quantity: qty,
        customer,
        unitPrice:
          Number(
            line.unitPrice ??
              (product.ecommercePrice != null ? product.ecommercePrice : product.price)
          ) || 0,
        ecommerceOrderId: String(ecommerceOrderId),
        session,
        pickupType: bookingPickupType,
        pickupLocation: String(line.pickupLocation || bookingPickupLocation).trim(),
        pickupBranchId: String(line.pickupBranchId || line.invexBranchId || bookingPickupBranchId).trim(),
        paidOnline,
      });

      const [row] = await EcommerceChannelReservation.create(
        [
          {
            ecommerceOrderId: String(ecommerceOrderId),
            ecommerceOrderNumber: String(ecommerceOrderNumber || ''),
            product: product._id,
            quantity: qty,
            unitPrice:
              Number(
                line.unitPrice ??
                  (product.ecommercePrice != null ? product.ecommercePrice : product.price)
              ) || 0,
            productNameSnapshot: product.name,
            productCodeSnapshot: product.code,
            customerName: String(customer?.name || '').trim(),
            customerPhone: String(customer?.phone || '').trim(),
            customerAddress: String(customer?.address || '').trim(),
            status: 'active',
            invexBookingId: booking?._id || null,
          },
        ],
        { session }
      );
      created.push(row);
      if (booking) bookings.push({ booking, product, qty });
    }

    if (!created.length) {
      await session.abortTransaction();
      return res.status(200).json({ ok: true, skipped: true, reason: 'no_invex_products' });
    }

    await session.commitTransaction();
    for (const { booking, product, qty } of bookings) {
      await recalcProductBookingTotals(product._id);
      await emitBookingCreatedNotification(booking, product, qty, booking.createdBy);
      notifyProductChanged(product._id);
    }
    res.status(201).json({ ok: true, reservations: created.map((r) => r._id) });
  } catch (err) {
    await session.abortTransaction();
    console.error('reserveFromEcommerce:', err);
    res.status(400).json({ error: err.message || 'Reserve failed' });
  } finally {
    session.endSession();
  }
}

/** Cancel active channel reservations for an e-commerce order. */
export async function cancelReservationFromEcommerce(req, res) {
  if (await isOrdersOnlyMode()) {
    const ecommerceOrderId = String(req.body?.ecommerceOrderId || req.params.orderId || '').trim();
    if (!ecommerceOrderId) {
      return res.status(400).json({ error: 'ecommerceOrderId is required' });
    }
    const updated = await OnlineOrder.updateOne(
      {
        ...websiteOrderQuery(ecommerceOrderId),
        status: { $in: ['pending', 'preparing', 'ready'] },
      },
      {
        $set: { status: 'cancelled', cancelledAt: new Date() },
        $push: {
          statusHistory: { status: 'cancelled', source: 'website', actorName: 'E-commerce' },
        },
      }
    );
    return res.json({ ok: true, cancelled: updated.modifiedCount || 0 });
  }
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const ecommerceOrderId = String(req.body?.ecommerceOrderId || req.params.orderId || '');
    if (!ecommerceOrderId) {
      await session.abortTransaction();
      return res.status(400).json({ error: 'ecommerceOrderId is required' });
    }

    const rows = await EcommerceChannelReservation.find({
      ecommerceOrderId,
      status: 'active',
    }).session(session);

    const productIds = [];
    for (const row of rows) {
      const product = await Product.findById(row.product).session(session);
      if (product) {
        product.ecommerceReservedQuantity = Math.max(
          0,
          (Number(product.ecommerceReservedQuantity) || 0) - row.quantity
        );
        await product.save({ session });
        productIds.push(product._id);
      }
      row.status = 'cancelled';
      await row.save({ session });
    }

    await session.commitTransaction();
    await cancelBookingsForEcommerceOrder(ecommerceOrderId);
    for (const id of productIds) notifyProductChanged(id);
    res.json({ ok: true, cancelled: rows.length });
  } catch (err) {
    await session.abortTransaction();
    console.error('cancelReservationFromEcommerce:', err);
    res.status(400).json({ error: err.message || 'Cancel failed' });
  } finally {
    session.endSession();
  }
}

/**
 * Website Visa/card payment succeeded → full amount paid online on the Invex booking.
 */
export async function markPaidFromEcommerce(req, res) {
  try {
    const ecommerceOrderId = String(req.body?.ecommerceOrderId || '').trim();
    if (!ecommerceOrderId) {
      return res.status(400).json({ error: 'ecommerceOrderId is required' });
    }
    if (await isOrdersOnlyMode()) {
      await OnlineOrder.updateOne(websiteOrderQuery(ecommerceOrderId), {
        $set: { paymentMethod: 'online' },
      });
      return res.json({ ok: true, updated: 1 });
    }
    const updated = await markBookingsPaidOnlineForEcommerceOrder(ecommerceOrderId);
    res.json({ ok: true, updated });
  } catch (err) {
    console.error('markPaidFromEcommerce:', err);
    res.status(400).json({ error: err.message || 'Mark paid failed' });
  }
}

/**
 * Convert reservations → Invex sale (invoice) when e-commerce order is Confirmed.
 */
export async function confirmOrderFromEcommerce(req, res) {
  if (await isOrdersOnlyMode()) {
    const ecommerceOrderId = String(req.body?.ecommerceOrderId || '').trim();
    if (!ecommerceOrderId) {
      return res.status(400).json({ error: 'ecommerceOrderId is required' });
    }
    await OnlineOrder.updateOne(
      { ...websiteOrderQuery(ecommerceOrderId), status: 'pending' },
      {
        $set: { status: 'preparing' },
        $push: {
          statusHistory: { status: 'preparing', source: 'website', actorName: 'E-commerce' },
        },
      }
    );
    return res.json({ ok: true, channel: 'website' });
  }
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const {
      ecommerceOrderId,
      ecommerceOrderNumber,
      customer,
      paymentMethod,
    } = req.body || {};

    if (!ecommerceOrderId) {
      await session.abortTransaction();
      return res.status(400).json({ error: 'ecommerceOrderId is required' });
    }

    const already = await EcommerceChannelReservation.findOne({
      ecommerceOrderId: String(ecommerceOrderId),
      status: 'converted',
    }).session(session);
    if (already?.invexOrderId) {
      const existingOrder = await Order.findById(already.invexOrderId).session(session).lean();
      await session.abortTransaction();
      return res.status(200).json({
        ok: true,
        alreadyConverted: true,
        invexOrderId: already.invexOrderId,
        orderNumber: existingOrder?.orderNumber,
      });
    }

    const rows = await EcommerceChannelReservation.find({
      ecommerceOrderId: String(ecommerceOrderId),
      status: 'active',
    }).session(session);

    if (!rows.length) {
      await session.abortTransaction();
      return res.status(404).json({ error: 'No active reservations for this order' });
    }

    const phone = String(customer?.phone || rows[0].customerPhone || '').trim();
    const name = String(customer?.name || rows[0].customerName || 'Online customer').trim();
    const address = String(customer?.address || rows[0].customerAddress || '').trim();
    if (!phone) {
      await session.abortTransaction();
      return res.status(400).json({ error: 'customer phone is required' });
    }

    const cfg = await getIntegrationConfig();
    let branchId = null;
    if (cfg.catalogMode === 'online_only') {
      const online = await ensureOnlineBranch();
      branchId = online._id;
    } else {
      const firstProduct = await Product.findById(rows[0].product).session(session);
      branchId = firstProduct?.branch || null;
    }

    let client = await Client.findOne({ phoneNumber: phone }).session(session);
    if (!client) {
      const [created] = await Client.create(
        [
          {
            name,
            phoneNumber: phone,
            address,
            branches: branchId ? [branchId] : [],
            source: 'ecommerce',
            isEcommerceOnline: true,
          },
        ],
        { session }
      );
      client = created;
    } else {
      client.isEcommerceOnline = true;
      if (!client.source || client.source === 'store') client.source = 'ecommerce';
      if (name) client.name = name;
      if (address) client.address = address;
      if (branchId) {
        await Client.updateOne(
          { _id: client._id },
          { $addToSet: { branches: branchId } },
          { session }
        );
      }
      await client.save({ session });
    }

    let totalPrice = 0;
    let numberOfProducts = 0;
    const orderProducts = [];
    const touchedProductIds = [];

    for (const row of rows) {
      const product = await Product.findById(row.product).session(session);
      if (!product) throw new Error(`Product missing: ${row.product}`);

      const qty = row.quantity;
      const reserved = Number(product.ecommerceReservedQuantity) || 0;
      if (reserved >= qty) {
        product.ecommerceReservedQuantity = reserved - qty;
      }
      if ((Number(product.stock) || 0) < qty) {
        throw new Error(`Not enough stock to confirm ${product.code}`);
      }

      product.stock = (Number(product.stock) || 0) - qty;
      if (Number(product.stock) <= 0) {
        const cat = await Category.findById(product.category)
          .session(session)
          .select('deleteProductWhenOutOfStock')
          .lean();
        if (cat?.deleteProductWhenOutOfStock) {
          product.removedWhenOutOfStock = true;
        }
      }
      await product.save({ session });
      touchedProductIds.push(product._id);

      const unitPrice =
        Number(row.unitPrice) ||
        Number(product.ecommercePrice != null ? product.ecommercePrice : product.price) ||
        0;
      totalPrice += unitPrice * qty;
      numberOfProducts += qty;
      orderProducts.push({
        productId: product._id,
        name: product.name,
        code: product.code,
        quantity: qty,
        price: unitPrice,
        cost: Number(product.netPrice) || 0,
        isApplyDiscount: false,
        showProductCodeOnInvoice: true,
      });

      row.status = 'converted';
      await row.save({ session });
    }

    const lastOrder = await Order.findOne().sort({ orderNumber: -1 }).session(session).lean();
    const nextOrderNumber = Number(lastOrder?.orderNumber || 0) + 1;

    const [newOrder] = await Order.create(
      [
        {
          partyType: 'client',
          clientId: client._id,
          clientName: name,
          clientPhoneNumber: phone,
          clientAddress: address,
          sellerName: 'E-commerce',
          paymentMethod: paymentMethod === 'online' ? 'online' : 'cod',
          branch: branchId,
          numberOfProducts,
          subtotalPrice: totalPrice,
          invoiceDiscountAmount: 0,
          totalPrice,
          amountPaid: totalPrice,
          paymentStatus: 'paid',
          products: orderProducts,
          status: 'completed',
          orderNumber: nextOrderNumber,
          source: 'ecommerce',
          ecommerceOrderId: String(ecommerceOrderId),
          ecommerceOrderNumber: String(ecommerceOrderNumber || ''),
        },
      ],
      { session }
    );

    for (const row of rows) {
      row.invexOrderId = newOrder._id;
      await row.save({ session });
    }

    await session.commitTransaction();
    await cancelBookingsForEcommerceOrder(ecommerceOrderId);
    for (const id of touchedProductIds) {
      await reconcileBookingsToStock(id, { reason: 'Converted from e-commerce order' });
      notifyProductChanged(id);
    }

    res.status(201).json({
      ok: true,
      invexOrderId: newOrder._id,
      orderNumber: newOrder.orderNumber,
      message: 'Invoice created in Invex',
    });
  } catch (err) {
    await session.abortTransaction();
    console.error('confirmOrderFromEcommerce:', err);
    res.status(400).json({ error: err.message || 'Confirm failed' });
  } finally {
    session.endSession();
  }
}

/**
 * Mark / upsert client as ecommerce online when order is Delivered.
 */
export async function deliverOrderFromEcommerce(req, res) {
  try {
    const { ecommerceOrderId, customer } = req.body || {};
    if (await isOrdersOnlyMode()) {
      const id = String(ecommerceOrderId || '').trim();
      if (id) {
        await OnlineOrder.updateOne(
          {
            ...websiteOrderQuery(id),
            status: { $in: ['pending', 'preparing', 'ready'] },
          },
          {
            $set: { status: 'completed', completedAt: new Date() },
            $push: {
              statusHistory: { status: 'completed', source: 'website', actorName: 'E-commerce' },
            },
          }
        );
      }
      return res.json({ ok: true, channel: 'website' });
    }
    const phone = String(customer?.phone || '').trim();
    const name = String(customer?.name || 'Online customer').trim();
    const address = String(customer?.address || '').trim();

    if (!phone) {
      return res.status(400).json({ error: 'customer phone is required' });
    }

    let client = await Client.findOne({ phoneNumber: phone });
    if (!client) {
      client = await Client.create({
        name,
        phoneNumber: phone,
        address,
        source: 'ecommerce',
        isEcommerceOnline: true,
      });
    } else {
      client.isEcommerceOnline = true;
      client.source = 'ecommerce';
      if (name) client.name = name;
      if (address) client.address = address;
      await client.save();
    }

    // Link converted sale if present
    if (ecommerceOrderId) {
      await Order.updateMany(
        { ecommerceOrderId: String(ecommerceOrderId), source: 'ecommerce' },
        { $set: { clientId: client._id } }
      );
    }

    res.json({
      ok: true,
      clientId: client._id,
      isEcommerceOnline: true,
      label: 'online_from_ecommerce',
    });
  } catch (err) {
    console.error('deliverOrderFromEcommerce:', err);
    res.status(400).json({ error: err.message || 'Deliver sync failed' });
  }
}

export async function getCatalog(req, res) {
  try {
    const payload = await buildCatalogPayload();
    res.json(payload);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function pushCatalogNow(req, res) {
  try {
    const result = await pushFullCatalog();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
