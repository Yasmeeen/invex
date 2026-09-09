import mongoose from 'mongoose';
import Branch from '../../DB/models/branch.model.js';
import Category from '../../DB/models/category.model.js';
import Client from '../../DB/models/client.model.js';
import EcommerceChannelReservation from '../../DB/models/ecommerceChannelReservation.model.js';
import OnlineOrder from '../../DB/models/onlineOrder.model.js';
import Order from '../../DB/models/order.model.js';
import Product from '../../DB/models/product.model.js';
import ProductBooking from '../../DB/models/productBooking.model.js';
import StoreSettings from '../../DB/models/storeSettings.model.js';
import {
  createBookingFromEcommerceOrder,
  emitBookingCreatedNotification,
  recalcProductBookingTotals,
} from '../product_bookings_module/service.js';
import { notifyProductChanged } from './catalogSync.js';
import {
  normalizeSaleQuantity,
  normalizeWeightUnit,
  resolveSellByWeight,
} from '../../utils/sale-quantity.util.js';
import { isFarmProduct } from '../../utils/product-type.util.js';

const roundMoney = (value) => Math.round((Number(value) || 0) * 100) / 100;
const objectIdIs = (left, right) => String(left || '') === String(right || '');
const reservationKeyFor = (crmOrderId) => `crm:${String(crmOrderId).trim()}`;

function effectivePrice(product) {
  const basePrice = roundMoney(product.price);
  const discountPercent = Math.max(0, Number(product.discount) || 0);
  return {
    basePrice,
    discountPercent,
    unitPrice: roundMoney(basePrice - (basePrice * discountPercent) / 100),
  };
}

function sellableStock(product) {
  return Math.max(
    0,
    (Number(product.stock) || 0) -
      (Number(product.transferReservedQuantity) || 0) -
      (Number(product.bookedQuantity) || 0) -
      (Number(product.ecommerceReservedQuantity) || 0)
  );
}

async function latestSettings(session) {
  const query = StoreSettings.findOne().sort({ updatedAt: -1 });
  if (session) query.session(session);
  return query.lean();
}

function publicOrder(order) {
  if (!order) return null;
  const plain = typeof order.toObject === 'function' ? order.toObject() : order;
  return {
    ...plain,
    invexOrderId: plain.invexOrderId ? String(plain.invexOrderId) : null,
    invoiceId: plain.invexOrderId ? String(plain.invexOrderId) : null,
    invoiceNumber: plain.invexInvoiceNumber ?? null,
  };
}

/**
 * CRM catalog is branch-scoped. A request without branchId intentionally returns
 * no products so an initial branch-picker cannot leak another branch's catalog.
 */
