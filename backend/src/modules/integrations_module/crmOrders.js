import mongoose from 'mongoose';
import Branch from '../../DB/models/branch.model.js';
import Category from '../../DB/models/category.model.js';
import Client from '../../DB/models/client.model.js';
import EcommerceChannelReservation from '../../DB/models/ecommerceChannelReservation.model.js';
import OnlineOrder from '../../DB/models/onlineOrder.model.js';
import Order from '../../DB/models/order.model.js';
import Product from '../../DB/models/product.model.js';
import ProductBooking from '../../DB/models/productBooking.model.js';
import Notification from '../../DB/models/notification.model.js';
import StoreSettings from '../../DB/models/storeSettings.model.js';
import User from '../../DB/models/user.model.js';
import {
  createBookingFromEcommerceOrder,
  emitBookingCreatedNotification,
  recalcProductBookingTotals,
} from '../product_bookings_module/service.js';
import { emitToUsers } from '../../realtime/socket.js';
import { notifyProductChanged } from './catalogSync.js';
import {
  normalizeSaleQuantity,
  normalizeWeightUnit,
  resolveSellByWeight,
} from '../../utils/sale-quantity.util.js';
import { isFarmProduct } from '../../utils/product-type.util.js';
import {
  computeSellableUnits,
  effectiveSellableUnits,
  isCutFromSourceEnabled,
  loadSourceProductsById,
  sourceProductIdOf,
  stockBearerOf,
} from '../../utils/cut-from-source.js';
import { resolveCutSaleUnitCost } from '../../utils/slaughter-cost.util.js';

const roundMoney = (value) => Math.round((Number(value) || 0) * 100) / 100;
const objectIdIs = (left, right) => String(left || '') === String(right || '');
const reservationKeyFor = (crmOrderId) => `crm:${String(crmOrderId).trim()}`;

/** Staff who should see the global online-order banner / bell for a new CRM order. */
async function onlineOrderAlertRecipientIds(branchId) {
  const users = await User.find({
    role: { $in: ['Super Admin', 'Co Admin', 'Branch Manager', 'Cashier'] },
  })
    .select('_id role branch')
    .lean();
  const branch = String(branchId || '');
  return users
    .filter((u) => {
      const role = String(u.role || '');
      if (role === 'Super Admin' || role === 'Co Admin') return true;
      return branch && u.branch && String(u.branch) === branch;
    })
    .map((u) => u._id);
}

async function emitOnlineOrderCreatedAlert(onlineOrder) {
  try {
    const branchId = onlineOrder?.branch;
    const recipientIds = await onlineOrderAlertRecipientIds(branchId);
    if (!recipientIds.length) return;

    const branchPendingCount = await OnlineOrder.countDocuments({
      status: 'pending',
      branch: branchId,
    });
    const orderNumber = String(onlineOrder.crmOrderNumber || onlineOrder.crmOrderId || '');
    const customerName = String(onlineOrder.customer?.name || '').trim();
    const branchName = String(onlineOrder.branchSnapshot?.name || '').trim();

    const notification = await Notification.create({
      type: 'online_order_created',
      title: 'New online order',
      body: [orderNumber, customerName, branchName].filter(Boolean).join(' · '),
      data: {
        onlineOrderId: onlineOrder._id,
        crmOrderId: onlineOrder.crmOrderId,
        crmOrderNumber: onlineOrder.crmOrderNumber,
        branchId,
        branchName,
        customerName,
        status: onlineOrder.status || 'pending',
        pendingCount: branchPendingCount,
      },
      recipients: recipientIds,
      readBy: [],
    });

    const payload = {
      notification,
      onlineOrderId: String(onlineOrder._id),
      branchId: String(branchId || ''),
      pendingCount: branchPendingCount,
    };
    emitToUsers(recipientIds, 'notification:new', { notification });
    emitToUsers(recipientIds, 'online-order:new', payload);
  } catch (err) {
    console.warn('⚠️ online order alert:', err?.message || err);
  }
}

function effectivePrice(product) {
  const basePrice = roundMoney(product.price);
  const discountPercent = Math.max(0, Number(product.discount) || 0);
  return {
    basePrice,
    discountPercent,
    unitPrice: roundMoney(basePrice - (basePrice * discountPercent) / 100),
  };
}

