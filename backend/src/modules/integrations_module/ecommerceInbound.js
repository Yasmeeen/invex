import mongoose from 'mongoose';
import Client from '../../DB/models/client.model.js';
import Order from '../../DB/models/order.model.js';
import Product from '../../DB/models/product.model.js';
import Category from '../../DB/models/category.model.js';
import EcommerceChannelReservation from '../../DB/models/ecommerceChannelReservation.model.js';
import StoreSettings from '../../DB/models/storeSettings.model.js';
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
  markBookingsPaidOnlineForEcommerceOrder,
  reconcileBookingsToStock,
  recalcProductBookingTotals,
  emitBookingCreatedNotification,
} from '../product_bookings_module/service.js';
import {
  computeSellableUnits,
  isCutFromSourceEnabled,
  loadSourceProductsById,
  sourceProductIdOf,
  stockBearerOf,
} from '../../utils/cut-from-source.js';
import { resolveCutSaleUnitCost } from '../../utils/slaughter-cost.util.js';

function sellable(product) {
  return computeSellableUnits(product);
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
    const settings = await StoreSettings.findOne().sort({ updatedAt: -1 }).session(session).lean();
    const cutFromSourceEnabled = isCutFromSourceEnabled(settings);

    for (const line of items) {
      const productId = line.invexProductId;
      const qty = Math.max(1, Number(line.quantity) || 1);
      if (!productId || !mongoose.Types.ObjectId.isValid(String(productId))) {
        throw new Error(`Invalid invexProductId: ${productId}`);
      }
      const product = await Product.findById(productId).session(session);
      if (!product) throw new Error(`Product not found: ${productId}`);
      const sourceById = await loadSourceProductsById([product], {
        enabled: cutFromSourceEnabled,
        session,
      });
      const stockProduct = stockBearerOf(product, sourceById, cutFromSourceEnabled);
      if (
        cutFromSourceEnabled &&
        sourceProductIdOf(product) &&
        (!stockProduct || String(stockProduct._id) === String(product._id))
      ) {
        throw new Error(`Source stock missing for ${product.name} (${product.code})`);
      }
      if (sellable(stockProduct) < qty) {
        throw new Error(`Not enough stock for ${product.name} (${product.code})`);
      }

      const booking = await createBookingFromEcommerceOrder({
        product: stockProduct,
        displayProduct: product,
        quantity: qty,
        customer,
        unitPrice: Number(line.unitPrice ?? product.price) || 0,
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
      if (booking) {
        bookings.push({ booking, stockProduct, displayProduct: product, qty });
      }
    }

    await session.commitTransaction();
    for (const { booking, stockProduct, displayProduct, qty } of bookings) {
      await recalcProductBookingTotals(stockProduct._id);
      await emitBookingCreatedNotification(booking, displayProduct, qty, booking.createdBy);
      notifyProductChanged(stockProduct._id);
      if (String(displayProduct._id) !== String(stockProduct._id)) {
        notifyProductChanged(displayProduct._id);
      }
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
    const settings = await StoreSettings.findOne().sort({ updatedAt: -1 }).session(session).lean();
    const cutFromSourceEnabled = isCutFromSourceEnabled(settings);
    for (const row of rows) {
      const product = await Product.findById(row.product).session(session);
      if (product) {
        const sourceId = cutFromSourceEnabled ? sourceProductIdOf(product) : null;
        const stockProduct = sourceId
          ? await Product.findById(sourceId).session(session)
          : product;
        if (stockProduct) {
          stockProduct.ecommerceReservedQuantity = Math.max(
            0,
            (Number(stockProduct.ecommerceReservedQuantity) || 0) - row.quantity
          );
          await stockProduct.save({ session });
          productIds.push(stockProduct._id);
        }
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
    const settings = await StoreSettings.findOne().sort({ updatedAt: -1 }).session(session).lean();
    const cutFromSourceEnabled = isCutFromSourceEnabled(settings);

    for (const row of rows) {
      const product = await Product.findById(row.product).session(session);
      if (!product) throw new Error(`Product missing: ${row.product}`);

      const qty = row.quantity;
      const sourceId = cutFromSourceEnabled ? sourceProductIdOf(product) : null;
      const stockProduct = sourceId
        ? await Product.findById(sourceId).session(session)
        : product;
      if (!stockProduct) throw new Error(`Source stock missing for ${product.code}`);

      const reserved = Number(stockProduct.ecommerceReservedQuantity) || 0;
      if (reserved >= qty) {
        stockProduct.ecommerceReservedQuantity = reserved - qty;
      }
      if ((Number(stockProduct.stock) || 0) < qty) {
        throw new Error(`Not enough stock to confirm ${product.code}`);
      }

      stockProduct.stock = (Number(stockProduct.stock) || 0) - qty;
      if (Number(stockProduct.stock) <= 0) {
        const cat = await Category.findById(stockProduct.category)
          .session(session)
          .select('deleteProductWhenOutOfStock')
          .lean();
        if (cat?.deleteProductWhenOutOfStock) {
          stockProduct.removedWhenOutOfStock = true;
        }
      }
      await stockProduct.save({ session });
      touchedProductIds.push(stockProduct._id);
      if (sourceId) touchedProductIds.push(product._id);

      const unitPrice = Number(row.unitPrice) || Number(product.price) || 0;
      const unitCost = sourceId
        ? resolveCutSaleUnitCost(stockProduct.netPrice, product.processingExtraCost)
        : Number(product.netPrice) || 0;
      totalPrice += unitPrice * qty;
      numberOfProducts += qty;
      orderProducts.push({
        productId: product._id,
        name: product.name,
        code: product.code,
        quantity: qty,
        price: unitPrice,
        cost: unitCost,
        isApplyDiscount: false,
        showProductCodeOnInvoice: true,
        ...(sourceId ? { sourceProductId: stockProduct._id } : {}),
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
