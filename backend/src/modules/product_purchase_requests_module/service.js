import mongoose from 'mongoose';
import moment from 'moment-timezone';
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
  assertSerialBodiesNotUsedInStorage,
  validateProductCodeForCategory,
} from '../products_module/service.js';
import {
  getEffectivePurchaseTreasuryMethodsFromDb,
  treasuryMethodMap,
} from '../settings_module/treasuryMethods.js';
import {
  recordDeskPurchaseDeferredPayment,
  syncDeferredSupplierDeskPurchase,
} from '../../utils/desk-purchase-deferred.js';
import { processPurchaseReturn } from '../../utils/purchase-return.js';
import {
  deskPurchaseLineTotal,
  normalizePurchaseTreasuryInput,
  purchaseHasDeferredTreasury,
} from '../../utils/purchase-treasury-splits.js';
import { enrichPurchasesAcquiredFromDisplay } from '../../utils/enrich-purchase-acquired-from.js';
import { postTreasurySplitOutflows, safeTreasuryPost } from '../../utils/treasury-ledger.js';

function ecommerceCatalogFieldsFromSource(src) {
  return {
    listedOnEcommerce: src?.listedOnEcommerce === true || src?.listedOnEcommerce === 'true',
    ecommerceDescription: String(src?.ecommerceDescription || '').trim().slice(0, 50000),
    ecommerceShortDescription: String(src?.ecommerceShortDescription || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 160),
    ecommerceIsFeatured: src?.ecommerceIsFeatured === true || src?.ecommerceIsFeatured === 'true',
  };
}

async function postDeskPurchaseTreasuryLedger(purchase, { userId, branchId } = {}) {
  if (!purchase) return;
  const splits = Array.isArray(purchase.purchaseTreasurySplits)
    ? purchase.purchaseTreasurySplits
    : [];
  if (!splits.length) return;
  if (String(purchase.status) !== 'approved') return;
  await safeTreasuryPost('desk_purchase', async () => {
    await postTreasurySplitOutflows({
      branchId: branchId || purchase.branch,
      splits,
      sourceType: 'desk_purchase',
      sourceId: purchase._id,
      note: String(purchase.productPayload?.name || 'Desk purchase').slice(0, 200),
      createdBy: userId,
    });
  });
}

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

/**
 * Soft-removed or sold-out (stock 0) products may be revived on re-purchase,
 * but only under the same category. Overwriting category with a different one
 * was allowing the same serial under the wrong category.
 */
function assertReviveCategoryMatches(existing, newCategoryId) {
  if (!existing?.category || newCategoryId == null || newCategoryId === '') {
    return { ok: true };
  }
  if (String(existing.category) !== String(newCategoryId)) {
    return {
      ok: false,
      code: 'PRODUCT_CODE_CATEGORY_MISMATCH',
      error:
        'Product code already exists under a different category; cannot revive with a mismatched category',
    };
  }
  return { ok: true };
}

/** Sold / soft-removed / zero-stock rows can be brought back into inventory. */
function canReviveExistingProduct(existing) {
  if (!existing) return false;
  if (existing.removedWhenOutOfStock === true) return true;
  return Number(existing.stock) <= 0;
}

/**
 * Restore a sold/soft-removed product row on re-purchase (same code + branch).
 * Returns null on success (mutates `existing`), or an error object.
 */
function applyPurchaseRevive(existing, { name, payload, quantity, acquiredFromFields }) {
  const catMatch = assertReviveCategoryMatches(existing, payload?.category);
  if (!catMatch.ok) return catMatch;
  const q = Math.max(1, Math.floor(Number(quantity) || 1));
  existing.stock = Math.max(0, (Number(existing.stock) || 0) + q);
  existing.removedWhenOutOfStock = false;
  if (name) existing.name = name;
  if (payload?.price != null) existing.price = payload.price;
  if (payload?.netPrice != null) existing.netPrice = payload.netPrice;
  if (payload?.discount != null) existing.discount = payload.discount;
  // Keep original category — never overwrite on revive.
  if (payload?.imageUrl != null) existing.imageUrl = payload.imageUrl;
  if (payload?.attributes) existing.attributes = payload.attributes;
  if (payload?.addedBy) existing.addedBy = payload.addedBy;
  if (payload?.listedOnEcommerce !== undefined) {
    existing.listedOnEcommerce =
      payload.listedOnEcommerce === true || payload.listedOnEcommerce === 'true';
  }
  if (payload?.ecommerceDescription !== undefined) {
    existing.ecommerceDescription = String(payload.ecommerceDescription || '').trim().slice(0, 50000);
  }
  if (payload?.ecommerceShortDescription !== undefined) {
    existing.ecommerceShortDescription = String(payload.ecommerceShortDescription || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 160);
  }
  if (payload?.ecommerceIsFeatured !== undefined) {
    existing.ecommerceIsFeatured =
      payload.ecommerceIsFeatured === true || payload.ecommerceIsFeatured === 'true';
  }
  if (acquiredFromFields && typeof acquiredFromFields === 'object') {
    Object.assign(existing, acquiredFromFields);
  }
  return null;
}

/** Keep lines[0] in sync when root createdProductId(s) are set. */
function syncFirstLineCreatedProducts(purchase, productId, productIds) {
  if (!purchase) return;
  if (!Array.isArray(purchase.lines) || !purchase.lines.length) {
    purchase.lines = [
      {
        productPayload: purchase.productPayload,
        quantity: Math.max(1, Math.floor(Number(purchase.quantity) || 1)),
      },
    ];
  }
  if (productId) {
    purchase.lines[0].createdProductId = productId;
  }
  if (Array.isArray(productIds) && productIds.length) {
    purchase.lines[0].createdProductIds = productIds;
  }
  purchase.markModified('lines');
}

/** Aggregate root createdProductIds from all lines. */
function refreshRootCreatedProductIds(purchase) {
  if (!purchase || !Array.isArray(purchase.lines) || !purchase.lines.length) return;
  const all = [];
  for (const line of purchase.lines) {
    if (Array.isArray(line.createdProductIds) && line.createdProductIds.length) {
      all.push(...line.createdProductIds);
    } else if (line.createdProductId) {
      all.push(line.createdProductId);
    }
  }
  if (!all.length) return;
  purchase.createdProductId = all[0];
  purchase.createdProductIds = all.length > 1 ? all : undefined;
}

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

/** Every category attributeDef must have a non-empty value in attrsNorm. */
const assertRequiredCategoryAttributes = async (categoryId, attrsNorm) => {
  const cat = await Category.findById(categoryId).select('attributeDefs').lean();
  const defs = Array.isArray(cat?.attributeDefs) ? cat.attributeDefs : [];
  for (const d of defs) {
    const key = normalizeAttrKey(d?.key);
    if (!key) continue;
    const label = String(d?.label || key).trim() || key;
    const val = String(attrsNorm?.[key] ?? '').trim();
    if (!val) {
      return { error: `Category attribute "${label}" is required` };
    }
  }
  return { ok: true };
};

/**
 * Optional per-unit price / discount / attributes for multi-code purchases.
 * Returns null when not provided (all units share product-level fields).
 */
