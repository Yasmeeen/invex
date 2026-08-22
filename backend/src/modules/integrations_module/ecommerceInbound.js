import mongoose from 'mongoose';
import Client from '../../DB/models/client.model.js';
import Order from '../../DB/models/order.model.js';
import Product from '../../DB/models/product.model.js';
import EcommerceChannelReservation from '../../DB/models/ecommerceChannelReservation.model.js';
import {
  getIntegrationConfig,
  notifyProductChanged,
  buildCatalogPayload,
  pushFullCatalog,
} from './catalogSync.js';
import { ensureOnlineBranch } from './onlineBranch.js';
import {
  createBookingFromEcommerceOrder,
  cancelBookingsForEcommerceOrder,
  reconcileBookingsToStock,
} from '../product_bookings_module/service.js';

function sellable(product) {
  const stock = Number(product.stock) || 0;
  const transfer = Number(product.transferReservedQuantity) || 0;
  const booked = Number(product.bookedQuantity) || 0;
  const ecom = Number(product.ecommerceReservedQuantity) || 0;
  return Math.max(0, stock - transfer - booked - ecom);
}

/**
 * Reserve Invex stock for an e-commerce order (prevents POS double-sale).
 * Body: { ecommerceOrderId, ecommerceOrderNumber, customer, items: [{ invexProductId, quantity, unitPrice }] }
 */
export async function reserveFromEcommerce(req, res) {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const {
      ecommerceOrderId,
      ecommerceOrderNumber,
      customer,
      items,
    } = req.body || {};

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
    for (const line of items) {
      const productId = line.invexProductId;
      const qty = Math.max(1, Number(line.quantity) || 1);
      if (!productId || !mongoose.Types.ObjectId.isValid(String(productId))) {
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
        unitPrice: Number(line.unitPrice ?? product.price) || 0,
        ecommerceOrderId: String(ecommerceOrderId),
        session,
      });

      const [row] = await EcommerceChannelReservation.create(
        [
          {
            ecommerceOrderId: String(ecommerceOrderId),
            ecommerceOrderNumber: String(ecommerceOrderNumber || ''),
            product: product._id,
            quantity: qty,
            unitPrice: Number(line.unitPrice ?? product.price) || 0,
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
    }

    await session.commitTransaction();
    for (const row of created) {
      notifyProductChanged(row.product);
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
 * Convert reservations → Invex sale (invoice) when e-commerce order is Confirmed.
 */
export async function confirmOrderFromEcommerce(req, res) {
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
      await product.save({ session });
      touchedProductIds.push(product._id);

      const unitPrice = Number(row.unitPrice) || Number(product.price) || 0;
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
