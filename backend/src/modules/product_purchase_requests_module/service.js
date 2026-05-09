import mongoose from 'mongoose';
import ProductPurchaseRequest from '../../DB/models/productPurchaseRequest.model.js';
import Product from '../../DB/models/product.model.js';
import Category from '../../DB/models/category.model.js';
import User from '../../DB/models/user.model.js';
import Branch from '../../DB/models/branch.model.js';
import StockMovement from '../../DB/models/stockMovement.model.js';
import Notification from '../../DB/models/notification.model.js';
import { emitToUsers } from '../../realtime/socket.js';
import { auditLog } from '../audit_module/audit.service.js';

const normalizeAttrKey = (raw) =>
  String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');

const normalizeImageUrl = (raw) => {
  if (raw == null || raw === '') return '';
  const s = String(raw).trim();
  if (!s) return '';
  if (!/^https:\/\//i.test(s)) return '';
  return s.slice(0, 2048);
};

const normalizeAttributesForCategory = async (categoryId, raw) => {
  if (raw == null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  const cat = await Category.findById(categoryId).select('attributeDefs').lean();
  const defs = Array.isArray(cat?.attributeDefs) ? cat.attributeDefs : [];
  if (!defs.length) return {};
  const allowed = new Set(defs.map((d) => normalizeAttrKey(d?.key)));
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    const key = normalizeAttrKey(k);
    if (!key || !allowed.has(key)) continue;
    const val = String(v ?? '').trim();
    if (val === '') continue;
    out[key] = val.slice(0, 500);
  }
  return out;
};

function isAutoApproverRole(role) {
  const r = String(role || '').trim();
  return r === 'Super Admin' || r === 'Co Admin' || r === 'Branch Manager';
}

async function collectApproverUserIds(branchId) {
  const query = {
    $or: [{ role: { $in: ['Super Admin', 'Co Admin'] } }, { role: 'Branch Manager', branch: branchId }],
  };
  const users = await User.find(query).select('_id').lean();
  return users.map((u) => u._id);
}

export const listProductPurchaseRequests = async (req, res) => {
  try {
    const { status, branchId, page = 1, limit = 20 } = req.query;
    const p = Math.max(1, Number(page) || 1);
    const lim = Math.max(1, Math.min(50, Number(limit) || 20));
    const skip = (p - 1) * lim;

    const q = {};
    if (status && ['pending', 'approved', 'rejected'].includes(String(status))) {
      q.status = String(status);
    }
    if (branchId && mongoose.Types.ObjectId.isValid(String(branchId))) {
      q.branch = new mongoose.Types.ObjectId(String(branchId));
    }

    const [items, total] = await Promise.all([
      ProductPurchaseRequest.find(q)
        .populate('branch', 'name')
        .populate('createdBy', 'name role')
        .populate('resolvedBy', 'name role')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(lim)
        .lean(),
      ProductPurchaseRequest.countDocuments(q),
    ]);

    return res.json({ purchases: items, meta: { totalCount: total, page: p, limit: lim } });
  } catch (e) {
    console.error('listProductPurchaseRequests:', e);
    return res.status(500).json({ error: 'Failed to fetch product purchase requests' });
  }
};

export const createProductPurchaseRequest = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { userId, branchId, quantity: qtyRaw, product } = req.body || {};

    if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: 'userId is required' });
    }
    if (!branchId || !mongoose.Types.ObjectId.isValid(String(branchId))) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: 'branchId is required' });
    }

    const actor = await User.findById(userId).select('_id name role branch').session(session);
    if (!actor) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: 'User not found' });
    }

    const branch = await Branch.findById(branchId).select('_id name').session(session).lean();
    if (!branch) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: 'Branch not found' });
    }

    const q = Math.max(1, Math.floor(Number(qtyRaw) || 1));

    const name = String(product?.name || '').trim();
    const code = String(product?.code || '').trim();
    const categoryId = product?.categoryId || product?.category;
    const priceNum = Number(product?.price);
    const netNum = Number(product?.netPrice);
    const notes = String(product?.notes || '').trim().slice(0, 500);
    const discountNum =
      product?.discount === undefined || product?.discount === null || product?.discount === ''
        ? 0
        : Number(product?.discount);
    const imageUrlNorm = normalizeImageUrl(product?.imageUrl);

    if (!name || !code || !categoryId) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: 'name, code, categoryId are required' });
    }
    if (!mongoose.Types.ObjectId.isValid(String(categoryId))) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: 'Invalid categoryId' });
    }
    if (Number.isNaN(priceNum) || priceNum < 0 || Number.isNaN(netNum) || netNum < 0) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: 'Valid price and netPrice are required' });
    }
    if (Number.isNaN(discountNum) || discountNum < 0 || discountNum > 100) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: 'Invalid discount' });
    }

    const attrsNorm = await normalizeAttributesForCategory(String(categoryId), product?.attributes);
    if (attrsNorm === null) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: 'attributes must be an object' });
    }

    const payload = {
      name,
      code,
      category: new mongoose.Types.ObjectId(String(categoryId)),
      price: Math.round(priceNum * 100) / 100,
      netPrice: Math.round(netNum * 100) / 100,
      discount: Math.round(discountNum * 100) / 100,
      attributes: attrsNorm,
      imageUrl: imageUrlNorm,
      notes,
    };

    const autoApprove = isAutoApproverRole(actor.role);

    const purchase = await ProductPurchaseRequest.create(
      [
        {
          status: autoApprove ? 'approved' : 'pending',
          branch: new mongoose.Types.ObjectId(String(branchId)),
          createdBy: actor._id,
          productPayload: payload,
          quantity: q,
          ...(autoApprove
            ? { resolvedBy: actor._id, resolvedAt: new Date(), resolutionNote: 'Auto-approved' }
            : {}),
        },
      ],
      { session }
    );
    const created = purchase[0];

    let createdProduct = null;

    if (autoApprove) {
      const existing = await Product.findOne({ code, branch: branchId }).session(session);
      if (existing) {
        await session.abortTransaction();
        session.endSession();
        return res.status(409).json({ error: 'Product code already exists in this branch' });
      }

      const [prod] = await Product.create(
        [
          {
            name,
            code,
            price: payload.price,
            netPrice: payload.netPrice,
            stock: q,
            discount: payload.discount,
            category: payload.category,
            branch: branchId,
            inWarehouse: false,
            imageUrl: payload.imageUrl,
            attributes: payload.attributes,
          },
        ],
        { session }
      );
      createdProduct = prod;

      created.createdProductId = prod._id;
      await created.save({ session });

      await session.commitTransaction();
      session.endSession();

      try {
        await StockMovement.create({
          movementType: 'purchase',
          productId: prod._id,
          productName: prod.name,
          branchId: branchId,
          fromBranchId: null,
          toBranchId: branchId,
          quantity: q,
          unitPrice: payload.netPrice,
          totalValue: Math.round(payload.netPrice * q * 100) / 100,
          referenceType: 'productPurchaseRequest',
          referenceId: created._id,
          notes: `Product purchase (desk, auto-approved)`,
        });
      } catch (e) {
        console.warn('⚠️ product purchase stock movement:', e?.message || e);
      }

      await auditLog(req, {
        action: 'create',
        module: 'product_purchase_requests',
        entityType: 'ProductPurchaseRequest',
        entityId: created?._id,
        message: 'Product purchase request created (auto-approved)',
        metadata: { branchId, productCode: code, quantity: q, createdProductId: prod._id },
      });

      return res.status(201).json({
        message: '✅ Purchase created and approved',
        purchase: created.toObject ? created.toObject() : created,
        createdProduct,
      });
    }

    await session.commitTransaction();
    session.endSession();

    try {
      const recipientIds = await collectApproverUserIds(branchId);
      const notification = await Notification.create({
        type: 'product_purchase_pending',
        title: 'Product purchase pending approval',
        body: `${name} (${code}) — ${q} unit(s) · Branch: ${branch?.name || 'Branch'}`,
        data: {
          purchaseId: created._id,
          branchId,
          branchName: branch?.name || null,
          createdById: actor._id,
          createdByName: actor?.name || null,
          product: { name, code, categoryId: String(categoryId), price: payload.price, netPrice: payload.netPrice },
          quantity: q,
        },
        recipients: recipientIds,
        readBy: [],
      });
      emitToUsers(recipientIds, 'notification:new', { notification });
    } catch (e) {
      console.warn('⚠️ product purchase notification:', e?.message || e);
    }

    await auditLog(req, {
      action: 'create',
      module: 'product_purchase_requests',
      entityType: 'ProductPurchaseRequest',
      entityId: created?._id,
      message: 'Product purchase request created (pending approval)',
      metadata: { branchId, productCode: code, quantity: q },
    });

    return res.status(201).json({
      message: '✅ Purchase created (pending approval)',
      purchase: created.toObject ? created.toObject() : created,
      createdProduct,
    });
  } catch (e) {
    await session.abortTransaction();
    session.endSession();
    console.error('createProductPurchaseRequest:', e);
    return res.status(500).json({ error: 'Failed to create product purchase request', details: e?.message });
  }
};