async function resolveUnitDetails(product, categoryId, q, shared) {
  const raw = Array.isArray(product?.unitDetails) ? product.unitDetails : null;
  if (!raw || !raw.length) {
    return null;
  }
  if (raw.length !== q) {
    return { error: 'unitDetails length must match quantity' };
  }
  const details = [];
  for (let i = 0; i < raw.length; i++) {
    const row = raw[i] && typeof raw[i] === 'object' ? raw[i] : {};
    const code = String(row.code ?? '').trim();
    if (!code) {
      return { error: 'Each unitDetail requires a code' };
    }
    const priceNum = Number(row.price);
    const netNum = Number(row.netPrice);
    if (Number.isNaN(priceNum) || priceNum < 0 || Number.isNaN(netNum) || netNum < 0) {
      return { error: `Valid price and netPrice are required for unit ${i + 1}` };
    }
    const discountRaw =
      row.discount === undefined || row.discount === null || row.discount === ''
        ? shared.discount
        : Number(row.discount);
    if (Number.isNaN(discountRaw) || discountRaw < 0 || discountRaw > 100) {
      return { error: `Invalid discount for unit ${i + 1}` };
    }
    const attrsNorm = await normalizeAttributesForCategory(
      String(categoryId),
      row.attributes != null ? row.attributes : shared.attributes
    );
    if (attrsNorm === null) {
      return { error: `attributes must be an object for unit ${i + 1}` };
    }
    const attrsReq = await assertRequiredCategoryAttributes(String(categoryId), attrsNorm);
    if (!attrsReq.ok) {
      return { error: `${attrsReq.error} (unit ${i + 1})` };
    }
    details.push({
      code,
      price: Math.round(priceNum * 100) / 100,
      netPrice: Math.round(netNum * 100) / 100,
      discount: Math.round(Number(discountRaw) * 100) / 100,
      attributes: attrsNorm,
      imageUrl: normalizeImageUrl(row.imageUrl) || normalizeImageUrl(shared.imageUrl) || '',
    });
  }
  const seen = new Set(details.map((d) => d.code.toUpperCase()));
  if (seen.size !== details.length) {
    return { error: 'Duplicate codes in unitDetails' };
  }
  for (const d of details) {
    const chk = await validateProductCodeForCategory(String(categoryId), d.code);
    if (!chk.ok) {
      return { error: chk.error };
    }
  }
  return { unitDetails: details, unitCodes: details.map((d) => d.code) };
}

function unitFieldsFromPayload(payload, index, fallbackCode) {
  const details = Array.isArray(payload?.unitDetails) ? payload.unitDetails : null;
  if (details && details[index]) {
    const d = details[index];
    return {
      code: String(d.code || fallbackCode || '').trim(),
      price: Number(d.price) || 0,
      netPrice: Number(d.netPrice) || 0,
      discount: Number(d.discount) || 0,
      attributes:
        d.attributes && typeof d.attributes === 'object' && !Array.isArray(d.attributes)
          ? d.attributes
          : payload.attributes || {},
      imageUrl: normalizeImageUrl(d.imageUrl) || normalizeImageUrl(payload?.imageUrl) || '',
    };
  }
  return {
    code: String(fallbackCode || '').trim(),
    price: Number(payload?.price) || 0,
    netPrice: Number(payload?.netPrice) || 0,
    discount: Number(payload?.discount) || 0,
    attributes: payload?.attributes || {},
    imageUrl: normalizeImageUrl(payload?.imageUrl) || '',
  };
}

function lineTotalFromNetAndDetails(netNum, q, unitDetails) {
  if (Array.isArray(unitDetails) && unitDetails.length === q) {
    const sum = unitDetails.reduce((acc, d) => acc + (Number(d.netPrice) || 0), 0);
    return Math.round(sum * 100) / 100;
  }
  return Math.round(Number(netNum) * q * 100) / 100;
}

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

    await enrichPurchasesAcquiredFromDisplay([purchase]);

    return res.json({ purchase });
  } catch (e) {
    console.error('getProductPurchaseRequest:', e);
    return res.status(500).json({ error: 'Failed to fetch purchase' });
  }
};