export async function getCrmCatalog(req, res) {
  try {
    const branchId = String(req.query?.branchId || '').trim();
    const branches = await Branch.find({ active: { $ne: false } })
      .select('_id name storeAddress')
      .sort({ name: 1 })
      .lean();
    const categories = await Category.find()
      .select('_id name code imageUrl sellByWeight weightUnit')
      .sort({ name: 1 })
      .lean();

    if (!branchId) {
      return res.json({
        branches: branches.map((branch) => ({
          invexBranchId: String(branch._id),
          name: branch.name,
          address: branch.storeAddress || '',
        })),
        categories: categories.map((category) => ({
          invexCategoryId: String(category._id),
          name: category.name,
          code: category.code || '',
          imageUrl: category.imageUrl || '',
        })),
        selectedBranchId: null,
        products: [],
      });
    }
    if (!mongoose.Types.ObjectId.isValid(branchId)) {
      return res.status(400).json({ error: 'Valid branchId is required' });
    }
    const selectedBranch = branches.find((branch) => objectIdIs(branch._id, branchId));
    if (!selectedBranch) return res.status(404).json({ error: 'Branch not found or disabled' });

    const settings = await latestSettings();
    const weightSalesEnabled = !!settings?.weightSalesEnabled;
    const categoryById = new Map(categories.map((category) => [String(category._id), category]));
    const products = await Product.find({
      branch: selectedBranch._id,
      inWarehouse: { $ne: true },
      factory: null,
      removedWhenOutOfStock: { $ne: true },
      productType: { $ne: 'service' },
      stock: { $gt: 0 },
    })
      .select(
        '_id name code catalogKey price discount stock transferReservedQuantity bookedQuantity ecommerceReservedQuantity category branch imageUrl productType sellByWeightOverride'
      )
      .sort({ name: 1 })
      .lean();

    // Products are stored per branch in Invex. Older branch copies may not have
    // the image that was uploaded to another copy of the same catalog product.
    // Resolve an image fallback without exposing stock or pricing from that branch.
    const productsMissingImages = products.filter((product) => !String(product.imageUrl || '').trim());
    const missingCatalogKeys = productsMissingImages
      .map((product) => String(product.catalogKey || '').trim())
      .filter(Boolean);
    const missingCodes = productsMissingImages
      .map((product) => String(product.code || '').trim())
      .filter(Boolean);
    const imageSources =
      missingCatalogKeys.length || missingCodes.length
        ? await Product.find({
            imageUrl: { $nin: ['', null] },
            $or: [
              ...(missingCatalogKeys.length ? [{ catalogKey: { $in: missingCatalogKeys } }] : []),
              ...(missingCodes.length ? [{ code: { $in: missingCodes } }] : []),
            ],
          })
            .select('catalogKey code category imageUrl updatedAt')
            .sort({ updatedAt: -1 })
            .lean()
        : [];
    const imageByCatalogKey = new Map();
    const imageByCategoryAndCode = new Map();
    for (const source of imageSources) {
      const imageUrl = String(source.imageUrl || '').trim();
      if (!imageUrl) continue;
      const catalogKey = String(source.catalogKey || '').trim();
      const code = String(source.code || '').trim();
      if (catalogKey && !imageByCatalogKey.has(catalogKey)) {
        imageByCatalogKey.set(catalogKey, imageUrl);
      }
      const categoryAndCode = `${String(source.category || '')}:${code}`;
      if (code && !imageByCategoryAndCode.has(categoryAndCode)) {
        imageByCategoryAndCode.set(categoryAndCode, imageUrl);
      }
    }

    return res.json({
      branches: branches.map((branch) => ({
        invexBranchId: String(branch._id),
        name: branch.name,
        address: branch.storeAddress || '',
      })),
      categories: categories.map((category) => ({
        invexCategoryId: String(category._id),
        name: category.name,
        code: category.code || '',
        imageUrl: category.imageUrl || '',
      })),
      selectedBranchId: branchId,
      products: products
        .map((product) => {
          const category = categoryById.get(String(product.category));
          const isWeight = resolveSellByWeight({
            weightSalesEnabled,
            category,
            product,
          });
          const saleUnit = isFarmProduct(product) ? 'head' : isWeight ? 'weight' : 'piece';
          const prices = effectivePrice(product);
          return {
            invexProductId: String(product._id),
            invexCategoryId: String(product.category),
            invexBranchId: String(product.branch),
            name: product.name,
            code: product.code || '',
            price: prices.unitPrice,
            effectivePrice: prices.unitPrice,
            basePrice: prices.basePrice,
            offerPrice: prices.discountPercent > 0 ? prices.unitPrice : null,
            discountPercent: prices.discountPercent,
            stock: sellableStock(product),
            sellableStock: sellableStock(product),
            imageUrl:
              String(product.imageUrl || '').trim() ||
              imageByCatalogKey.get(String(product.catalogKey || '').trim()) ||
              imageByCategoryAndCode.get(
                `${String(product.category || '')}:${String(product.code || '').trim()}`
              ) ||
              '',
            saleUnit,
            weightUnit: saleUnit === 'weight' ? normalizeWeightUnit(category?.weightUnit) : null,
          };
        })
        .filter((product) => product.sellableStock > 0),
    });
  } catch (error) {
    console.error('getCrmCatalog:', error);
    return res.status(500).json({ error: 'Failed to load CRM catalog' });
  }
}