export const approveProductPurchaseRequest = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { id } = req.params;
    const { userId, resolutionNote } = req.body || {};
    if (!id || !mongoose.Types.ObjectId.isValid(String(id))) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: 'Invalid purchase id' });
    }
    if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: 'userId is required' });
    }

    const actor = await User.findById(userId).select('_id name role branch').session(session);
    if (!actor) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: 'User not found' });
    }

    const purchase = await ProductPurchaseRequest.findById(id).session(session);
    if (!purchase || purchase.status !== 'pending') {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ error: 'Pending purchase not found' });
    }

    const isAllowed =
      actor.role === 'Super Admin' ||
      actor.role === 'Co Admin' ||
      (actor.role === 'Branch Manager' && String(actor.branch) === String(purchase.branch));
    if (!isAllowed) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({ error: 'You cannot approve this purchase' });
    }

    const q = Math.max(1, Math.floor(Number(purchase.quantity) || 1));
    const pp = purchase.productPayload || {};
    const code = String(pp.code || '').trim();

    const existing = await Product.findOne({ code, branch: purchase.branch }).session(session);
    if (existing) {
      await session.abortTransaction();
      session.endSession();
      return res.status(409).json({ error: 'Product code already exists in this branch' });
    }

    const attrsNorm = await normalizeAttributesForCategory(String(pp.category), pp.attributes);
    if (attrsNorm === null) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: 'Invalid attributes' });
    }

    const [prod] = await Product.create(
      [
        {
          name: pp.name,
          code,
          price: Number(pp.price) || 0,
          netPrice: Number(pp.netPrice) || 0,
          stock: q,
          discount: Number(pp.discount) || 0,
          category: pp.category,
          branch: purchase.branch,
          inWarehouse: false,
          imageUrl: normalizeImageUrl(pp.imageUrl),
          attributes: attrsNorm,
        },
      ],
      { session }
    );

    purchase.status = 'approved';
    purchase.resolvedBy = actor._id;
    purchase.resolvedAt = new Date();
    purchase.resolutionNote = String(resolutionNote || '').trim().slice(0, 500);
    purchase.createdProductId = prod._id;
    await purchase.save({ session });

    await session.commitTransaction();
    session.endSession();

    try {
      await StockMovement.create({
        movementType: 'purchase',
        productId: prod._id,
        productName: prod.name,
        branchId: purchase.branch,
        fromBranchId: null,
        toBranchId: purchase.branch,
        quantity: q,
        unitPrice: Number(pp.netPrice) || 0,
        totalValue: Math.round((Number(pp.netPrice) || 0) * q * 100) / 100,
        referenceType: 'productPurchaseRequest',
        referenceId: purchase._id,
        notes: `Product purchase approved`,
      });
    } catch (e) {
      console.warn('⚠️ product purchase approve stock movement:', e?.message || e);
    }

    try {
      const creatorId = purchase.createdBy;
      if (creatorId && String(creatorId) !== String(actor._id)) {
        const notification = await Notification.create({
          type: 'product_purchase_approved',
          title: 'Product purchase approved',
          body: `${pp.name} (${pp.code}) — approved by ${(actor?.name || 'Manager').trim()}`,
          data: { purchaseId: purchase._id, productId: prod._id, approvedById: actor._id },
          recipients: [creatorId],
          readBy: [],
        });
        emitToUsers([creatorId], 'notification:new', { notification });
      }
    } catch (e) {
      console.warn('⚠️ product purchase approve notify creator:', e?.message || e);
    }

    await auditLog(req, {
      action: 'approve',
      module: 'product_purchase_requests',
      entityType: 'ProductPurchaseRequest',
      entityId: purchase?._id,
      message: 'Product purchase request approved',
      metadata: { productId: prod._id, quantity: q, branchId: purchase.branch },
    });

    return res.json({ message: '✅ Approved', purchase, createdProduct: prod });
  } catch (e) {
    await session.abortTransaction();
    session.endSession();
    console.error('approveProductPurchaseRequest:', e);
    return res.status(500).json({ error: 'Failed to approve purchase', details: e?.message });
  }
};