export const listProductPurchaseRequests = async (req, res) => {
  try {
    const { status, branchId, page = 1, limit = 20, from, to, purchaseTreasuryKey } = req.query;
    const p = Math.max(1, Number(page) || 1);
    const lim = Math.max(1, Math.min(50, Number(limit) || 20));
    const skip = (p - 1) * lim;

    const q = {};
    if (
      status &&
      ['pending', 'approved', 'rejected', 'partially_returned', 'returned'].includes(String(status))
    ) {
      q.status = String(status);
    }
    if (branchId && mongoose.Types.ObjectId.isValid(String(branchId))) {
      q.branch = new mongoose.Types.ObjectId(String(branchId));
    }
    const treasuryKey = String(purchaseTreasuryKey || '')
      .trim()
      .toLowerCase();
    if (treasuryKey) {
      // Match single-treasury invoices or any split that used this bucket.
      q.$or = [
        { purchaseTreasuryKey: treasuryKey },
        { 'purchaseTreasurySplits.key': treasuryKey },
      ];
    }
    if (from || to) {
      const timezone = 'Africa/Cairo';
      const createdAt = {};
      if (from) {
        createdAt.$gte = moment.tz(String(from).trim(), 'YYYY-MM-DD', timezone).startOf('day').utc().toDate();
      }
      if (to) {
        createdAt.$lte = moment.tz(String(to).trim(), 'YYYY-MM-DD', timezone).endOf('day').utc().toDate();
      }
      q.createdAt = createdAt;
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

    await enrichPurchasesAcquiredFromDisplay(items);

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
      exchangeTradeIn: exchangeTradeInRaw,
    } = req.body || {};
    const exchangeTradeIn = exchangeTradeInRaw === true || exchangeTradeInRaw === 'true';

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
    const hasUnitDetails =
      Array.isArray(product?.unitDetails) && product.unitDetails.length > 0;
    const firstUnit = hasUnitDetails ? product.unitDetails[0] : null;
    let priceNum = Number(
      firstUnit && (product?.price === undefined || product?.price === null || product?.price === '')
        ? firstUnit.price
        : product?.price
    );
    let netNum = Number(
      firstUnit && (product?.netPrice === undefined || product?.netPrice === null || product?.netPrice === '')
        ? firstUnit.netPrice
        : product?.netPrice
    );
    const notes = String(product?.notes || '').trim().slice(0, 500);
    let discountNum =
      product?.discount === undefined || product?.discount === null || product?.discount === ''
        ? firstUnit && firstUnit.discount !== undefined && firstUnit.discount !== null && firstUnit.discount !== ''
          ? Number(firstUnit.discount)
          : 0
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

    let attrsNorm = await normalizeAttributesForCategory(String(categoryId), product?.attributes);
    if (attrsNorm === null) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: 'attributes must be an object' });
    }

    const catMultiRow = await Category.findById(String(categoryId))
      .select('multiCodePerPiece code')
      .session(session)
      .lean();
    const categoryIsMulti = !!catMultiRow?.multiCodePerPiece;
    const categoryPrefix = catMultiRow?.code || '';

    let unitCodesNorm = [];
    let unitDetailsNorm = null;
    if (categoryIsMulti && q > 1) {
      const resolvedDetails = await resolveUnitDetails(product, categoryId, q, {
        price: priceNum,
        netPrice: netNum,
        discount: discountNum,
        attributes: attrsNorm,
        imageUrl: imageUrlNorm,
      });
      if (resolvedDetails?.error) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ error: resolvedDetails.error });
      }
      if (resolvedDetails?.unitDetails) {
        unitDetailsNorm = resolvedDetails.unitDetails;
        unitCodesNorm = resolvedDetails.unitCodes;
        attrsNorm = unitDetailsNorm[0]?.attributes || attrsNorm;
      } else {
        const attrsReq = await assertRequiredCategoryAttributes(String(categoryId), attrsNorm);
        if (!attrsReq.ok) {
          await session.abortTransaction();
          session.endSession();
          return res.status(400).json({ error: attrsReq.error });
        }
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
    } else {
      const attrsReq = await assertRequiredCategoryAttributes(String(categoryId), attrsNorm);
      if (!attrsReq.ok) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ error: attrsReq.error });
      }
      const codeChk = await validateProductCodeForCategory(String(categoryId), code);
      if (!codeChk.ok) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ error: codeChk.error });
      }
    }

    {
      const codesToCheck = categoryIsMulti && q > 1 ? unitCodesNorm : [code];
      const serialFree = await assertSerialBodiesNotUsedInStorage(codesToCheck, {
        categoryPrefix,
        session,
      });
      if (!serialFree.ok) {
        await session.abortTransaction();
        session.endSession();
        return res.status(409).json({ error: serialFree.error, code: serialFree.code });
      }
    }

    const addedByNorm = normalizeAddedBy(product?.addedBy);
    const rootPrice = unitDetailsNorm
      ? unitDetailsNorm[0].price
      : Math.round(priceNum * 100) / 100;
    const rootNet = unitDetailsNorm
      ? unitDetailsNorm[0].netPrice
      : Math.round(netNum * 100) / 100;
    const rootDiscount = unitDetailsNorm
      ? unitDetailsNorm[0].discount
      : Math.round(discountNum * 100) / 100;
    const payload = {
      name,
      code: categoryIsMulti && q > 1 ? unitCodesNorm[0] : code,
      category: new mongoose.Types.ObjectId(String(categoryId)),
      price: rootPrice,
      netPrice: rootNet,
      discount: rootDiscount,
      attributes: attrsNorm,
      imageUrl: imageUrlNorm,
      notes,
      ...(addedByNorm ? { addedBy: addedByNorm } : {}),
      ...ecommerceCatalogFieldsFromSource(product),
    };
    if (categoryIsMulti && q > 1) {
      payload.unitCodes = unitCodesNorm;
      if (unitDetailsNorm) {
        payload.unitDetails = unitDetailsNorm;
      }
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

    // Exchange trade-ins stay pending until cashier completes Pay (createOrder).
    // Auto-approve would create products/stock immediately and orphan them on cancel.
    const autoApprove = !exchangeTradeIn && isAutoApproverRole(actor.role);

    const treasuryMethods = await getEffectivePurchaseTreasuryMethodsFromDb();
    const tMap = treasuryMethodMap(treasuryMethods);
    const lineTotal = lineTotalFromNetAndDetails(netNum, q, unitDetailsNorm);
    const treasuryNorm = normalizePurchaseTreasuryInput({
      purchaseTreasurySplits: treasurySplitsRaw,
      purchaseTreasuryKey: treasuryKeyRaw,
      lineTotal,
      treasuryMethods,
      tMap,
      exchangeTradeIn,
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
          lines: [{ productPayload: payload, quantity: q }],
          purchaseTreasuryKey: treasuryKeyNorm,
          purchaseTreasuryLabel,
          purchaseTreasurySplits,
          isExchangeTradeIn: exchangeTradeIn,
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
          return res.status(409).json({
            error: free.error,
            code: 'PRODUCT_CODE_ALREADY_EXISTS',
          });
        }
        const createdList = [];
        for (let ui = 0; ui < unitCodesNorm.length; ui++) {
          const unitCode = unitCodesNorm[ui];
          const uf = unitFieldsFromPayload(payload, ui, unitCode);
          const unitFullCode = uf.code || unitCode;
          const existingUnit = await Product.findOne({
            code: unitFullCode,
            branch: branchId,
          }).session(session);
          if (existingUnit) {
            if (!canReviveExistingProduct(existingUnit)) {
              await session.abortTransaction();
              session.endSession();
              return res.status(409).json({
                error: 'Product code already exists in this branch',
                code: 'PRODUCT_CODE_ALREADY_EXISTS',
              });
            }
            const reviveErr = applyPurchaseRevive(existingUnit, {
              name,
              payload: {
                ...payload,
                price: uf.price,
                netPrice: uf.netPrice,
                discount: uf.discount,
                attributes: uf.attributes,
                imageUrl: uf.imageUrl || payload.imageUrl || '',
              },
              quantity: 1,
              acquiredFromFields,
            });
            if (reviveErr) {
              await session.abortTransaction();
              session.endSession();
              return res.status(409).json({ error: reviveErr.error, code: reviveErr.code });
            }
            await existingUnit.save({ session });
            createdList.push(existingUnit);
            continue;
          }
          const [prodRow] = await Product.create(
            [
              {
                name,
                code: unitFullCode,
                price: uf.price,
                netPrice: uf.netPrice,
                stock: 1,
                discount: uf.discount,
                category: payload.category,
                branch: branchId,
                inWarehouse: false,
                imageUrl: uf.imageUrl || payload.imageUrl || '',
                attributes: uf.attributes,
                ...(payload.addedBy ? { addedBy: payload.addedBy } : {}),
                listedOnEcommerce:
                  payload.listedOnEcommerce === true || payload.listedOnEcommerce === 'true',
                ecommerceDescription: String(payload.ecommerceDescription || ''),
            ecommerceShortDescription: String(payload.ecommerceShortDescription || ''),
            ecommerceIsFeatured: Boolean(payload.ecommerceIsFeatured),
                ecommerceShortDescription: String(payload.ecommerceShortDescription || ''),
                ecommerceIsFeatured: Boolean(payload.ecommerceIsFeatured),
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
        syncFirstLineCreatedProducts(created, createdList[0]._id, createdList.map((p) => p._id));
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

        for (let ui = 0; ui < createdList.length; ui++) {
          const prodRow = createdList[ui];
          const uf = unitFieldsFromPayload(payload, ui, prodRow.code);
          try {
            await StockMovement.create({
              movementType: 'purchase',
              productId: prodRow._id,
              productName: prodRow.name,
              branchId: branchId,
              fromBranchId: null,
              toBranchId: branchId,
              quantity: 1,
              unitPrice: uf.netPrice,
              totalValue: Math.round(uf.netPrice * 100) / 100,
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
        await postDeskPurchaseTreasuryLedger(created, { userId: actor._id, branchId });
        return res.status(201).json({
          message: '✅ Purchase created and approved',
          purchase: purchaseOut || (created.toObject ? created.toObject() : created),
          createdProduct,
          createdProducts: createdList,
        });
      }

      const existing = await Product.findOne({ code, branch: branchId }).session(session);
      if (existing) {
        if (canReviveExistingProduct(existing)) {
          const reviveErr = applyPurchaseRevive(existing, {
            name,
            payload,
            quantity: q,
            acquiredFromFields,
          });
          if (reviveErr) {
            await session.abortTransaction();
            session.endSession();
            return res.status(409).json({ error: reviveErr.error, code: reviveErr.code });
          }
          await existing.save({ session });
          createdProduct = existing;

          created.createdProductId = existing._id;
          syncFirstLineCreatedProducts(created, existing._id);
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
              productId: existing._id,
              productName: existing.name,
              branchId: branchId,
              fromBranchId: null,
              toBranchId: branchId,
              quantity: q,
              unitPrice: payload.netPrice,
              totalValue: deskPurchaseLineTotal(created),
              referenceType: 'productPurchaseRequest',
              referenceId: created._id,
              notes: `Product purchase (desk, revived soft-removed)`,
            });
          } catch (e) {
            console.warn('⚠️ product purchase stock movement:', e?.message || e);
          }

          await auditLog(req, {
            action: 'create',
            module: 'product_purchase_requests',
            entityType: 'ProductPurchaseRequest',
            entityId: created?._id,
            message: 'Product purchase request created (auto-approved, revived soft-removed)',
            metadata: { branchId, productCode: code, quantity: q, createdProductId: existing._id },
          });

          const purchaseOut = await leanPurchaseForResponse(created._id);
          await postDeskPurchaseTreasuryLedger(created, { userId: actor._id, branchId });
          return res.status(201).json({
            message: '✅ Purchase created and approved',
            purchase: purchaseOut || (created.toObject ? created.toObject() : created),
            createdProduct,
          });
        }

        await session.abortTransaction();
        session.endSession();
        return res.status(409).json({
          error: 'Product code already exists in this branch',
          code: 'PRODUCT_CODE_ALREADY_EXISTS',
        });
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
            listedOnEcommerce:
              payload.listedOnEcommerce === true || payload.listedOnEcommerce === 'true',
            ecommerceDescription: String(payload.ecommerceDescription || ''),
            ecommerceShortDescription: String(payload.ecommerceShortDescription || ''),
            ecommerceIsFeatured: Boolean(payload.ecommerceIsFeatured),
            ...acquiredFromFields,
          },
        ],
        { session }
      );
      createdProduct = prod;

      created.createdProductId = prod._id;
      syncFirstLineCreatedProducts(created, prod._id);
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
      await postDeskPurchaseTreasuryLedger(created, { userId: actor._id, branchId });
      return res.status(201).json({
        message: '✅ Purchase created and approved',
        purchase: purchaseOut || (created.toObject ? created.toObject() : created),
        createdProduct,
      });
    }

    await session.commitTransaction();
    session.endSession();

    // Exchange drafts await checkout — do not notify managers as pending approvals.
    if (!exchangeTradeIn) {
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
    }

    await auditLog(req, {
      action: 'create',
      module: 'product_purchase_requests',
      entityType: 'ProductPurchaseRequest',
      entityId: created?._id,
      message: exchangeTradeIn
        ? 'Exchange trade-in draft created (pending checkout)'
        : 'Product purchase request created (pending approval)',
      metadata: { branchId, productCode: code, quantity: q, exchangeTradeIn: !!exchangeTradeIn },
    });

    const purchaseOut = await leanPurchaseForResponse(created._id);
    return res.status(201).json({
      message: exchangeTradeIn
        ? '✅ Exchange trade-in draft created'
        : '✅ Purchase created (pending approval)',
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

/**
 * Build normalized productPayload + quantity for a desk purchase line (create / add-line).
 */
async function buildPurchaseLinePayload(product, qtyRaw, { session, branchId }) {
  const q = Math.max(1, Math.floor(Number(qtyRaw) || 1));
  const name = String(product?.name || '').trim();
  const code = String(product?.code || '').trim();
  const categoryId = product?.categoryId || product?.category;
  const hasUnitDetails =
    Array.isArray(product?.unitDetails) && product.unitDetails.length > 0;
  const firstUnit = hasUnitDetails ? product.unitDetails[0] : null;
  let priceNum = Number(
    firstUnit && (product?.price === undefined || product?.price === null || product?.price === '')
      ? firstUnit.price
      : product?.price
  );
  let netNum = Number(
    firstUnit && (product?.netPrice === undefined || product?.netPrice === null || product?.netPrice === '')
      ? firstUnit.netPrice
      : product?.netPrice
  );
  const notes = String(product?.notes || '').trim().slice(0, 500);
  let discountNum =
    product?.discount === undefined || product?.discount === null || product?.discount === ''
      ? firstUnit && firstUnit.discount !== undefined && firstUnit.discount !== null && firstUnit.discount !== ''
        ? Number(firstUnit.discount)
        : 0
      : Number(product?.discount);
  const imageUrlNorm = normalizeImageUrl(product?.imageUrl);

  if (!name || !code || !categoryId) {
    return { error: 'name, code, categoryId are required' };
  }
  if (!mongoose.Types.ObjectId.isValid(String(categoryId))) {
    return { error: 'Invalid categoryId' };
  }
  if (Number.isNaN(priceNum) || priceNum < 0 || Number.isNaN(netNum) || netNum < 0) {
    return { error: 'Valid price and netPrice are required' };
  }
  if (Number.isNaN(discountNum) || discountNum < 0 || discountNum > 100) {
    return { error: 'Invalid discount' };
  }

  let attrsNorm = await normalizeAttributesForCategory(String(categoryId), product?.attributes);
  if (attrsNorm === null) {
    return { error: 'attributes must be an object' };
  }

  const catMultiRow = await Category.findById(String(categoryId))
    .select('multiCodePerPiece code')
    .session(session)
    .lean();
  const categoryIsMulti = !!catMultiRow?.multiCodePerPiece;
  const categoryPrefix = catMultiRow?.code || '';

  let unitCodesNorm = [];
  let unitDetailsNorm = null;
  if (categoryIsMulti && q > 1) {
    const resolvedDetails = await resolveUnitDetails(product, categoryId, q, {
      price: priceNum,
      netPrice: netNum,
      discount: discountNum,
      attributes: attrsNorm,
      imageUrl: imageUrlNorm,
    });
    if (resolvedDetails?.error) {
      return { error: resolvedDetails.error };
    }
    if (resolvedDetails?.unitDetails) {
      unitDetailsNorm = resolvedDetails.unitDetails;
      unitCodesNorm = resolvedDetails.unitCodes;
      attrsNorm = unitDetailsNorm[0]?.attributes || attrsNorm;
      priceNum = unitDetailsNorm[0].price;
      netNum = unitDetailsNorm[0].netPrice;
      discountNum = unitDetailsNorm[0].discount;
    } else {
      const attrsReq = await assertRequiredCategoryAttributes(String(categoryId), attrsNorm);
      if (!attrsReq.ok) {
        return { error: attrsReq.error };
      }
      const raw = Array.isArray(product?.unitCodes) ? product.unitCodes : [];
      unitCodesNorm = raw.map((x) => String(x ?? '').trim()).filter(Boolean);
      if (unitCodesNorm.length !== q) {
        try {
          unitCodesNorm = await allocateSequentialProductCodes(String(categoryId), q);
        } catch (e) {
          return { error: e?.message || 'Cannot allocate codes' };
        }
      }
      const seen = new Set(unitCodesNorm.map((c) => c.toUpperCase()));
      if (seen.size !== unitCodesNorm.length) {
        return { error: 'Duplicate codes in unitCodes' };
      }
      for (const c of unitCodesNorm) {
        const chk = await validateProductCodeForCategory(String(categoryId), c);
        if (!chk.ok) return { error: chk.error };
      }
    }
  } else {
    const attrsReq = await assertRequiredCategoryAttributes(String(categoryId), attrsNorm);
    if (!attrsReq.ok) {
      return { error: attrsReq.error };
    }
    const codeChk = await validateProductCodeForCategory(String(categoryId), code);
    if (!codeChk.ok) {
      return { error: codeChk.error };
    }
  }

  {
    const codesToCheck = categoryIsMulti && q > 1 ? unitCodesNorm : [code];
    const serialFree = await assertSerialBodiesNotUsedInStorage(codesToCheck, {
      categoryPrefix,
      session,
    });
    if (!serialFree.ok) {
      return {
        error: serialFree.error,
        code: serialFree.code,
        status: 409,
      };
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
    ...ecommerceCatalogFieldsFromSource(product),
  };
  if (categoryIsMulti && q > 1) {
    payload.unitCodes = unitCodesNorm;
    if (unitDetailsNorm) {
      payload.unitDetails = unitDetailsNorm;
    }
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
    return { error: e?.message || 'Invalid source party', code: e?.code };
  }

  return {
    q,
    name,
    code: payload.code,
    payload,
    categoryIsMulti,
    unitCodesNorm,
    unitDetailsNorm,
    acquiredFromFields,
    categoryId: String(categoryId),
  };
}

/**
 * Create stock Product row(s) for one purchase line (auto-approve / approve / add-line).
 */
async function createProductsForLine(session, { linePayload, branchId, acquiredFromFields }) {
  const { q, name, code, payload, categoryIsMulti, unitCodesNorm } = linePayload;
  const createdList = [];

  if (categoryIsMulti && q > 1) {
    const free = await assertCodesNotUsedInStorage(unitCodesNorm, branchId, false);
    if (!free.ok) {
      return {
        error: free.error,
        code: 'PRODUCT_CODE_ALREADY_EXISTS',
        status: 409,
      };
    }
    for (let ui = 0; ui < unitCodesNorm.length; ui++) {
      const unitCode = unitCodesNorm[ui];
      const uf = unitFieldsFromPayload(payload, ui, unitCode);
      const unitFullCode = uf.code || unitCode;
      const existingUnit = await Product.findOne({
        code: unitFullCode,
        branch: branchId,
      }).session(session);
      if (existingUnit) {
        if (!canReviveExistingProduct(existingUnit)) {
          return {
            error: 'Product code already exists in this branch',
            code: 'PRODUCT_CODE_ALREADY_EXISTS',
            status: 409,
          };
        }
        const reviveErr = applyPurchaseRevive(existingUnit, {
          name,
          payload: {
            ...payload,
            price: uf.price,
            netPrice: uf.netPrice,
            discount: uf.discount,
            attributes: uf.attributes,
            imageUrl: uf.imageUrl || payload.imageUrl || '',
          },
          quantity: 1,
          acquiredFromFields,
        });
        if (reviveErr) {
          return { error: reviveErr.error, code: reviveErr.code, status: 409 };
        }
        await existingUnit.save({ session });
        createdList.push(existingUnit);
        continue;
      }
      const [prodRow] = await Product.create(
        [
          {
            name,
            code: unitFullCode,
            price: uf.price,
            netPrice: uf.netPrice,
            stock: 1,
            discount: uf.discount,
            category: payload.category,
            branch: branchId,
            inWarehouse: false,
            imageUrl: uf.imageUrl || payload.imageUrl || '',
            attributes: uf.attributes,
            ...(payload.addedBy ? { addedBy: payload.addedBy } : {}),
            listedOnEcommerce:
              payload.listedOnEcommerce === true || payload.listedOnEcommerce === 'true',
            ecommerceDescription: String(payload.ecommerceDescription || ''),
            ecommerceShortDescription: String(payload.ecommerceShortDescription || ''),
            ecommerceIsFeatured: Boolean(payload.ecommerceIsFeatured),
            ...acquiredFromFields,
          },
        ],
        { session }
      );
      createdList.push(prodRow);
    }
    return { createdList, createdProduct: createdList[0] };
  }

  const existing = await Product.findOne({ code, branch: branchId }).session(session);
  if (existing) {
    if (canReviveExistingProduct(existing)) {
      const reviveErr = applyPurchaseRevive(existing, {
        name,
        payload,
        quantity: q,
        acquiredFromFields,
      });
      if (reviveErr) {
        return { error: reviveErr.error, code: reviveErr.code, status: 409 };
      }
      await existing.save({ session });
      return { createdList: [existing], createdProduct: existing };
    }
    return {
      error: 'Product code already exists in this branch',
      code: 'PRODUCT_CODE_ALREADY_EXISTS',
      status: 409,
    };
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
        listedOnEcommerce:
          payload.listedOnEcommerce === true || payload.listedOnEcommerce === 'true',
        ecommerceDescription: String(payload.ecommerceDescription || ''),
        ecommerceShortDescription: String(payload.ecommerceShortDescription || ''),
        ecommerceIsFeatured: Boolean(payload.ecommerceIsFeatured),
        ...acquiredFromFields,
      },
    ],
    { session }
  );
  return { createdList: [prod], createdProduct: prod };
}

/**
 * Approve a pending exchange trade-in and create stock inside an existing Mongo session.
 * Called from createOrder at Pay so inventory is not committed until checkout completes.
 * Legacy already-approved trade-ins are only linked to the order.
 */
export async function finalizeExchangeTradeInPurchaseInSession(
  session,
  purchaseId,
  { userId, orderId } = {}
) {
  if (!purchaseId || !mongoose.Types.ObjectId.isValid(String(purchaseId))) {
    return { error: 'Invalid exchange trade-in purchase id' };
  }
  if (!orderId || !mongoose.Types.ObjectId.isValid(String(orderId))) {
    return { error: 'Order id is required to finalize exchange trade-in' };
  }

  const purchase = await ProductPurchaseRequest.findById(purchaseId).session(session);
  if (!purchase) {
    return { error: 'Exchange trade-in purchase not found' };
  }
  if (!purchase.isExchangeTradeIn) {
    return { error: 'Purchase is not an exchange trade-in' };
  }
  if (
    purchase.linkedExchangeOrderId &&
    String(purchase.linkedExchangeOrderId) !== String(orderId)
  ) {
    return { error: 'Exchange trade-in already linked to another order' };
  }

  const orderOid = new mongoose.Types.ObjectId(String(orderId));
  const actorOid =
    userId && mongoose.Types.ObjectId.isValid(String(userId))
      ? new mongoose.Types.ObjectId(String(userId))
      : null;

  if (purchase.status === 'approved') {
    purchase.linkedExchangeOrderId = orderOid;
    await purchase.save({ session });
    return { purchase, stockMovementRows: [], alreadyApproved: true };
  }

  if (purchase.status !== 'pending') {
    return { error: 'Exchange trade-in cannot be finalized' };
  }

  if (!Array.isArray(purchase.lines) || !purchase.lines.length) {
    purchase.lines = [
      {
        productPayload: purchase.productPayload,
        quantity: Math.max(1, Math.floor(Number(purchase.quantity) || 1)),
      },
    ];
  }

  const stockMovementRows = [];

  for (let i = 0; i < purchase.lines.length; i++) {
    const line = purchase.lines[i];
    if (line?.createdProductId) continue;

    const built = await buildPurchaseLinePayload(
      {
        ...(line.productPayload || {}),
        categoryId: line.productPayload?.category,
        unitCodes: line.productPayload?.unitCodes,
        unitDetails: line.productPayload?.unitDetails,
      },
      line.quantity,
      { session, branchId: purchase.branch }
    );
    if (built.error) {
      return { error: built.error, code: built.code, status: built.status };
    }

    const created = await createProductsForLine(session, {
      linePayload: built,
      branchId: purchase.branch,
      acquiredFromFields: built.acquiredFromFields,
    });
    if (created.error) {
      return { error: created.error, code: created.code, status: created.status };
    }

    line.createdProductId = created.createdProduct._id;
    if (created.createdList.length > 1) {
      line.createdProductIds = created.createdList.map((p) => p._id);
    }

    for (let ui = 0; ui < created.createdList.length; ui++) {
      const prodRow = created.createdList[ui];
      const uf = unitFieldsFromPayload(built.payload, ui, prodRow.code);
      const qty = created.createdList.length > 1 ? 1 : built.q;
      stockMovementRows.push({
        movementType: 'purchase',
        productId: prodRow._id,
        productName: prodRow.name,
        branchId: purchase.branch,
        fromBranchId: null,
        toBranchId: purchase.branch,
        quantity: qty,
        unitPrice: uf.netPrice,
        totalValue: Math.round(uf.netPrice * qty * 100) / 100,
        referenceType: 'productPurchaseRequest',
        referenceId: purchase._id,
        notes: 'Exchange trade-in finalized at checkout',
      });
    }
  }

  purchase.markModified('lines');
  refreshRootCreatedProductIds(purchase);
  purchase.status = 'approved';
  if (actorOid) purchase.resolvedBy = actorOid;
  purchase.resolvedAt = new Date();
  purchase.resolutionNote = 'Finalized at exchange checkout';
  purchase.linkedExchangeOrderId = orderOid;
  await purchase.save({ session });

  return { purchase, stockMovementRows, alreadyApproved: false };
}

/**
 * Append another device/line to an existing exchange trade-in purchase (one invoice).
 * POST /product-purchase-requests/:id/add-line
 */
export const addProductPurchaseLine = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { id } = req.params;
    const { userId, quantity: qtyRaw, product } = req.body || {};

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
    if (!purchase) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ error: 'Purchase not found' });
    }
    if (!purchase.isExchangeTradeIn) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: 'Only exchange trade-in purchases can receive extra lines' });
    }
    if (!['pending', 'approved'].includes(String(purchase.status))) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: 'Cannot add lines to this purchase' });
    }

    const branchId = purchase.branch;
    const built = await buildPurchaseLinePayload(product, qtyRaw, { session, branchId });
    if (built.error) {
      await session.abortTransaction();
      session.endSession();
      return res.status(built.status || 400).json({ error: built.error, code: built.code });
    }

    if (!Array.isArray(purchase.lines) || !purchase.lines.length) {
      purchase.lines = [
        {
          productPayload: purchase.productPayload,
          quantity: Math.max(1, Math.floor(Number(purchase.quantity) || 1)),
          ...(purchase.createdProductId ? { createdProductId: purchase.createdProductId } : {}),
          ...(Array.isArray(purchase.createdProductIds) && purchase.createdProductIds.length
            ? { createdProductIds: purchase.createdProductIds }
            : {}),
        },
      ];
    }

    const newLine = {
      productPayload: built.payload,
      quantity: built.q,
    };

    let createdProduct = null;
    let createdList = [];

    if (purchase.status === 'approved') {
      const created = await createProductsForLine(session, {
        linePayload: built,
        branchId,
        acquiredFromFields: built.acquiredFromFields,
      });
      if (created.error) {
        await session.abortTransaction();
        session.endSession();
        return res
          .status(created.status || 400)
          .json({ error: created.error, ...(created.code ? { code: created.code } : {}) });
      }
      createdList = created.createdList;
      createdProduct = created.createdProduct;
      newLine.createdProductId = createdProduct._id;
      if (createdList.length > 1) {
        newLine.createdProductIds = createdList.map((p) => p._id);
      }
    }

    purchase.lines.push(newLine);
    purchase.markModified('lines');
    refreshRootCreatedProductIds(purchase);
    await purchase.save({ session });

    await session.commitTransaction();
    session.endSession();

    if (createdList.length) {
      for (let ui = 0; ui < createdList.length; ui++) {
        const prodRow = createdList[ui];
        const uf = unitFieldsFromPayload(built.payload, ui, prodRow.code);
        try {
          await StockMovement.create({
            movementType: 'purchase',
            productId: prodRow._id,
            productName: prodRow.name,
            branchId,
            fromBranchId: null,
            toBranchId: branchId,
            quantity: createdList.length > 1 ? 1 : built.q,
            unitPrice: uf.netPrice,
            totalValue:
              Math.round(
                uf.netPrice * (createdList.length > 1 ? 1 : built.q) * 100
              ) / 100,
            referenceType: 'productPurchaseRequest',
            referenceId: purchase._id,
            notes: `Exchange trade-in line added`,
          });
        } catch (e) {
          console.warn('⚠️ exchange add-line stock movement:', e?.message || e);
        }
      }
    }

    await auditLog(req, {
      action: 'update',
      module: 'product_purchase_requests',
      entityType: 'ProductPurchaseRequest',
      entityId: purchase._id,
      message: 'Exchange trade-in line added',
      metadata: {
        lineCount: purchase.lines.length,
        productCode: built.payload.code,
        quantity: built.q,
        ...(createdProduct ? { createdProductId: createdProduct._id } : {}),
      },
    });

    const purchaseOut = await leanPurchaseForResponse(purchase._id);
    return res.status(200).json({
      message: '✅ Line added',
      purchase: purchaseOut || (purchase.toObject ? purchase.toObject() : purchase),
      ...(createdProduct ? { createdProduct } : {}),
      ...(createdList.length > 1 ? { createdProducts: createdList } : {}),
    });
  } catch (e) {
    await session.abortTransaction();
    session.endSession();
    console.error('addProductPurchaseLine:', e);
    return res.status(500).json({ error: 'Failed to add purchase line', details: e?.message });
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
    const catMultiRow = await Category.findById(categoryIdStr)
      .select('multiCodePerPiece code')
      .session(session)
      .lean();
    const categoryIsMulti = !!catMultiRow?.multiCodePerPiece;
    const categoryPrefix = catMultiRow?.code || '';

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
      const rawDetails = Array.isArray(pp.unitDetails) ? pp.unitDetails : null;
      let codes = [];
      let detailsForCreate = null;
      if (rawDetails?.length === q) {
        const resolved = await resolveUnitDetails(
          { unitDetails: rawDetails },
          categoryIdStr,
          q,
          {
            price: Number(pp.price) || 0,
            netPrice: Number(pp.netPrice) || 0,
            discount: Number(pp.discount) || 0,
            attributes: attrsNorm,
            imageUrl: normalizeImageUrl(pp.imageUrl),
          }
        );
        if (resolved?.error) {
          await session.abortTransaction();
          session.endSession();
          return res.status(400).json({ error: resolved.error });
        }
        detailsForCreate = resolved.unitDetails;
        codes = resolved.unitCodes;
      } else {
        const attrsReq = await assertRequiredCategoryAttributes(categoryIdStr, attrsNorm);
        if (!attrsReq.ok) {
          await session.abortTransaction();
          session.endSession();
          return res.status(400).json({ error: attrsReq.error });
        }
        const raw = Array.isArray(pp.unitCodes) ? pp.unitCodes : [];
        codes = raw.map((x) => String(x ?? '').trim()).filter(Boolean);
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
      }
      const free = await assertCodesNotUsedInStorage(codes, purchase.branch, false);
      if (!free.ok) {
        await session.abortTransaction();
        session.endSession();
        return res.status(409).json({
          error: free.error,
          code: 'PRODUCT_CODE_ALREADY_EXISTS',
        });
      }
      const serialFree = await assertSerialBodiesNotUsedInStorage(codes, {
        categoryPrefix,
        session,
      });
      if (!serialFree.ok) {
        await session.abortTransaction();
        session.endSession();
        return res.status(409).json({ error: serialFree.error, code: serialFree.code });
      }
      const payloadForUnits = {
        ...pp,
        attributes: attrsNorm,
        ...(detailsForCreate ? { unitDetails: detailsForCreate } : {}),
      };
      for (let ui = 0; ui < codes.length; ui++) {
        const unitCode = codes[ui];
        const uf = unitFieldsFromPayload(payloadForUnits, ui, unitCode);
        const unitFullCode = uf.code || unitCode;
        const existingUnit = await Product.findOne({
          code: unitFullCode,
          branch: purchase.branch,
        }).session(session);
        if (existingUnit) {
          if (!canReviveExistingProduct(existingUnit)) {
            await session.abortTransaction();
            session.endSession();
            return res.status(409).json({
              error: 'Product code already exists in this branch',
              code: 'PRODUCT_CODE_ALREADY_EXISTS',
            });
          }
          const reviveErr = applyPurchaseRevive(existingUnit, {
            name: pp.name,
            payload: {
              ...payloadForUnits,
              price: uf.price,
              netPrice: uf.netPrice,
              discount: uf.discount,
              attributes: uf.attributes,
              imageUrl: uf.imageUrl || normalizeImageUrl(pp.imageUrl) || '',
              addedBy: pp.addedBy ? normalizeAddedBy(pp.addedBy) : undefined,
            },
            quantity: 1,
            acquiredFromFields,
          });
          if (reviveErr) {
            await session.abortTransaction();
            session.endSession();
            return res.status(409).json({ error: reviveErr.error, code: reviveErr.code });
          }
          await existingUnit.save({ session });
          createdList.push(existingUnit);
          continue;
        }
        const [pRow] = await Product.create(
          [
            {
              name: pp.name,
              code: unitFullCode,
              price: uf.price,
              netPrice: uf.netPrice,
              stock: 1,
              discount: uf.discount,
              category: pp.category,
              branch: purchase.branch,
              inWarehouse: false,
              imageUrl: uf.imageUrl || normalizeImageUrl(pp.imageUrl) || '',
              attributes: uf.attributes,
              ...(pp.addedBy ? { addedBy: normalizeAddedBy(pp.addedBy) } : {}),
              listedOnEcommerce:
                pp.listedOnEcommerce === true || pp.listedOnEcommerce === 'true',
              ecommerceDescription: String(pp.ecommerceDescription || ''),
              ecommerceShortDescription: String(pp.ecommerceShortDescription || ''),
              ecommerceIsFeatured: Boolean(pp.ecommerceIsFeatured),
              ...acquiredFromFields,
            },
          ],
          { session }
        );
        createdList.push(pRow);
      }
      prod = createdList[0];
    } else {
      const attrsReq = await assertRequiredCategoryAttributes(categoryIdStr, attrsNorm);
      if (!attrsReq.ok) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ error: attrsReq.error });
      }
      const codeChk = await validateProductCodeForCategory(categoryIdStr, code);
      if (!codeChk.ok) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ error: codeChk.error });
      }
      const serialFree = await assertSerialBodiesNotUsedInStorage([code], {
        categoryPrefix,
        session,
      });
      if (!serialFree.ok) {
        await session.abortTransaction();
        session.endSession();
        return res.status(409).json({ error: serialFree.error, code: serialFree.code });
      }
      const existing = await Product.findOne({ code, branch: purchase.branch }).session(session);
      if (existing) {
        if (canReviveExistingProduct(existing)) {
          const reviveErr = applyPurchaseRevive(existing, {
            name: pp.name,
            payload: {
              category: pp.category,
              price: pp.price != null ? Number(pp.price) || 0 : undefined,
              netPrice: pp.netPrice != null ? Number(pp.netPrice) || 0 : undefined,
              discount: pp.discount != null ? Number(pp.discount) || 0 : undefined,
              imageUrl: pp.imageUrl != null ? normalizeImageUrl(pp.imageUrl) : undefined,
              attributes: attrsNorm,
              addedBy: pp.addedBy ? normalizeAddedBy(pp.addedBy) : undefined,
            },
            quantity: q,
            acquiredFromFields,
          });
          if (reviveErr) {
            await session.abortTransaction();
            session.endSession();
            return res.status(409).json({ error: reviveErr.error, code: reviveErr.code });
          }
          await existing.save({ session });
          prod = existing;
          createdList = [existing];
        } else {
          await session.abortTransaction();
          session.endSession();
          return res.status(409).json({
          error: 'Product code already exists in this branch',
          code: 'PRODUCT_CODE_ALREADY_EXISTS',
        });
        }
      } else {
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
              listedOnEcommerce:
                pp.listedOnEcommerce === true || pp.listedOnEcommerce === 'true',
              ecommerceDescription: String(pp.ecommerceDescription || ''),
              ecommerceShortDescription: String(pp.ecommerceShortDescription || ''),
              ecommerceIsFeatured: Boolean(pp.ecommerceIsFeatured),
              ...acquiredFromFields,
            },
          ],
          { session }
        );
        prod = pRow;
        createdList = [pRow];
      }
    }

    purchase.status = 'approved';
    purchase.resolvedBy = actor._id;
    purchase.resolvedAt = new Date();
    purchase.resolutionNote = String(resolutionNote || '').trim().slice(0, 500);
    purchase.createdProductId = prod._id;
    if (createdList.length > 1) {
      purchase.createdProductIds = createdList.map((p) => p._id);
    }
    syncFirstLineCreatedProducts(
      purchase,
      prod._id,
      createdList.length > 1 ? createdList.map((p) => p._id) : undefined
    );

    // Approve any extra trade-in lines that were appended before approval.
    if (Array.isArray(purchase.lines) && purchase.lines.length > 1) {
      for (let i = 1; i < purchase.lines.length; i++) {
        const line = purchase.lines[i];
        if (line?.createdProductId) continue;
        const built = await buildPurchaseLinePayload(
          {
            ...(line.productPayload || {}),
            categoryId: line.productPayload?.category,
            unitCodes: line.productPayload?.unitCodes,
          },
          line.quantity,
          { session, branchId: purchase.branch }
        );
        if (built.error) {
          await session.abortTransaction();
          session.endSession();
          return res
            .status(built.status || 400)
            .json({ error: built.error, ...(built.code ? { code: built.code } : {}) });
        }
        const extra = await createProductsForLine(session, {
          linePayload: built,
          branchId: purchase.branch,
          acquiredFromFields: built.acquiredFromFields,
        });
        if (extra.error) {
          await session.abortTransaction();
          session.endSession();
          return res.status(extra.status || 400).json({ error: extra.error });
        }
        line.createdProductId = extra.createdProduct._id;
        if (extra.createdList.length > 1) {
          line.createdProductIds = extra.createdList.map((p) => p._id);
        }
        createdList.push(...extra.createdList);
      }
      purchase.markModified('lines');
      refreshRootCreatedProductIds(purchase);
    }

    await purchase.save({ session });

    await session.commitTransaction();
    session.endSession();

    await postDeskPurchaseTreasuryLedger(purchase, {
      userId: actor._id,
      branchId: purchase.branch,
    });

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
        for (let ui = 0; ui < createdList.length; ui++) {
          const pRow = createdList[ui];
          const uf = unitFieldsFromPayload(pp, ui, pRow.code);
          await StockMovement.create({
            movementType: 'purchase',
            productId: pRow._id,
            productName: pRow.name,
            branchId: purchase.branch,
            fromBranchId: null,
            toBranchId: purchase.branch,
            quantity: 1,
            unitPrice: uf.netPrice,
            totalValue: Math.round(uf.netPrice * 100) / 100,
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
      entityLabel:
        prod?.code && prod?.name ? `${prod.code} — ${prod.name}` : prod?.code || prod?.name,
      message: `Product purchase request approved ${prod?.code || ''}`.trim(),
      metadata: {
        productId: prod._id,
        productCode: prod?.code,
        productName: prod?.name,
        quantity: q,
        branchId: purchase.branch,
        status: 'approved',
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

    const isCreator =
      String(dereferenceDocId(purchase.createdBy)) === String(actor._id);
    const canCancelOwnExchangeDraft =
      !!purchase.isExchangeTradeIn && isCreator && purchase.status === 'pending';

    const isAllowed =
      actor.role === 'Super Admin' ||
      actor.role === 'Co Admin' ||
      (actor.role === 'Branch Manager' &&
        String(dereferenceDocId(actor.branch)) === String(dereferenceDocId(purchase.branch))) ||
      canCancelOwnExchangeDraft;
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
      entityLabel: purchase?.productPayload?.code
        ? String(purchase.productPayload.code)
        : undefined,
      message: purchase.isExchangeTradeIn
        ? 'Exchange trade-in draft cancelled'
        : 'Product purchase request rejected',
      metadata: {
        branchId: purchase.branch,
        productCode: purchase?.productPayload?.code,
        productName: purchase?.productPayload?.name,
        status: 'rejected',
        exchangeTradeIn: !!purchase.isExchangeTradeIn,
      },
    });

    return res.json({ message: '✅ Rejected', purchase });
  } catch (e) {
    await session.abortTransaction();
    session.endSession();
    console.error('rejectProductPurchaseRequest:', e);
    return res.status(500).json({ error: 'Failed to reject purchase', details: e?.message });
  }
};