export async function createCrmOrder(req, res) {
  const body = req.body || {};
  const crmOrderId = String(body.crmOrderId || '').trim();
  const crmOrderNumber = String(body.crmOrderNumber || '').trim();
  if (!crmOrderId || !crmOrderNumber || !body.customer?.phone || !body.customer?.name) {
    return res.status(400).json({
      error: 'crmOrderId, crmOrderNumber, customer name and customer phone are required',
    });
  }
  if (!mongoose.Types.ObjectId.isValid(String(body.branchId || ''))) {
    return res.status(400).json({ error: 'Valid branchId is required' });
  }
  if (!Array.isArray(body.items) || !body.items.length) {
    return res.status(400).json({ error: 'At least one item is required' });
  }

  const existing = await OnlineOrder.findOne({ crmOrderId });
  if (existing) {
    return res.status(200).json({
      ok: true,
      idempotent: true,
      status: existing.status,
      ...(existing.invexOrderId ? { invexOrderId: String(existing.invexOrderId) } : {}),
      order: publicOrder(existing),
    });
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  const bookingNotifications = [];
  try {
    const branch = await Branch.findOne({
      _id: body.branchId,
      active: { $ne: false },
    }).session(session);
    if (!branch) throw new Error('Branch not found or disabled');

    const quantities = new Map();
    for (const item of body.items) {
      const id = String(item?.invexProductId || '').trim();
      const value = Number(item?.quantity);
      if (!mongoose.Types.ObjectId.isValid(id) || !Number.isFinite(value) || value <= 0) {
        throw new Error('Every item requires a valid invexProductId and positive quantity');
      }
      quantities.set(id, (quantities.get(id) || 0) + value);
    }

    const products = await Product.find({ _id: { $in: [...quantities.keys()] } })
      .session(session);
    if (products.length !== quantities.size) throw new Error('One or more products were not found');
    const categoryIds = [...new Set(products.map((product) => String(product.category)))];
    const categories = await Category.find({ _id: { $in: categoryIds } }).session(session).lean();
    const categoryById = new Map(categories.map((category) => [String(category._id), category]));
    const settings = await latestSettings(session);
    const weightSalesEnabled = !!settings?.weightSalesEnabled;
    const reservationKey = reservationKeyFor(crmOrderId);
    const snapshots = [];
    let subtotal = 0;

    for (const product of products) {
      if (!objectIdIs(product.branch, branch._id) || product.inWarehouse || product.factory) {
        throw new Error(`Product ${product.code} does not belong to the selected branch`);
      }
      if (product.removedWhenOutOfStock || product.productType === 'service') {
        throw new Error(`Product ${product.code} is not sellable online`);
      }
      const category = categoryById.get(String(product.category));
      const isWeight = resolveSellByWeight({ weightSalesEnabled, category, product });
      const isFarm = isFarmProduct(product);
      const requested = quantities.get(String(product._id));
      const quantity = isFarm ? Math.floor(requested) : normalizeSaleQuantity(requested, isWeight);
      if (quantity <= 0 || Math.abs(quantity - requested) > 0.0001) {
        throw new Error(
          `${product.code}: quantity must be ${isWeight ? 'a positive decimal' : isFarm ? 'a valid head quantity' : 'a positive integer'}`
        );
      }
      if (sellableStock(product) + 0.0001 < quantity) {
        throw new Error(`Not enough stock for ${product.name} (${product.code})`);
      }

      const prices = effectivePrice(product);
      const reservedProduct = await Product.findOneAndUpdate(
        {
          _id: product._id,
          branch: branch._id,
          $expr: {
            $gte: [
              {
                $subtract: [
                  {
                    $subtract: [
                      {
                        $subtract: [
                          { $ifNull: ['$stock', 0] },
                          { $ifNull: ['$transferReservedQuantity', 0] },
                        ],
                      },
                      { $ifNull: ['$bookedQuantity', 0] },
                    ],
                  },
                  { $ifNull: ['$ecommerceReservedQuantity', 0] },
                ],
              },
              quantity,
            ],
          },
        },
        {
          $inc: {
            bookedQuantity: quantity,
            confirmedBookedQuantity: quantity,
          },
          $set: { bookingStatus: 'active' },
        },
        { new: true, session }
      );
      if (!reservedProduct) {
        throw new Error(`Not enough stock for ${product.name} (${product.code})`);
      }
      const booking = await createBookingFromEcommerceOrder({
        product: reservedProduct,
        quantity,
        customer: body.customer,
        unitPrice: prices.unitPrice,
        ecommerceOrderId: reservationKey,
        session,
        pickupType: body.deliveryMethod === 'pickup' ? 'branch_pickup' : 'online_shipping',
        pickupLocation: body.deliveryAddress || body.customer.address || branch.name,
        pickupBranchId: branch._id,
        paidOnline: false,
        allowFractionalQuantity: isWeight,
      });
      const [reservation] = await EcommerceChannelReservation.create(
        [
          {
            ecommerceOrderId: reservationKey,
            ecommerceOrderNumber: crmOrderNumber,
            product: product._id,
            quantity,
            unitPrice: prices.unitPrice,
            productNameSnapshot: product.name,
            productCodeSnapshot: product.code,
            customerName: body.customer.name,
            customerPhone: body.customer.phone,
            customerAddress: body.customer.address || body.deliveryAddress || '',
            status: 'active',
            invexBookingId: booking._id,
          },
        ],
        { session }
      );
      const saleUnit = isFarm ? 'head' : isWeight ? 'weight' : 'piece';
      const lineTotal = roundMoney(prices.unitPrice * quantity);
      subtotal = roundMoney(subtotal + lineTotal);
      snapshots.push({
        product: product._id,
        invexProductId: String(product._id),
        name: product.name,
        code: product.code || '',
        categoryId: String(product.category),
        quantity,
        saleUnit,
        ...(isWeight ? { weightUnit: normalizeWeightUnit(category?.weightUnit) } : {}),
        basePrice: prices.basePrice,
        discountPercent: prices.discountPercent,
        unitPrice: prices.unitPrice,
        lineTotal,
        stockSnapshot: sellableStock(product),
        bookingId: booking._id,
        reservationId: reservation._id,
      });
      bookingNotifications.push({ booking, product: reservedProduct, quantity });
    }

    const [onlineOrder] = await OnlineOrder.create(
      [
        {
          crmOrderId,
          crmOrderNumber,
          reservationKey,
          customer: {
            crmCustomerId: String(body.customer.crmCustomerId || ''),
            name: String(body.customer.name).trim(),
            phone: String(body.customer.phone).trim(),
            address: String(body.customer.address || '').trim(),
          },
          branch: branch._id,
          branchSnapshot: { name: branch.name, address: branch.storeAddress || '' },
          items: snapshots,
          subtotal,
          total: subtotal,
          notes: String(body.notes || ''),
          paymentMethod: String(body.paymentMethod || ''),
          deliveryMethod: String(body.deliveryMethod || ''),
          deliveryAddress: String(body.deliveryAddress || body.customer.address || ''),
          createdBySnapshot: {
            id: String(body.createdBy?.id || ''),
            name: String(body.createdBy?.name || ''),
          },
          status: 'pending',
          statusHistory: [
            {
              status: 'pending',
              source: 'crm',
              actorId: String(body.createdBy?.id || ''),
              actorName: String(body.createdBy?.name || ''),
            },
          ],
        },
      ],
      { session }
    );
    await session.commitTransaction();

    for (const row of bookingNotifications) {
      try {
        await recalcProductBookingTotals(row.product._id);
        await emitBookingCreatedNotification(
          row.booking,
          row.product,
          row.quantity,
          row.booking.createdBy
        );
        notifyProductChanged(row.product._id);
      } catch (sideEffectError) {
        console.error('CRM reservation post-create side effect:', sideEffectError);
      }
    }
    return res.status(201).json({
      ok: true,
      status: onlineOrder.status,
      order: publicOrder(onlineOrder),
    });
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    if (error?.code === 11000) {
      const duplicate = await OnlineOrder.findOne({ crmOrderId });
      return res.status(200).json({
        ok: true,
        idempotent: true,
        status: duplicate.status,
        ...(duplicate.invexOrderId ? { invexOrderId: String(duplicate.invexOrderId) } : {}),
        order: publicOrder(duplicate),
      });
    }
    console.error('createCrmOrder:', error);
    return res.status(400).json({ error: error.message || 'CRM order could not be created' });
  } finally {
    await session.endSession();
  }
}

export async function getCrmOrder(req, res) {
  try {
    const order = await OnlineOrder.findOne({ crmOrderId: String(req.params.crmOrderId || '') })
      .populate('branch', 'name storeAddress')
      .lean();
    if (!order) return res.status(404).json({ error: 'Online order not found' });
    return res.json({
      status: order.status,
      ...(order.invexOrderId ? { invexOrderId: String(order.invexOrderId) } : {}),
      order: publicOrder(order),
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to load online order' });
  }
}

export async function listOnlineOrders(req, res) {
  try {
    const page = Math.max(1, Number(req.query?.page) || 1);
    const perPage = Math.min(100, Math.max(1, Number(req.query?.perPage) || 20));
    const query = {};
    if (req.query?.status) query.status = String(req.query.status);
    if (req.query?.branchId && mongoose.Types.ObjectId.isValid(String(req.query.branchId))) {
      query.branch = req.query.branchId;
    }
    if (
      ['Branch Manager', 'Cashier'].includes(String(req.user?.role || '')) &&
      req.user?.branch
    ) {
      query.branch = req.user.branch;
    }
    const [orders, total] = await Promise.all([
      OnlineOrder.find(query)
        .select(
          'crmOrderId crmOrderNumber customer branch branchSnapshot total status createdAt updatedAt invexOrderId invexInvoiceNumber items'
        )
        .populate('branch', 'name storeAddress')
        .sort({ createdAt: -1 })
        .skip((page - 1) * perPage)
        .limit(perPage)
        .lean(),
      OnlineOrder.countDocuments(query),
    ]);
    return res.json({
      orders: orders.map(publicOrder),
      meta: { page, perPage, total, totalPages: Math.ceil(total / perPage) },
    });
  } catch (error) {
    console.error('listOnlineOrders:', error);
    return res.status(500).json({ error: 'Failed to list online orders' });
  }
}

export async function getOnlineOrder(req, res) {
  try {
    const order = await OnlineOrder.findById(req.params.id)
      .populate('branch', 'name storeAddress')
      .lean();
    if (!order) return res.status(404).json({ error: 'Online order not found' });
    if (
      ['Branch Manager', 'Cashier'].includes(String(req.user?.role || '')) &&
      req.user?.branch &&
      !objectIdIs(order.branch?._id || order.branch, req.user.branch)
    ) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    return res.json({ order: publicOrder(order) });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to load online order' });
  }
}

async function cancelOnlineOrder(order, actor) {
  if (!['pending', 'preparing', 'ready'].includes(order.status)) {
    throw new Error('Only pending, preparing, or ready orders may be cancelled');
  }
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const current = await OnlineOrder.findById(order._id).session(session);
    if (!current || !['pending', 'preparing', 'ready'].includes(current.status)) {
      throw new Error('Order can no longer be cancelled');
    }
    await EcommerceChannelReservation.updateMany(
      { ecommerceOrderId: current.reservationKey, status: 'active' },
      { $set: { status: 'cancelled' } },
      { session }
    );
    await ProductBooking.updateMany(
      { ecommerceOrderId: current.reservationKey, source: 'ecommerce', status: 'active' },
      {
        $set: {
          status: 'cancelled',
          cancelledAt: new Date(),
          cancelReason: 'CRM online order cancelled',
          ...(actor.id && mongoose.Types.ObjectId.isValid(actor.id)
            ? { cancelledBy: actor.id }
            : {}),
        },
      },
      { session }
    );
    current.status = 'cancelled';
    current.cancelledAt = new Date();
    current.statusHistory.push({
      status: 'cancelled',
      source: 'invex',
      actorId: actor.id,
      actorName: actor.name,
      note: actor.note,
    });
    await current.save({ session });
    await session.commitTransaction();
    const productIds = current.items.map((item) => item.product);
    for (const productId of productIds) {
      try {
        await recalcProductBookingTotals(productId);
        notifyProductChanged(productId);
      } catch (sideEffectError) {
        console.error('CRM cancellation post-update side effect:', sideEffectError);
      }
    }
    return current;
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    throw error;
  } finally {
    await session.endSession();
  }
}

async function completeOnlineOrder(order, actor, paymentMethod) {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const current = await OnlineOrder.findById(order._id).session(session);
    if (!current) throw new Error('Online order not found');
    if (current.status === 'completed' && current.invexOrderId) {
      await session.abortTransaction();
      return current;
    }
    if (current.status !== 'ready') throw new Error('Only ready orders may be completed');

    const bookings = await ProductBooking.find({
      ecommerceOrderId: current.reservationKey,
      source: 'ecommerce',
      status: 'active',
    }).session(session);
    if (bookings.length !== current.items.length) {
      throw new Error('One or more stock reservations are no longer active');
    }

    // Reservation creation already resolves phone variants through the shared
    // e-commerce booking path; reuse that client to avoid duplicate phone rows.
    let client = bookings[0]?.client
      ? await Client.findById(bookings[0].client).session(session)
      : null;
    if (!client) {
      client = await Client.findOne({ phoneNumber: current.customer.phone }).session(session);
    }
    if (!client) {
      const [created] = await Client.create(
        [
          {
            name: current.customer.name,
            phoneNumber: current.customer.phone,
            address: current.customer.address || current.deliveryAddress,
            branches: [current.branch],
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
      if (current.customer.name) client.name = current.customer.name;
      if (current.customer.address || current.deliveryAddress) {
        client.address = current.customer.address || current.deliveryAddress;
      }
      if (!client.branches.some((id) => objectIdIs(id, current.branch))) {
        client.branches.push(current.branch);
      }
      await client.save({ session });
    }

    const invoiceItems = [];
    const touched = [];
    for (const item of current.items) {
      const product = await Product.findById(item.product).session(session);
      if (!product || !objectIdIs(product.branch, current.branch)) {
        throw new Error(`Reserved product ${item.code} is unavailable`);
      }
      if ((Number(product.stock) || 0) + 0.0001 < item.quantity) {
        throw new Error(`Not enough stock to complete ${item.name}`);
      }
      product.stock = Math.max(0, (Number(product.stock) || 0) - item.quantity);
      if (product.stock <= 0.0001) {
        const category = await Category.findById(product.category)
          .session(session)
          .select('deleteProductWhenOutOfStock')
          .lean();
        if (category?.deleteProductWhenOutOfStock) product.removedWhenOutOfStock = true;
      }
      await product.save({ session });
      touched.push(product._id);
      invoiceItems.push({
        productId: product._id,
        name: item.name,
        code: item.code,
        quantity: item.quantity,
        saleUnit: item.saleUnit,
        ...(item.saleUnit === 'weight' ? { weightUnit: item.weightUnit || 'kg' } : {}),
        price: item.unitPrice,
        cost: Number(product.netPrice) || 0,
        isApplyDiscount: item.discountPercent > 0,
        showProductCodeOnInvoice: true,
      });
    }

    const lastOrder = await Order.findOne().sort({ orderNumber: -1 }).session(session).lean();
    const [invoice] = await Order.create(
      [
        {
          partyType: 'client',
          clientId: client._id,
          clientName: current.customer.name,
          clientPhoneNumber: current.customer.phone,
          clientAddress: current.customer.address || current.deliveryAddress,
          sellerName: actor.name || current.createdBySnapshot.name || 'CRM',
          paymentMethod: String(paymentMethod || current.paymentMethod || 'uncollected'),
          branch: current.branch,
          numberOfProducts: current.items.reduce((sum, item) => sum + item.quantity, 0),
          subtotalPrice: current.subtotal,
          invoiceDiscountAmount: 0,
          totalPrice: current.total,
          amountPaid: 0,
          paymentStatus: 'unpaid',
          payments: [],
          products: invoiceItems,
          status: 'completed',
          orderNumber: Number(lastOrder?.orderNumber || 0) + 1,
          source: 'ecommerce',
          ecommerceOrderId: current.reservationKey,
          ecommerceOrderNumber: current.crmOrderNumber,
        },
      ],
      { session }
    );

    await EcommerceChannelReservation.updateMany(
      { ecommerceOrderId: current.reservationKey, status: 'active' },
      { $set: { status: 'converted', invexOrderId: invoice._id } },
      { session }
    );
    await ProductBooking.updateMany(
      { ecommerceOrderId: current.reservationKey, source: 'ecommerce', status: 'active' },
      {
        $set: {
          status: 'cancelled',
          cancelledAt: new Date(),
          cancelReason: 'Converted to Invex invoice',
        },
      },
      { session }
    );
    current.status = 'completed';
    current.invexOrderId = invoice._id;
    current.invexInvoiceNumber = invoice.orderNumber;
    current.completedAt = new Date();
    current.statusHistory.push({
      status: 'completed',
      source: 'invex',
      actorId: actor.id,
      actorName: actor.name,
      note: actor.note,
    });
    await current.save({ session });
    await session.commitTransaction();

    for (const productId of touched) {
      try {
        await recalcProductBookingTotals(productId);
        notifyProductChanged(productId);
      } catch (sideEffectError) {
        console.error('CRM completion post-update side effect:', sideEffectError);
      }
    }
    return current;
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    throw error;
  } finally {
    await session.endSession();
  }
}

export async function updateOnlineOrderStatus(req, res) {
  try {
    const order = await OnlineOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Online order not found' });
    if (
      ['Branch Manager', 'Cashier'].includes(String(req.user?.role || '')) &&
      req.user?.branch &&
      !objectIdIs(order.branch, req.user.branch)
    ) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const nextStatus = String(req.body?.status || '').trim();
    const actor = {
      id: String(req.user?._id || ''),
      name: String(req.user?.name || ''),
      note: String(req.body?.note || ''),
    };
    if (nextStatus === 'cancelled') {
      const cancelled = await cancelOnlineOrder(order, actor);
      return res.json({ ok: true, order: publicOrder(cancelled) });
    }
    if (nextStatus === 'completed') {
      const completed = await completeOnlineOrder(order, actor, req.body?.paymentMethod);
      return res.json({
        ok: true,
        order: publicOrder(completed),
        invoiceId: String(completed.invexOrderId),
        invoiceNumber: completed.invexInvoiceNumber,
        paymentStatus: 'unpaid',
      });
    }
    const allowed = { pending: 'preparing', preparing: 'ready' };
    if (allowed[order.status] !== nextStatus) {
      return res.status(409).json({ error: `Cannot move order from ${order.status} to ${nextStatus}` });
    }
    order.status = nextStatus;
    order.statusHistory.push({
      status: nextStatus,
      source: 'invex',
      actorId: actor.id,
      actorName: actor.name,
      note: actor.note,
    });
    await order.save();
    return res.json({ ok: true, order: publicOrder(order) });
  } catch (error) {
    console.error('updateOnlineOrderStatus:', error);
    return res.status(400).json({ error: error.message || 'Online order status update failed' });
  }
}