export const rejectProductPurchaseRequest = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { id } = req.params;
    const { userId, resolutionNote } = req.body || {};
    if (!id || !mongoose.Types.ObjectId.isValid(String(id))) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: 'Invalid purchase id' });
    }
    if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: 'userId is required' });
    }

    const actor = await User.findById(userId).select('_id name role branch').session(session);
    if (!actor) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: 'User not found' });
    }

    const purchase = await ProductPurchaseRequest.findById(id).session(session);
    if (!purchase || purchase.status !== 'pending') {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ error: 'Pending purchase not found' });
    }

    const isAllowed =
      actor.role === 'Super Admin' ||
      actor.role === 'Co Admin' ||
      (actor.role === 'Branch Manager' && String(actor.branch) === String(purchase.branch));
    if (!isAllowed) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({ error: 'You cannot reject this purchase' });
    }

    purchase.status = 'rejected';
    purchase.resolvedBy = actor._id;
    purchase.resolvedAt = new Date();
    purchase.resolutionNote = String(resolutionNote || '').trim().slice(0, 500);
    await purchase.save({ session });

    await session.commitTransaction();
    session.endSession();

    try {
      const creatorId = purchase.createdBy;
      const pp = purchase.productPayload || {};
      if (creatorId && String(creatorId) !== String(actor._id)) {
        const notification = await Notification.create({
          type: 'product_purchase_rejected',
          title: 'Product purchase rejected',
          body: `${pp.name || 'Product'} (${pp.code || ''}) — rejected by ${(actor?.name || 'Manager').trim()}`,
          data: { purchaseId: purchase._id, rejectedById: actor._id, note: purchase.resolutionNote },
          recipients: [creatorId],
          readBy: [],
        });
        emitToUsers([creatorId], 'notification:new', { notification });
      }
    } catch (e) {
      console.warn('⚠️ product purchase reject notify creator:', e?.message || e);
    }

    await auditLog(req, {
      action: 'reject',
      module: 'product_purchase_requests',
      entityType: 'ProductPurchaseRequest',
      entityId: purchase?._id,
      message: 'Product purchase request rejected',
      metadata: { branchId: purchase.branch },
    });

    return res.json({ message: '✅ Rejected', purchase });
  } catch (e) {
    await session.abortTransaction();
    session.endSession();
    console.error('rejectProductPurchaseRequest:', e);
    return res.status(500).json({ error: 'Failed to reject purchase', details: e?.message });
  }
};