function sellableStock(product, sourceById = null, cutFromSourceEnabled = false) {
  if (sourceById && cutFromSourceEnabled) {
    return effectiveSellableUnits(product, sourceById, cutFromSourceEnabled);
  }
  return computeSellableUnits(product);
}

async function latestSettings(session) {
  const query = StoreSettings.findOne().sort({ updatedAt: -1 });
  if (session) query.session(session);
  return query.lean();
}

/** Recalc + notify without blocking the HTTP response (large orders). */
function scheduleProductSideEffects(productIds, label = 'CRM post-update') {
  const unique = [
    ...new Set(
      (productIds || [])
        .map((id) => String(id || ''))
        .filter((id) => id && mongoose.Types.ObjectId.isValid(id))
    ),
  ];
  if (!unique.length) return;
  void Promise.all(
    unique.map(async (productId) => {
      try {
        await recalcProductBookingTotals(productId);
        notifyProductChanged(productId);
      } catch (sideEffectError) {
        console.error(`${label} side effect:`, sideEffectError);
      }
    })
  );
}

function resolveChannel(order) {
  const explicit = String(order?.channel || '').trim();
  if (explicit === 'crm' || explicit === 'website') return explicit;
  const key = String(order?.reservationKey || '');
  if (key.startsWith('web:') || key.startsWith('ecommerce:')) return 'website';
  return 'crm';
}