/** POST pay deferred balance on approved desk purchase (purchase treasury — store pays party). */
export const recordProductPurchaseDeferredPayment = async (req, res) => {
  try {
    const { id } = req.params;
    const { paymentTreasurySplits, amount, userId, branchId, note } = req.body || {};

    if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) {
      return res.status(400).json({ error: 'Valid userId is required' });
    }

    const result = await recordDeskPurchaseDeferredPayment(id, {
      paymentTreasurySplits,
      amount,
      userId,
      branchId,
      note,
    });

    const purchase = await ProductPurchaseRequest.findById(id).lean();

    await auditLog(req, {
      action: 'payment',
      module: 'product_purchase_requests',
      entityType: 'ProductPurchaseRequest',
      entityId: id,
      message: 'Desk purchase deferred payment recorded',
      metadata: { amount: result.applied, amountPaid: result.amountPaid },
    });

    return res.json({
      message: '✅ Payment recorded',
      purchase,
      ...result,
    });
  } catch (error) {
    const msg = error?.message || 'Failed to record payment';
    const status =
      msg.includes('not found') || msg.includes('Nothing remaining') ? 400 : 500;
    console.error('recordProductPurchaseDeferredPayment:', error);
    return res.status(status).json({ error: msg });
  }
};

/** POST partial or full return on approved desk purchase invoice. */
export const returnProductPurchaseRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const body = req.body || {};

    if (!id || !mongoose.Types.ObjectId.isValid(String(id))) {
      return res.status(400).json({ error: 'Invalid purchase id' });
    }
    if (!body.userId || !mongoose.Types.ObjectId.isValid(String(body.userId))) {
      return res.status(400).json({ error: 'Valid userId is required' });
    }

    const actor = await User.findById(body.userId).select('_id name role branch').lean();
    if (!actor) {
      return res.status(400).json({ error: 'User not found' });
    }

    const purchase = await ProductPurchaseRequest.findById(id);
    if (!purchase) {
      return res.status(404).json({ error: 'Purchase not found' });
    }

    const isAllowed =
      actor.role === 'Super Admin' ||
      actor.role === 'Co Admin' ||
      actor.role === 'Cashier' ||
      (actor.role === 'Branch Manager' &&
        String(dereferenceDocId(actor.branch)) === String(dereferenceDocId(purchase.branch)));
    if (!isAllowed) {
      return res.status(403).json({ error: 'You cannot return this purchase' });
    }

    const result = await processPurchaseReturn(purchase, {
      returnAll: body.returnAll === true || body.returnAll === 'true',
      quantity: body.quantity,
      unitRefundPrice: body.unitRefundPrice,
      returnedProductIds: body.returnedProductIds,
      userId: body.userId,
      branchId: body.branchId,
      note: body.note,
      cashRefundVia: body.cashRefundVia,
      cashTreasuryKey: body.cashTreasuryKey,
      cashTreasuryLabel: body.cashTreasuryLabel,
    });

    await auditLog(req, {
      action: 'return',
      module: 'product_purchase_requests',
      entityType: 'ProductPurchaseRequest',
      entityId: purchase._id,
      message: 'Desk purchase return processed',
      metadata: {
        refundTotal: result.returnRecord?.refundTotal,
        quantity: result.returnRecord?.quantity,
        status: result.purchase?.status,
      },
    });

    return res.json({
      message: '✅ Purchase return processed',
      purchase: result.purchase,
      returnRecord: result.returnRecord,
    });
  } catch (error) {
    const msg = error?.message || 'Failed to process purchase return';
    const status =
      Number(error?.status) ||
      (msg.includes('تعذر إتمام الاسترجاع') || msg.includes('PURCHASE_RETURN_STOCK_MISSING')
        ? 400
        : msg.includes('not found')
          ? 404
          : msg.includes('cannot') || msg.includes('already') || msg.includes('Only') || msg.includes('Invalid') || msg.includes('Select')
            ? 400
            : 500);
    console.error('returnProductPurchaseRequest:', error);
    return res.status(status).json({ error: msg, code: error?.code });
  }
};
