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
import { resolveProductAcquiredFrom } from '../../utils/product-source-party.js';
import {
  allocateSequentialProductCodes,
  assertCodesNotUsedInStorage,
  validateProductCodeForCategory,
} from '../products_module/service.js';
import {
  getEffectivePurchaseTreasuryMethodsFromDb,
  treasuryMethodMap,
} from '../settings_module/treasuryMethods.js';
import {
  syncDeferredSupplierDeskPurchase,
} from '../../utils/desk-purchase-deferred.js';
import {
  deskPurchaseLineTotal,
  normalizePurchaseTreasuryInput,
  purchaseHasDeferredTreasury,
} from '../../utils/purchase-treasury-splits.js';

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

const normalizeAddedBy = (raw) => String(raw ?? '').trim().slice(0, 200);

async function leanPurchaseForResponse(purchaseId) {
  if (!purchaseId) return null;
  return ProductPurchaseRequest.findById(purchaseId).lean();
}

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

/** Populated refs are `{ _id, ... }`; permission checks must compare raw ObjectIds. */
function dereferenceDocId(ref) {
  if (ref == null) return ref;
  if (typeof ref === 'object' && ref._id != null) return ref._id;
  return ref;
}

export const getProductPurchaseRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.query;
    if (!id || !mongoose.Types.ObjectId.isValid(String(id))) {
      return res.status(400).json({ error: 'Invalid purchase id' });
    }
    if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const actor = await User.findById(userId).select('_id name role branch').lean();
    if (!actor) {
      return res.status(400).json({ error: 'User not found' });
    }

    const purchase = await ProductPurchaseRequest.findById(id)
      .populate('branch', 'name')
      .populate('createdBy', 'name role')
      .populate('resolvedBy', 'name role')
      .lean();

    if (!purchase) {
      return res.status(404).json({ error: 'Purchase not found' });
    }

    const isAllowed =
      actor.role === 'Super Admin' ||
      actor.role === 'Co Admin' ||
      (actor.role === 'Branch Manager' &&
        String(dereferenceDocId(actor.branch)) === String(dereferenceDocId(purchase.branch)));
    if (!isAllowed) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    return res.json({ purchase });
  } catch (e) {
    console.error('getProductPurchaseRequest:', e);
    return res.status(500).json({ error: 'Failed to fetch purchase' });
  }
};

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
    const {
      userId,
      branchId,
      quantity: qtyRaw,
      product,
      purchaseTreasuryKey: treasuryKeyRaw,
      purchaseTreasurySplits: treasurySplitsRaw,
    } = req.body || {};

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

    const catMultiRow = await Category.findById(String(categoryId)).select('multiCodePerPiece').session(session).lean();
    const categoryIsMulti = !!catMultiRow?.multiCodePerPiece;

    let unitCodesNorm = [];
    if (categoryIsMulti && q > 1) {
      const raw = Array.isArray(product?.unitCodes) ? product.unitCodes : [];
      unitCodesNorm = raw.map((x) => String(x ?? '').trim()).filter(Boolean);
      if (unitCodesNorm.length !== q) {
        try {
          unitCodesNorm = await allocateSequentialProductCodes(String(categoryId), q);
        } catch (e) {
          await session.abortTransaction();
          session.endSession();
          return res.status(400).json({ error: e?.message || 'Cannot allocate codes' });
        }
      }
      const seen = new Set(unitCodesNorm.map((c) => c.toUpperCase()));
      if (seen.size !== unitCodesNorm.length) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ error: 'Duplicate codes in unitCodes' });
      }
      for (const c of unitCodesNorm) {
        const chk = await validateProductCodeForCategory(String(categoryId), c);
        if (!chk.ok) {
          await session.abortTransaction();
          session.endSession();
          return res.status(400).json({ error: chk.error });
        }
      }
    }

    const addedByNorm = normalizeAddedBy(product?.addedBy);
    const payload = {
      name,
      code: categoryIsMulti && q > 1 ? unitCodesNorm[0] : code,
      category: new mongoose.Types.ObjectId(String(categoryId)),
      price: Math.round(priceNum * 100) / 100,
      netPrice: Math.round(netNum * 100) / 100,
      discount: Math.round(discountNum * 100) / 100,
      attributes: attrsNorm,
      imageUrl: imageUrlNorm,
      notes,
      ...(addedByNorm ? { addedBy: addedByNorm } : {}),
    };
    if (categoryIsMulti && q > 1) {
      payload.unitCodes = unitCodesNorm;
    }
    if (product?.acquiredFrom && typeof product.acquiredFrom === 'object') {
      payload.acquiredFrom = product.acquiredFrom;
    }

    let acquiredFromFields = {};
    try {
      const resolved = await resolveProductAcquiredFrom(
        { acquiredFrom: payload.acquiredFrom },
        { categoryId: String(categoryId), branchOid: branchId }
      );
      if (resolved?.acquiredFrom) {
        acquiredFromFields = { acquiredFrom: resolved.acquiredFrom };
        payload.acquiredFrom = resolved.acquiredFrom;
      }
    } catch (e) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: e?.message || 'Invalid source party', code: e?.code });
    }

    const autoApprove = isAutoApproverRole(actor.role);

    const treasuryMethods = await getEffectivePurchaseTreasuryMethodsFromDb();
    const tMap = treasuryMethodMap(treasuryMethods);
    const lineTotal = Math.round(netNum * q * 100) / 100;
    const treasuryNorm = normalizePurchaseTreasuryInput({
      purchaseTreasurySplits: treasurySplitsRaw,
      purchaseTreasuryKey: treasuryKeyRaw,
      lineTotal,
      treasuryMethods,
      tMap,
    });
    if (treasuryNorm.error) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: treasuryNorm.error });
    }
    const {
      splits: purchaseTreasurySplits,
      treasuryKey: treasuryKeyNorm,
      treasuryLabel: purchaseTreasuryLabel,
      amountPaid: treasuryAmountPaid,
      hasDeferred: treasuryHasDeferred,
    } = treasuryNorm;

    const purchase = await ProductPurchaseRequest.create(
      [
        {
          status: autoApprove ? 'approved' : 'pending',
          branch: new mongoose.Types.ObjectId(String(branchId)),
          createdBy: actor._id,
          productPayload: payload,
          quantity: q,
          purchaseTreasuryKey: treasuryKeyNorm,
          purchaseTreasuryLabel,
          purchaseTreasurySplits,
          ...(treasuryHasDeferred ? { amountPaid: treasuryAmountPaid } : {}),
          ...(autoApprove
            ? { resolvedBy: actor._id, resolvedAt: new Date(), resolutionNote: 'Auto-approved' }
            : {}),
        },
      ],
      { session }
    );
    const created = purchase[0];
    if (purchaseTreasurySplits?.length) {
      created.set('purchaseTreasurySplits', purchaseTreasurySplits);
      created.markModified('purchaseTreasurySplits');
      await created.save({ session });
    }

    let createdProduct = null;

    if (autoApprove) {
      if (categoryIsMulti && q > 1) {
        const free = await assertCodesNotUsedInStorage(unitCodesNorm, branchId, false);
        if (!free.ok) {
          await session.abortTransaction();
          session.endSession();
          return res.status(409).json({ error: free.error });
        }
        const createdList = [];
        for (const unitCode of unitCodesNorm) {
          const [prodRow] = await Product.create(
            [
              {
                name,
                code: unitCode,
                price: payload.price,
                netPrice: payload.netPrice,
                stock: 1,
                discount: payload.discount,
                category: payload.category,
                branch: branchId,
                inWarehouse: false,
                imageUrl: payload.imageUrl,
                attributes: payload.attributes,
                ...(payload.addedBy ? { addedBy: payload.addedBy } : {}),
                ...acquiredFromFields,
              },
            ],
            { session }
          );
          createdList.push(prodRow);
        }
        createdProduct = createdList[0];
        created.createdProductId = createdList[0]._id;
        created.createdProductIds = createdList.map((p) => p._id);
        await created.save({ session });

        await session.commitTransaction();
        session.endSession();

        if (purchaseHasDeferredTreasury(created)) {
          try {
            await syncDeferredSupplierDeskPurchase(created, {
              userId: actor._id,
              actorName: actor?.name,
            });
          } catch (e) {
            console.error('⚠️ deferred desk purchase vendor sync:', e?.message || e);
          }
        }

        for (const prodRow of createdList) {
          try {
            await StockMovement.create({
              movementType: 'purchase',
              productId: prodRow._id,
              productName: prodRow.name,
              branchId: branchId,
              fromBranchId: null,
              toBranchId: branchId,
              quantity: 1,
              unitPrice: payload.netPrice,
              totalValue: Math.round(payload.netPrice * 100) / 100,
              referenceType: 'productPurchaseRequest',
              referenceId: created._id,
              notes: `Product purchase (desk, auto-approved, multi-code)`,
            });
          } catch (e) {
            console.warn('⚠️ product purchase stock movement:', e?.message || e);
          }
        }

        await auditLog(req, {
          action: 'create',
          module: 'product_purchase_requests',
          entityType: 'ProductPurchaseRequest',
          entityId: created?._id,
          message: 'Product purchase request created (auto-approved, multi-code)',
          metadata: {
            branchId,
            productCodes: unitCodesNorm,
            quantity: q,
            createdProductId: createdList[0]._id,
            createdProductIds: createdList.map((p) => String(p._id)),
          },
        });

        const purchaseOut = await leanPurchaseForResponse(created._id);
        return res.status(201).json({
          message: '✅ Purchase created and approved',
          purchase: purchaseOut || (created.toObject ? created.toObject() : created),
          createdProduct,
          createdProducts: createdList,
        });
      }

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
            ...(payload.addedBy ? { addedBy: payload.addedBy } : {}),
            ...acquiredFromFields,
          },
        ],
        { session }
      );
      createdProduct = prod;

      created.createdProductId = prod._id;
      await created.save({ session });

      await session.commitTransaction();
      session.endSession();

      if (purchaseHasDeferredTreasury(created)) {
        try {
          await syncDeferredSupplierDeskPurchase(created, {
            userId: actor._id,
            actorName: actor?.name,
          });
        } catch (e) {
          console.error('⚠️ deferred desk purchase vendor sync:', e?.message || e);
        }
      }

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
          totalValue: deskPurchaseLineTotal(created),
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

      const purchaseOut = await leanPurchaseForResponse(created._id);
      return res.status(201).json({
        message: '✅ Purchase created and approved',
        purchase: purchaseOut || (created.toObject ? created.toObject() : created),
        createdProduct,
      });
    }

    await session.commitTransaction();
    session.endSession();

    try {
      const recipientIds = await collectApproverUserIds(branchId);
      const codeSummary =
        categoryIsMulti && q > 1 && unitCodesNorm.length ? unitCodesNorm.join(', ') : code;
      const notification = await Notification.create({
        type: 'product_purchase_pending',
        title: 'Product purchase pending approval',
        body: `${name} (${codeSummary}) — ${q} unit(s) · Branch: ${branch?.name || 'Branch'}`,
        data: {
          purchaseId: created._id,
          branchId,
          branchName: branch?.name || null,
          createdById: actor._id,
          createdByName: actor?.name || null,
          product: {
            name,
            code: codeSummary,
            categoryId: String(categoryId),
            price: payload.price,
            netPrice: payload.netPrice,
            ...(categoryIsMulti && q > 1 && unitCodesNorm.length ? { unitCodes: unitCodesNorm } : {}),
          },
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

    const purchaseOut = await leanPurchaseForResponse(created._id);
    return res.status(201).json({
      message: '✅ Purchase created (pending approval)',
      purchase: purchaseOut || (created.toObject ? created.toObject() : created),
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
      (actor.role === 'Branch Manager' &&
        String(dereferenceDocId(actor.branch)) === String(dereferenceDocId(purchase.branch)));
    if (!isAllowed) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({ error: 'You cannot approve this purchase' });
    }

    const q = Math.max(1, Math.floor(Number(purchase.quantity) || 1));
    const pp = purchase.productPayload || {};
    const code = String(pp.code || '').trim();

    const attrsNorm = await normalizeAttributesForCategory(String(pp.category), pp.attributes);
    if (attrsNorm === null) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: 'Invalid attributes' });
    }

    const categoryIdStr = String(pp.category);
    const catMultiRow = await Category.findById(categoryIdStr).select('multiCodePerPiece').session(session).lean();
    const categoryIsMulti = !!catMultiRow?.multiCodePerPiece;

    let acquiredFromFields = {};
    try {
      const resolved = await resolveProductAcquiredFrom(
        { acquiredFrom: pp.acquiredFrom },
        { categoryId: categoryIdStr, branchOid: purchase.branch }
      );
      if (resolved?.acquiredFrom) {
        acquiredFromFields = { acquiredFrom: resolved.acquiredFrom };
      }
    } catch (e) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: e?.message || 'Invalid source party', code: e?.code });
    }

    let prod;
    let createdList = [];

    if (categoryIsMulti && q > 1) {
      const raw = Array.isArray(pp.unitCodes) ? pp.unitCodes : [];
      const codes = raw.map((x) => String(x ?? '').trim()).filter(Boolean);
      if (codes.length !== q) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ error: 'Purchase is missing unit codes for multi-code category' });
      }
      const seen = new Set(codes.map((c) => c.toUpperCase()));
      if (seen.size !== codes.length) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ error: 'Duplicate codes on purchase request' });
      }
      for (const c of codes) {
        const chk = await validateProductCodeForCategory(categoryIdStr, c);
        if (!chk.ok) {
          await session.abortTransaction();
          session.endSession();
          return res.status(400).json({ error: chk.error });
        }
      }
      const free = await assertCodesNotUsedInStorage(codes, purchase.branch, false);
      if (!free.ok) {
        await session.abortTransaction();
        session.endSession();
        return res.status(409).json({ error: free.error });
      }
      for (const unitCode of codes) {
        const [pRow] = await Product.create(
          [
            {
              name: pp.name,
              code: unitCode,
              price: Number(pp.price) || 0,
              netPrice: Number(pp.netPrice) || 0,
              stock: 1,
              discount: Number(pp.discount) || 0,
              category: pp.category,
              branch: purchase.branch,
              inWarehouse: false,
              imageUrl: normalizeImageUrl(pp.imageUrl),
              attributes: attrsNorm,
              ...(pp.addedBy ? { addedBy: normalizeAddedBy(pp.addedBy) } : {}),
              ...acquiredFromFields,
            },
          ],
          { session }
        );
        createdList.push(pRow);
      }
      prod = createdList[0];
    } else {
      const existing = await Product.findOne({ code, branch: purchase.branch }).session(session);
      if (existing) {
        await session.abortTransaction();
        session.endSession();
        return res.status(409).json({ error: 'Product code already exists in this branch' });
      }

      const [pRow] = await Product.create(
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
            ...(pp.addedBy ? { addedBy: normalizeAddedBy(pp.addedBy) } : {}),
            ...acquiredFromFields,
          },
        ],
        { session }
      );
      prod = pRow;
      createdList = [pRow];
    }

    purchase.status = 'approved';
    purchase.resolvedBy = actor._id;
    purchase.resolvedAt = new Date();
    purchase.resolutionNote = String(resolutionNote || '').trim().slice(0, 500);
    purchase.createdProductId = prod._id;
    if (createdList.length > 1) {
      purchase.createdProductIds = createdList.map((p) => p._id);
    }
    await purchase.save({ session });

    await session.commitTransaction();
    session.endSession();

    if (purchaseHasDeferredTreasury(purchase)) {
      try {
        if (acquiredFromFields.acquiredFrom) {
          purchase.productPayload = purchase.productPayload || {};
          purchase.productPayload.acquiredFrom = acquiredFromFields.acquiredFrom;
        }
        await syncDeferredSupplierDeskPurchase(purchase, {
          userId: actor._id,
          actorName: actor?.name,
        });
      } catch (e) {
        console.error('⚠️ deferred desk purchase approve vendor sync:', e?.message || e);
      }
    }

    try {
      if (createdList.length > 1) {
        for (const pRow of createdList) {
          await StockMovement.create({
            movementType: 'purchase',
            productId: pRow._id,
            productName: pRow.name,
            branchId: purchase.branch,
            fromBranchId: null,
            toBranchId: purchase.branch,
            quantity: 1,
            unitPrice: Number(pp.netPrice) || 0,
            totalValue: Math.round((Number(pp.netPrice) || 0) * 100) / 100,
            referenceType: 'productPurchaseRequest',
            referenceId: purchase._id,
            notes: `Product purchase approved (multi-code)`,
          });
        }
      } else {
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
      }
    } catch (e) {
      console.warn('⚠️ product purchase approve stock movement:', e?.message || e);
    }

    try {
      const creatorId = purchase.createdBy;
      const codeSummary =
        createdList.length > 1
          ? createdList.map((p) => p.code).join(', ')
          : String(pp.code || '');
      if (creatorId && String(creatorId) !== String(actor._id)) {
        const notification = await Notification.create({
          type: 'product_purchase_approved',
          title: 'Product purchase approved',
          body: `${pp.name} (${codeSummary}) — approved by ${(actor?.name || 'Manager').trim()}`,
          data: {
            purchaseId: purchase._id,
            productId: prod._id,
            approvedById: actor._id,
            ...(createdList.length > 1 ? { productIds: createdList.map((p) => String(p._id)) } : {}),
          },
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
      metadata: {
        productId: prod._id,
        quantity: q,
        branchId: purchase.branch,
        ...(createdList.length > 1 ? { productIds: createdList.map((p) => String(p._id)) } : {}),
      },
    });

    return res.json({
      message: '✅ Approved',
      purchase,
      createdProduct: prod,
      ...(createdList.length > 1 ? { createdProducts: createdList } : {}),
    });
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
      (actor.role === 'Branch Manager' &&
        String(dereferenceDocId(actor.branch)) === String(dereferenceDocId(purchase.branch)));
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