function publicOrder(order) {
  if (!order) return null;
  const plain = typeof order.toObject === 'function' ? order.toObject() : order;
  return {
    ...plain,
    channel: resolveChannel(plain),
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
    const cutFromSourceEnabled = isCutFromSourceEnabled(settings);
    const categoryById = new Map(categories.map((category) => [String(category._id), category]));
    const products = await Product.find({
      branch: selectedBranch._id,
      inWarehouse: { $ne: true },
      factory: null,
      removedWhenOutOfStock: { $ne: true },
      productType: { $ne: 'service' },
      ...(cutFromSourceEnabled
        ? {
            $or: [{ stock: { $gt: 0 } }, { sourceProductId: { $ne: null } }],
          }
        : { stock: { $gt: 0 } }),
    })
      .select(
        '_id name code catalogKey price discount stock transferReservedQuantity bookedQuantity ecommerceReservedQuantity category branch imageUrl productType sellByWeightOverride sourceProductId processingExtraCost'
      )
      .sort({ name: 1 })
      .lean();
    const sourceById = await loadSourceProductsById(products, {
      enabled: cutFromSourceEnabled,
    });

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
          const available = sellableStock(product, sourceById, cutFromSourceEnabled);
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
            stock: available,
            sellableStock: available,
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
    const cutFromSourceEnabled = isCutFromSourceEnabled(settings);
    const sourceById = await loadSourceProductsById(products, {
      enabled: cutFromSourceEnabled,
      session,
    });
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
      const stockProduct = stockBearerOf(product, sourceById, cutFromSourceEnabled);
      if (
        cutFromSourceEnabled &&
        sourceProductIdOf(product) &&
        (!stockProduct || objectIdIs(stockProduct._id, product._id))
      ) {
        throw new Error(`Source stock missing for ${product.name} (${product.code})`);
      }
      if (sellableStock(stockProduct) + 0.0001 < quantity) {
        throw new Error(`Not enough stock for ${product.name} (${product.code})`);
      }

      const prices = effectivePrice(product);
      const reservedProduct = await Product.findOneAndUpdate(
        {
          _id: stockProduct._id,
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
      sourceById.set(String(reservedProduct._id), reservedProduct);
      const booking = await createBookingFromEcommerceOrder({
        product: reservedProduct,
        displayProduct: product,
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
        stockSnapshot: sellableStock(stockProduct),
        bookingId: booking._id,
        reservationId: reservation._id,
      });
      bookingNotifications.push({
        booking,
        product: reservedProduct,
        displayProduct: product,
        quantity,
      });
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
          channel: 'crm',
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

    void Promise.all(
      bookingNotifications.map(async (row) => {
        try {
          await recalcProductBookingTotals(row.product._id);
          await emitBookingCreatedNotification(
            row.booking,
            row.displayProduct || row.product,
            row.quantity,
            row.booking.createdBy
          );
          notifyProductChanged(row.product._id);
          if (row.displayProduct && !objectIdIs(row.displayProduct._id, row.product._id)) {
            notifyProductChanged(row.displayProduct._id);
          }
        } catch (sideEffectError) {
          console.error('CRM reservation post-create side effect:', sideEffectError);
        }
      })
    );
    void emitOnlineOrderCreatedAlert(onlineOrder).catch((alertErr) => {
      console.warn('⚠️ online order created alert:', alertErr?.message || alertErr);
    });
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

export async function pendingOnlineOrdersSummary(req, res) {
  try {
    const query = { status: 'pending' };
    const role = String(req.user?.role || '');
    if (['Branch Manager', 'Cashier'].includes(role)) {
      if (!req.user?.branch) {
        return res.json({ count: 0, status: 'pending', oldestPendingAt: null });
      }
      // Branch staff only see orders fulfilled / picked up from their branch.
      query.branch = req.user.branch;
    } else if (req.query?.branchId && mongoose.Types.ObjectId.isValid(String(req.query.branchId))) {
      // Super Admin / Co Admin may scope the banner to the cashier-selected branch.
      query.branch = req.query.branchId;
    }
    const [count, oldest] = await Promise.all([
      OnlineOrder.countDocuments(query),
      OnlineOrder.findOne(query).sort({ createdAt: 1 }).select('createdAt').lean(),
    ]);
    return res.json({
      count,
      status: 'pending',
      oldestPendingAt: oldest?.createdAt || null,
    });
  } catch (error) {
    console.error('pendingOnlineOrdersSummary:', error);
    return res.status(500).json({ error: 'Failed to load pending online orders summary' });
  }
}

export async function listOnlineOrders(req, res) {
  try {
    const page = Math.max(1, Number(req.query?.page) || 1);
    const perPage = Math.min(100, Math.max(1, Number(req.query?.perPage) || 20));
    const baseQuery = {};
    const role = String(req.user?.role || '');
    if (req.query?.status) baseQuery.status = String(req.query.status);
    if (['Branch Manager', 'Cashier'].includes(role)) {
      if (!req.user?.branch) {
        return res.json({
          orders: [],
          meta: { page, perPage, total: 0, totalPages: 0 },
          channelCounts: { all: 0, crm: 0, website: 0 },
        });
      }
      baseQuery.branch = req.user.branch;
    } else if (req.query?.branchId && mongoose.Types.ObjectId.isValid(String(req.query.branchId))) {
      baseQuery.branch = req.query.branchId;
    }

    const search = String(req.query?.search || '').trim();
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rx = new RegExp(escaped, 'i');
      baseQuery.$or = [
        { crmOrderNumber: rx },
        { crmOrderId: rx },
        { 'customer.name': rx },
        { 'customer.phone': rx },
      ];
    }

    const channel = String(req.query?.channel || '').trim();
    const query = { ...baseQuery };
    if (channel === 'website') {
      query.channel = 'website';
    } else if (channel === 'crm') {
      // Older rows may lack `channel`; treat missing as CRM.
      const channelClause = {
        $or: [{ channel: 'crm' }, { channel: { $exists: false } }, { channel: null }],
      };
      if (query.$or) {
        query.$and = [{ $or: query.$or }, channelClause];
        delete query.$or;
      } else {
        Object.assign(query, channelClause);
      }
    }

    const [orders, total, channelAgg] = await Promise.all([
      OnlineOrder.find(query)
        .select(
          'crmOrderId crmOrderNumber customer branch branchSnapshot total status channel reservationKey createdAt updatedAt invexOrderId invexInvoiceNumber items notes'
        )
        .populate('branch', 'name storeAddress')
        .sort({ createdAt: -1 })
        .skip((page - 1) * perPage)
        .limit(perPage)
        .lean(),
      OnlineOrder.countDocuments(query),
      OnlineOrder.aggregate([
        { $match: baseQuery },
        {
          $group: {
            _id: { $ifNull: ['$channel', 'crm'] },
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

    const channelCounts = { all: 0, crm: 0, website: 0 };
    for (const row of channelAgg) {
      const key = row._id === 'website' ? 'website' : 'crm';
      channelCounts[key] += row.count;
      channelCounts.all += row.count;
    }

    return res.json({
      orders: orders.map(publicOrder),
      meta: { page, perPage, total, totalPages: Math.ceil(total / perPage) || 0 },
      channelCounts,
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
      .populate('items.product', 'name code imageUrl')
      .lean();
    if (!order) return res.status(404).json({ error: 'Online order not found' });
    if (
      ['Branch Manager', 'Cashier'].includes(String(req.user?.role || '')) &&
      req.user?.branch &&
      !objectIdIs(order.branch?._id || order.branch, req.user.branch)
    ) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const payload = publicOrder(order);
    if (payload?.items?.length) {
      payload.items = payload.items.map((item) => ({
        ...item,
        imageUrl: String(item?.product?.imageUrl || item?.imageUrl || '').trim(),
      }));
    }
    return res.json({ order: payload });
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
    const settings = await latestSettings();
    const cutFromSourceEnabled = isCutFromSourceEnabled(settings);
    const cutProducts = await Product.find({ _id: { $in: current.items.map((item) => item.product) } })
      .select('_id sourceProductId')
      .lean();
    const notifyIds = new Set();
    for (const cut of cutProducts) {
      notifyIds.add(String(cut._id));
      const sourceId = cutFromSourceEnabled ? sourceProductIdOf(cut) : null;
      if (sourceId) notifyIds.add(sourceId);
    }
    scheduleProductSideEffects(notifyIds, 'CRM cancellation post-update');
    return current;
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    throw error;
  } finally {
    await session.endSession();
  }
}

async function completeOnlineOrder(order, actor, paymentMethod, options = {}) {
  const deliveryPersonName = String(options?.deliveryPersonName || '').trim();
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

    const productIds = [
      ...new Set(
        current.items
          .map((item) => String(item.product || ''))
          .filter((id) => id && mongoose.Types.ObjectId.isValid(id))
      ),
    ];

    // One round-trip batch instead of N× findById / settings / last order# per line.
    const [bookings, settings, productDocs, lastOrder] = await Promise.all([
      ProductBooking.find({
        ecommerceOrderId: current.reservationKey,
        source: 'ecommerce',
        status: 'active',
      }).session(session),
      latestSettings(session),
      productIds.length
        ? Product.find({ _id: { $in: productIds } }).session(session)
        : Promise.resolve([]),
      Order.findOne().sort({ orderNumber: -1 }).select('orderNumber').session(session).lean(),
    ]);
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

    const cutFromSourceEnabled = isCutFromSourceEnabled(settings);
    const sourceById = await loadSourceProductsById(productDocs, {
      enabled: cutFromSourceEnabled,
      session,
    });
    const mutableById = new Map(productDocs.map((p) => [String(p._id), p]));
    for (const [id, src] of sourceById) {
      if (!mutableById.has(id)) mutableById.set(id, src);
    }

    const invoiceItems = [];
    const touched = new Set();
    /** Aggregate qty per stock bearer so shared fridge sources are deducted once. */
    const stockDeltaById = new Map();
    const stockLabelById = new Map();

    for (const item of current.items) {
      const product = mutableById.get(String(item.product));
      if (!product || !objectIdIs(product.branch, current.branch)) {
        throw new Error(`Reserved product ${item.code} is unavailable`);
      }
      const sourceId = cutFromSourceEnabled ? sourceProductIdOf(product) : null;
      const stockProduct = stockBearerOf(product, mutableById, cutFromSourceEnabled);
      if (sourceId && (!stockProduct || objectIdIs(stockProduct._id, product._id))) {
        throw new Error(`Source stock missing for ${item.name}`);
      }
      const bearerId = String(stockProduct._id);
      stockDeltaById.set(bearerId, (stockDeltaById.get(bearerId) || 0) + Number(item.quantity));
      if (!stockLabelById.has(bearerId)) stockLabelById.set(bearerId, item.name);
      touched.add(bearerId);
      touched.add(String(product._id));
      const unitCost = sourceId
        ? resolveCutSaleUnitCost(stockProduct.netPrice, product.processingExtraCost)
        : Number(product.netPrice) || 0;
      invoiceItems.push({
        productId: product._id,
        name: item.name,
        code: item.code,
        quantity: item.quantity,
        saleUnit: item.saleUnit,
        ...(item.saleUnit === 'weight' ? { weightUnit: item.weightUnit || 'kg' } : {}),
        price: item.unitPrice,
        cost: unitCost,
        isApplyDiscount: item.discountPercent > 0,
        showProductCodeOnInvoice: true,
        ...(sourceId ? { sourceProductId: stockProduct._id } : {}),
      });
    }

    for (const [bearerId, qty] of stockDeltaById) {
      const stockProduct = mutableById.get(bearerId);
      if (!stockProduct) {
        throw new Error(`Source stock missing for ${stockLabelById.get(bearerId) || bearerId}`);
      }
      if ((Number(stockProduct.stock) || 0) + 0.0001 < qty) {
        throw new Error(`Not enough stock to complete ${stockLabelById.get(bearerId) || stockProduct.name}`);
      }
      stockProduct.stock = Math.max(0, (Number(stockProduct.stock) || 0) - qty);
    }

    const zeroStockDocs = [...stockDeltaById.keys()]
      .map((id) => mutableById.get(id))
      .filter((doc) => doc && (Number(doc.stock) || 0) <= 0.0001);
    if (zeroStockDocs.length) {
      const categoryIds = [
        ...new Set(
          zeroStockDocs
            .map((doc) => String(doc.category || ''))
            .filter((id) => id && mongoose.Types.ObjectId.isValid(id))
        ),
      ];
      const categories = categoryIds.length
        ? await Category.find({ _id: { $in: categoryIds } })
            .session(session)
            .select('deleteProductWhenOutOfStock')
            .lean()
        : [];
      const categoryById = new Map(categories.map((c) => [String(c._id), c]));
      for (const doc of zeroStockDocs) {
        if (categoryById.get(String(doc.category))?.deleteProductWhenOutOfStock) {
          doc.removedWhenOutOfStock = true;
        }
      }
    }

    const stockDocsToSave = [...stockDeltaById.keys()].map((id) => mutableById.get(id)).filter(Boolean);
    await Promise.all(stockDocsToSave.map((doc) => doc.save({ session })));

    const isPickup = String(current.deliveryMethod || '').trim().toLowerCase() === 'pickup';
    let resolvedDeliveryName = deliveryPersonName;
    if (resolvedDeliveryName) {
      const branchDoc = await Branch.findById(current.branch).session(session).select('deliveryStaff').lean();
      const allowed = new Set(
        (branchDoc?.deliveryStaff || [])
          .filter((s) => s && s.active !== false)
          .map((s) => String(s.name || '').trim())
          .filter(Boolean)
      );
      if (!allowed.has(resolvedDeliveryName)) {
        throw new Error('Selected delivery person is not registered on this branch');
      }
    }
    const isDelivery = Boolean(resolvedDeliveryName) || !isPickup;

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
          ...(isDelivery ? { isDelivery: true } : {}),
          ...(resolvedDeliveryName ? { deliveryPersonName: resolvedDeliveryName } : {}),
        },
      ],
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

    await Promise.all([
      EcommerceChannelReservation.updateMany(
        { ecommerceOrderId: current.reservationKey, status: 'active' },
        { $set: { status: 'converted', invexOrderId: invoice._id } },
        { session }
      ),
      ProductBooking.updateMany(
        { ecommerceOrderId: current.reservationKey, source: 'ecommerce', status: 'active' },
        {
          $set: {
            status: 'cancelled',
            cancelledAt: new Date(),
            cancelReason: 'Converted to Invex invoice',
          },
        },
        { session }
      ),
      current.save({ session }),
    ]);
    await session.commitTransaction();

    scheduleProductSideEffects(touched, 'CRM completion post-update');
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
      const completed = await completeOnlineOrder(order, actor, req.body?.paymentMethod, {
        deliveryPersonName: req.body?.deliveryPersonName,
      });
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
