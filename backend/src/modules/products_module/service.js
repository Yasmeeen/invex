import mongoose from 'mongoose';
import moment from 'moment-timezone';
import Product from '../../DB/models/product.model.js';
import ProductBooking from '../../DB/models/productBooking.model.js';
import ProductBranchTransfer from '../../DB/models/productBranchTransfer.model.js';
import StockMovement from '../../DB/models/stockMovement.model.js';
import Category from '../../DB/models/category.model.js';
import Branch from '../../DB/models/branch.model.js';
import User from '../../DB/models/user.model.js';
import Notification from '../../DB/models/notification.model.js';
import { emitToUsers } from '../../realtime/socket.js';
import { auditLog } from '../audit_module/audit.service.js';
import {
  resolveProductAcquiredFrom,
  shouldClearAcquiredFrom,
} from '../../utils/product-source-party.js';
import { buildProductHistoryEvents } from '../../utils/product-history.js';
import { trackProductByCode } from '../../utils/product-serial-track.js';
import StoreSettings from '../../DB/models/storeSettings.model.js';
import {
  normalizeSaleQuantity,
  resolveSellByWeight,
  roundWeight,
} from '../../utils/sale-quantity.util.js';
import {
  notifyProductChanged,
  notifyProductDeleted,
} from '../integrations_module/catalogSync.js';

const TRANSFER_ADMIN_ROLES = ['Super Admin', 'Co Admin', 'Admin'];

function parseListedOnEcommerce(body) {
  const v = body?.listedOnEcommerce;
  return v === true || v === 'true' || v === 1 || v === '1';
}

function normalizeEcommerceDescription(raw) {
  if (raw == null) return '';
  return String(raw).trim().slice(0, 50000);
}

function normalizeEcommerceShortDescription(raw) {
  if (raw == null) return '';
  return String(raw)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

function parseEcommerceIsFeatured(body) {
  const v = body?.ecommerceIsFeatured;
  return v === true || v === 'true' || v === 1 || v === '1';
}

function pickActorUserId(req) {
  const body = req?.body || {};
  const query = req?.query || {};
  return body.userId || body.user_id || query.userId || query.user_id || null;
}

async function sumActiveBookedQuantityProducts(productOid) {
  const oid =
    productOid instanceof mongoose.Types.ObjectId
      ? productOid
      : new mongoose.Types.ObjectId(String(productOid));
  const [agg] = await ProductBooking.aggregate([
    { $match: { product: oid, status: 'active' } },
    { $group: { _id: null, total: { $sum: { $ifNull: ['$quantity', 1] } } } },
  ]);
  return agg?.total || 0;
}

/**
 * After a full transfer out: only soft-hide if the category deletes on zero stock.
 * Categories that "keep product after out of stock" stay visible at stock 0 for restocking.
 */
async function applyZeroStockAfterTransfer(sourceProduct) {
  if (Number(sourceProduct.stock) > 0) return;
  sourceProduct.stock = 0;
  const cat = sourceProduct.category
    ? await Category.findById(sourceProduct.category).select('deleteProductWhenOutOfStock').lean()
    : null;
  if (cat?.deleteProductWhenOutOfStock) {
    sourceProduct.removedWhenOutOfStock = true;
  } else {
    sourceProduct.removedWhenOutOfStock = false;
  }
}

async function loadUserForBranchTransfer(userId) {
  if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) return null;
  return User.findById(userId).select('name role branch').lean();
}

function assertMayInitiateBranchTransfer(user, product) {
  if (!user) {
    const err = new Error('UNAUTHORIZED');
    err.code = 'UNAUTHORIZED';
    throw err;
  }
  if (product.inWarehouse) {
    const err = new Error('WAREHOUSE');
    err.code = 'WAREHOUSE';
    throw err;
  }
  if (!product.branch) {
    const err = new Error('NO_BRANCH');
    err.code = 'NO_BRANCH';
    throw err;
  }
  if (TRANSFER_ADMIN_ROLES.includes(String(user.role || '').trim())) {
    return;
  }
  if (user.role === 'Branch Manager' && user.branch && String(user.branch) === String(product.branch)) {
    return;
  }
  const err = new Error('FORBIDDEN');
  err.code = 'FORBIDDEN';
  throw err;
}

function assertMayResolveBranchTransfer(user, transfer) {
  if (!user) {
    const err = new Error('UNAUTHORIZED');
    err.code = 'UNAUTHORIZED';
    throw err;
  }
  if (transfer.status !== 'pending') {
    const err = new Error('NOT_PENDING');
    err.code = 'NOT_PENDING';
    throw err;
  }
  if (TRANSFER_ADMIN_ROLES.includes(String(user.role || '').trim())) {
    return;
  }
  if (user.role === 'Branch Manager' && user.branch && String(user.branch) === String(transfer.toBranch)) {
    return;
  }
  const err = new Error('FORBIDDEN');
  err.code = 'FORBIDDEN';
  throw err;
}

async function collectIncomingTransferNotifyUserIds(toBranchId) {
  const admins = await User.find({ role: { $in: TRANSFER_ADMIN_ROLES } }).select('_id').lean();
  const managers = await User.find({
    role: 'Branch Manager',
    branch: toBranchId,
  })
    .select('_id')
    .lean();
  const seen = new Set();
  const out = [];
  for (const u of [...admins, ...managers]) {
    const s = String(u._id);
    if (!seen.has(s)) {
      seen.add(s);
      out.push(u._id);
    }
  }
  return out;
}

function copyProductAttributesForBranchClone(sourceDoc) {
  const raw = sourceDoc?.attributes;
  if (!raw) return {};
  if (raw instanceof Map) return Object.fromEntries(raw);
  if (typeof raw === 'object' && !Array.isArray(raw)) return { ...raw };
  return {};
}

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const escapeHtml = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Ensures product code uses the category prefix; category must have a non-empty code. */
export async function validateProductCodeForCategory(categoryId, productCode) {
  const cat = await Category.findById(categoryId).lean();
  if (!cat) {
    return { ok: false, error: 'Invalid category' };
  }
  const prefix = (cat.code || '').trim();
  if (!prefix) {
    return {
      ok: false,
      error:
        'Category has no product code prefix; update the category before adding or editing products',
    };
  }
  const c = String(productCode ?? '').trim();
  if (!c) {
    return { ok: false, error: 'Product code is required' };
  }
  if (!c.toUpperCase().startsWith(prefix.toUpperCase())) {
    return {
      ok: false,
      error: `Product code must start with "${prefix}"`,
    };
  }
  return { ok: true };
}

/**
 * Reserve `count` sequential codes PREFIX-NNN for a category (based on existing products in that category).
 * Optional `startFrom` ensures the first suffix is at least that number (e.g. already-assigned draft codes).
 */
export async function allocateSequentialProductCodes(categoryId, count, startFrom = null) {
  const n = Math.min(500, Math.max(1, Math.floor(Number(count)) || 1));
  const cat = await Category.findById(categoryId).lean();
  if (!cat) {
    throw new Error('Invalid category');
  }
  const rawPrefix = (cat.code || '').trim();
  if (!rawPrefix) {
    throw new Error('Category has no code prefix');
  }
  const base = rawPrefix.replace(/-+$/g, '').toUpperCase();
  const prefixRe = escapeRegex(base);
  const products = await Product.find({
    category: categoryId,
    code: new RegExp(`^${prefixRe}(-\\d+)$`, 'i'),
  })
    .select('code')
    .lean();

  let max = 0;
  const re = new RegExp(`^${prefixRe}-(\\d+)$`, 'i');
  for (const p of products) {
    const m = String(p.code).match(re);
    if (m) {
      max = Math.max(max, parseInt(m[1], 10));
    }
  }
  let next = max + 1;
  if (startFrom != null && Number.isFinite(Number(startFrom))) {
    next = Math.max(next, Math.floor(Number(startFrom)));
  }
  const codes = [];
  for (let i = 0; i < n; i++) {
    codes.push(`${base}-${String(next + i).padStart(3, '0')}`);
  }
  return codes;
}

/**
 * True when the unit is still held in inventory (blocks re-registering that serial).
 * Sold / soft-removed / zero-stock rows are free to re-enter (revive or new intake).
 */
export function productIsActivelyInStock(p) {
  if (!p) return false;
  if (p.removedWhenOutOfStock === true) return false;
  return Number(p.stock) > 0;
}

/** Mongo filter: product still physically in storage for a given code location. */
function activelyInStockCodeFilter(baseFilter) {
  return {
    ...baseFilter,
    removedWhenOutOfStock: { $ne: true },
    stock: { $gt: 0 },
  };
}

/** Ensure none of `codes` are still in warehouse (branch null) or in `branchOid`. */
export async function assertCodesNotUsedInStorage(codes, branchOid, isWarehouse) {
  for (const c of codes) {
    const code = String(c ?? '').trim();
    if (!code) {
      return { ok: false, error: 'Empty product code' };
    }
    const filter = isWarehouse ? { code, branch: null } : { code, branch: branchOid };
    const ex = await Product.findOne(activelyInStockCodeFilter(filter)).select('_id').lean();
    if (ex) {
      return { ok: false, error: `Product code already exists: ${code}` };
    }
  }
  return { ok: true };
}

/**
 * Serial body after category prefix (e.g. UA-C1MTT0RXJ1WT → C1MTT0RXJ1WT).
 * Falls back to the last hyphen segment when prefix is unknown.
 */
export function productCodeSerialBody(code, categoryPrefix = '') {
  const c = String(code || '').trim().toUpperCase();
  if (!c) return '';
  const p = String(categoryPrefix || '')
    .trim()
    .toUpperCase()
    .replace(/-+$/g, '');
  if (p && c.startsWith(p)) {
    return c.slice(p.length).replace(/^-+/, '');
  }
  const parts = c.split('-');
  return parts.length > 1 ? parts[parts.length - 1] : c;
}

/** Auto-allocated PREFIX-001 style — same numbers may exist across categories. */
function isSequentialStyleSerialBody(body) {
  return /^\d{1,4}$/.test(String(body || ''));
}

/**
 * Block registering the same physical serial under a different category prefix
 * (UA-C1MTT0RXJ1WT vs PEN-C1MTT0RXJ1WT) while that unit is still in stock.
 * Sold / soft-removed / zero-stock rows do not block re-entry.
 * Exact same full code is left to per-branch uniqueness / revive logic.
 */
export async function assertSerialBodiesNotUsedInStorage(codes, { categoryPrefix = '', session = null, excludeProductIds = [] } = {}) {
  const list = Array.isArray(codes) ? codes : [codes];
  const exclude = new Set((excludeProductIds || []).map((id) => String(id)));
  for (const raw of list) {
    const code = String(raw ?? '').trim();
    if (!code) continue;
    const body = productCodeSerialBody(code, categoryPrefix);
    if (!body || isSequentialStyleSerialBody(body)) continue;

    const re = new RegExp(`(^|-)${escapeRegex(body)}$`, 'i');
    let q = Product.find(
      activelyInStockCodeFilter({ code: re })
    )
      .select('_id code')
      .limit(50);
    if (session) q = q.session(session);
    const hits = await q.lean();
    const conflict = (hits || []).find((p) => {
      if (exclude.has(String(p._id))) return false;
      return String(p.code || '').trim().toUpperCase() !== code.toUpperCase();
    });
    if (conflict) {
      return {
        ok: false,
        code: 'PRODUCT_SERIAL_ALREADY_EXISTS',
        error: `Serial already registered as ${conflict.code}`,
        existingCode: conflict.code,
      };
    }
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
 * Soft-removed products may be revived on re-create, but only under the same category.
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

/**
 * Create a product or revive a sold/soft-removed row with the same {code, branch}.
 * Returns { ok, product } or { ok: false, error, code }.
 */
async function createOrReviveProductRow({
  code,
  branchOid,
  isWarehouse,
  name,
  price,
  netPrice,
  stock = 1,
  discount,
  categoryId,
  imageUrl,
  attributes,
  addedBy,
  listedOnEcommerce,
  ecommerceDescription,
  ecommerceShortDescription,
  ecommerceIsFeatured,
  acquiredFromFields = {},
}) {
  const filter = isWarehouse ? { code, branch: null } : { code, branch: branchOid };
  const existing = await Product.findOne(filter);
  if (existing) {
    if (!canReviveExistingProduct(existing)) {
      return {
        ok: false,
        code: 'PRODUCT_CODE_ALREADY_EXISTS',
        error: isWarehouse
          ? 'Product code already exists in warehouse'
          : 'Product code already exists in this branch',
      };
    }
    const catMatch = assertReviveCategoryMatches(existing, categoryId);
    if (!catMatch.ok) return catMatch;
    const addStock = Math.max(0, Math.floor(Number(stock) || 0));
    existing.stock = Math.max(0, (Number(existing.stock) || 0) + addStock);
    existing.removedWhenOutOfStock = false;
    if (name) existing.name = name;
    if (price != null) existing.price = price;
    if (netPrice != null) existing.netPrice = netPrice;
    if (discount != null) existing.discount = discount;
    if (imageUrl != null) existing.imageUrl = imageUrl;
    if (attributes) existing.attributes = attributes;
    if (addedBy) existing.addedBy = addedBy;
    if (listedOnEcommerce !== undefined) existing.listedOnEcommerce = listedOnEcommerce;
    if (ecommerceDescription !== undefined) existing.ecommerceDescription = ecommerceDescription;
    if (ecommerceShortDescription !== undefined) {
      existing.ecommerceShortDescription = ecommerceShortDescription;
    }
    if (ecommerceIsFeatured !== undefined) existing.ecommerceIsFeatured = ecommerceIsFeatured;
    Object.assign(existing, acquiredFromFields);
    await existing.save();
    return { ok: true, product: existing, revived: true };
  }
  const product = await Product.create({
    name,
    code,
    price,
    netPrice,
    stock: Math.max(0, Math.floor(Number(stock) || 0)),
    discount,
    category: categoryId,
    branch: isWarehouse ? null : branchOid,
    inWarehouse: !!isWarehouse,
    imageUrl,
    attributes,
    addedBy,
    listedOnEcommerce,
    ecommerceDescription,
    ecommerceShortDescription,
    ecommerceIsFeatured,
    ...acquiredFromFields,
  });
  return { ok: true, product, revived: false };
}

/** Category id from body: `{ _id }`, `{ id }`, plain id string, or ObjectId. */
const resolveCategoryId = (category) => {
  if (category == null || category === '') return null;
  if (typeof category === 'string') return category.trim() || null;
  if (typeof category === 'object') {
    const id = category?._id ?? category?.id;
    if (id != null && id !== '') return String(id);
  }
  return null;
};

/** Optional product image: only allow non-empty https URLs (e.g. Cloudinary). */
const normalizeImageUrl = (raw) => {
  if (raw == null || raw === '') return '';
  const s = String(raw).trim();
  if (!s) return '';
  if (!/^https:\/\//i.test(s)) return '';
  return s.slice(0, 2048);
};

/** Optional employee name who registered the product (trimmed, max 200 chars). */
const normalizeAddedBy = (raw) => String(raw ?? '').trim().slice(0, 200);

/** If netPrice omitted/empty, use price - (price * discount% / 100) (clamped to >= 0). */
const resolveNetPrice = (priceNum, discountNum, netPriceRaw) => {
  const d = Number(discountNum);
  const discPct = Number.isFinite(d) && d >= 0 ? d : 0;
  if (netPriceRaw === undefined || netPriceRaw === null || String(netPriceRaw).trim() === '') {
    return Math.max(0, priceNum - (priceNum * discPct) / 100);
  }
  const n = Number(netPriceRaw);
  if (Number.isNaN(n)) return NaN;
  return n;
};

const normalizeAttrKey = (raw) =>
  String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');

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

/** Safe branch ObjectId from query string (rejects literal "undefined", invalid ids). */
const parseBranchIdFilter = (branchId) => {
  const branchIdStr = branchId != null ? String(branchId).trim() : '';
  if (
    !branchIdStr ||
    branchIdStr === 'undefined' ||
    branchIdStr === 'null' ||
    !mongoose.Types.ObjectId.isValid(branchIdStr)
  ) {
    return null;
  }
  return branchIdStr;
};

/** Comma-separated ObjectIds from query (e.g. multi-select filters). */
const parseOidCsvList = (raw) => {
  if (raw == null) return [];
  const str = String(raw).trim();
  if (!str || str === 'undefined' || str === 'null') return [];
  return str
    .split(',')
    .map((x) => String(x).trim())
    .filter((id) => id && mongoose.Types.ObjectId.isValid(id));
};

const toObjectIds = (ids) =>
  (ids || []).map((id) =>
    id instanceof mongoose.Types.ObjectId ? id : new mongoose.Types.ObjectId(String(id))
  );

export const getProductsImportMetadata = async (_req, res) => {
  try {
    const [branches, categories] = await Promise.all([
      Branch.find({}).select('name').sort({ name: 1 }).lean(),
      Category.find({})
        .select('name code attributeDefs')
        .sort({ name: 1 })
        .lean(),
    ]);

    const categoriesOut = (categories || []).map((c) => ({
      _id: c._id,
      name: c.name,
      code: (c.code || '').trim(),
      attributeDefs: Array.isArray(c.attributeDefs) ? c.attributeDefs : [],
    }));

    const branchesOut = (branches || []).map((b) => ({ _id: b._id, name: b.name }));

    return res.json({ branches: branchesOut, categories: categoriesOut });
  } catch (error) {
    console.error('getProductsImportMetadata:', error);
    return res.status(500).json({ error: 'Failed to load import metadata' });
  }
};

const normalizeNameKey = (raw) =>
  String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

const parseLooseBool = (v) => {
  if (v === true) return true;
  if (v === false) return false;
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return false;
  return s === 'true' || s === '1' || s === 'yes' || s === 'y';
};

export const importProductsFromExcelRows = async (req, res) => {
  try {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
    const options = req.body?.options || {};
    const allowPartial = options?.allowPartial !== false;
    const autoComputeNetPrice = options?.autoComputeNetPrice !== false;

    if (!rows) {
      return res.status(400).json({ error: 'rows must be an array' });
    }
    if (rows.length === 0) {
      return res.json({ createdCount: 0, failedCount: 0, errors: [] });
    }
    if (rows.length > 5000) {
      return res.status(400).json({ error: 'Too many rows (max 5000)' });
    }

    // Preload all branches/categories for fast lookup by name.
    const [branches, categories] = await Promise.all([
      Branch.find({}).select('_id name').lean(),
      Category.find({}).select('_id name code attributeDefs').lean(),
    ]);
    const branchByName = new Map();
    for (const b of branches || []) {
      branchByName.set(normalizeNameKey(b?.name), b);
    }
    const categoryByName = new Map();
    for (const c of categories || []) {
      categoryByName.set(normalizeNameKey(c?.name), c);
    }

    const errors = [];
    const valid = [];

    // Cache for auto-generated codes per category.
    const codeCache = new Map(); // categoryId -> { base, re, next }

    const ensureNextCodeForCategory = async (categoryId) => {
      const cached = codeCache.get(categoryId);
      if (cached) return cached;

      const cat = await Category.findById(categoryId).lean();
      if (!cat) return null;
      const rawPrefix = (cat.code || '').trim();
      if (!rawPrefix) return null;

      const base = rawPrefix.replace(/-+$/g, '').toUpperCase();
      const prefixRe = escapeRegex(base);

      const products = await Product.find({
        category: categoryId,
        code: new RegExp(`^${prefixRe}(-\\d+)$`, 'i'),
      })
        .select('code')
        .lean();

      let max = 0;
      const re = new RegExp(`^${prefixRe}-(\\d+)$`, 'i');
      for (const p of products || []) {
        const m = String(p?.code || '').match(re);
        if (m) {
          max = Math.max(max, parseInt(m[1], 10));
        }
      }

      const obj = { base, prefixRe, next: max + 1 };
      codeCache.set(categoryId, obj);
      return obj;
    };

    // First pass: validate + normalize inputs (no DB writes).
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] || {};
      const sheetName = String(r.sheetBranchName || '').trim();
      const rowNumber = Number(r.rowNumber) || i + 2; // +2: header row + 1-index

      const categoryName = String(r.categoryName || '').trim();
      const name = String(r.name || '').trim();
      const priceNum = Number(r.price);
      const stockNum = Number(r.stock);
      const discountNum = r.discount === '' || r.discount == null ? 0 : Number(r.discount);
      const netRaw = r.netPrice;
      const netNum = netRaw === '' || netRaw == null ? NaN : Number(netRaw);
      const inWarehouse = parseLooseBool(r.inWarehouse);
      const imageUrlNorm = normalizeImageUrl(r.imageUrl);

      if (!categoryName) {
        errors.push({ rowNumber, sheetName, field: 'categoryName', message: 'categoryName is required' });
        continue;
      }
      if (!name) {
        errors.push({ rowNumber, sheetName, field: 'name', message: 'name is required' });
        continue;
      }
      if (Number.isNaN(priceNum) || priceNum < 0) {
        errors.push({ rowNumber, sheetName, field: 'price', message: 'price must be a number >= 0' });
        continue;
      }
      if (Number.isNaN(stockNum) || stockNum < 0) {
        errors.push({ rowNumber, sheetName, field: 'stock', message: 'stock must be a number >= 0' });
        continue;
      }
      if (Number.isNaN(discountNum) || discountNum < 0) {
        errors.push({ rowNumber, sheetName, field: 'discount', message: 'discount must be a number >= 0' });
        continue;
      }
      if (discountNum > 100) {
        errors.push({ rowNumber, sheetName, field: 'discount', message: 'discount must be <= 100 (%)' });
        continue;
      }

      const cat = categoryByName.get(normalizeNameKey(categoryName));
      if (!cat?._id) {
        errors.push({ rowNumber, sheetName, field: 'categoryName', message: 'Category not found' });
        continue;
      }

      let branchId = null;
      if (!inWarehouse) {
        const br = branchByName.get(normalizeNameKey(sheetName));
        if (!br?._id) {
          errors.push({ rowNumber, sheetName, field: 'sheetBranchName', message: 'Branch not found (sheet name must match branch name)' });
          continue;
        }
        branchId = String(br._id);
      }

      let code = String(r.code || '').trim();
      if (!code) {
        const cc = await ensureNextCodeForCategory(String(cat._id));
        if (!cc) {
          errors.push({
            rowNumber,
            sheetName,
            field: 'code',
            message: 'Cannot auto-generate code (category has no prefix code)',
          });
          continue;
        }
        code = `${cc.base}-${String(cc.next).padStart(3, '0')}`;
        cc.next += 1;
      }

      const codeCheck = await validateProductCodeForCategory(String(cat._id), code);
      if (!codeCheck.ok) {
        errors.push({ rowNumber, sheetName, field: 'code', code, message: codeCheck.error });
        continue;
      }

      let finalNet = netNum;
      if (Number.isNaN(finalNet)) {
        if (autoComputeNetPrice) {
          finalNet = Math.max(0, priceNum - (priceNum * discountNum) / 100);
        } else {
          errors.push({ rowNumber, sheetName, field: 'netPrice', code, message: 'netPrice is required' });
          continue;
        }
      }
      if (Number.isNaN(finalNet) || finalNet < 0) {
        errors.push({ rowNumber, sheetName, field: 'netPrice', code, message: 'netPrice must be a number >= 0' });
        continue;
      }

      const attrs = await normalizeAttributesForCategory(String(cat._id), r.attributes);
      if (attrs === null) {
        errors.push({ rowNumber, sheetName, field: 'attributes', code, message: 'attributes must be an object' });
        continue;
      }
      const attrsReq = await assertRequiredCategoryAttributes(String(cat._id), attrs);
      if (!attrsReq.ok) {
        errors.push({ rowNumber, sheetName, field: 'attributes', code, message: attrsReq.error });
        continue;
      }

      valid.push({
        rowNumber,
        sheetName,
        categoryId: String(cat._id),
        branchId,
        inWarehouse,
        payload: {
          name,
          code,
          price: priceNum,
          netPrice: finalNet,
          stock: cat?.sellByWeight ? roundWeight(stockNum) : Math.max(0, Math.floor(stockNum)),
          discount: discountNum,
          category: String(cat._id),
          branch: branchId,
          inWarehouse,
          imageUrl: imageUrlNorm,
          attributes: attrs,
        },
      });
    }

    if (!allowPartial && errors.length) {
      return res.json({ createdCount: 0, failedCount: rows.length, errors });
    }

    let createdCount = 0;
    let createFailedCount = 0;
    const invalidCount = rows.length - valid.length;

    for (const v of valid) {
      try {
        const row = await createOrReviveProductRow({
          code: v.payload.code,
          branchOid: v.branchId,
          isWarehouse: v.inWarehouse,
          name: v.payload.name,
          price: v.payload.price,
          netPrice: v.payload.netPrice,
          stock: v.payload.stock,
          discount: v.payload.discount ?? 0,
          categoryId: v.categoryId,
          imageUrl: v.payload.imageUrl,
          attributes: v.payload.attributes,
        });
        if (!row.ok) {
          createFailedCount += 1;
          errors.push({
            rowNumber: v.rowNumber,
            sheetName: v.sheetName,
            field: 'code',
            code: v.payload.code,
            message: row.error || 'Product code already exists',
          });
          continue;
        }

        const createdProduct = row.product;

        createdCount += 1;

        await auditLog(req, {
          action: 'create',
          module: 'products',
          entityType: 'Product',
          entityId: createdProduct?._id,
          message: `Product imported ${createdProduct?.code || ''}`.trim(),
          after: {
            _id: createdProduct?._id,
            code: createdProduct?.code,
            name: createdProduct?.name,
            stock: createdProduct?.stock,
            inWarehouse: createdProduct?.inWarehouse,
          },
        });
      } catch (e) {
        createFailedCount += 1;
        const msg =
          e?.code === 11000
            ? 'Duplicate product code (unique per branch/warehouse)'
            : e?.message || 'Failed to create product';
        errors.push({
          rowNumber: v.rowNumber,
          sheetName: v.sheetName,
          field: 'row',
          code: v?.payload?.code,
          message: msg,
        });
      }
    }

    return res.json({
      createdCount,
      failedCount: invalidCount + createFailedCount,
      errors,
    });
  } catch (error) {
    console.error('importProductsFromExcelRows:', error);
    return res.status(500).json({ error: 'Failed to import products' });
  }
};

// Get all products (with pagination and optional search)
// Get all products (with pagination, optional search, optional branch filter)

import bwipjs from "bwip-js";
import PDFDocument from "pdfkit";


export const generateBarcodePDF = async (req, res) => {
  try {
    const products = await Product.find().sort({ createdAt: 1 });

    const doc = new PDFDocument({ size: "A4", margin: 20 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=barcodes.pdf");
    doc.pipe(res);

    const xStart = 20; // بداية الأعمدة
    const yStart = 20; // بداية الصفوف
    const cardWidth = 150;
    const cardHeight = 80;
    const marginX = 10;
    const marginY = 10;

    let x = xStart;
    let y = yStart;
    let itemsPerRow = Math.floor((doc.page.width - xStart) / (cardWidth + marginX));

    for (let i = 0; i < products.length; i++) {
      const product = products[i];

      // توليد باركود كـ Buffer
      const pngBuffer = await bwipjs.toBuffer({
        bcid: "code128",
        text: product.code,
        scale: 2,
        height: 40,
        includetext: true,
        textxalign: "center",
      });

      // رسم مستطيل ستكر
      doc.rect(x, y, cardWidth, cardHeight).stroke();

      // إضافة الباركود
      doc.image(pngBuffer, x + 10, y + 10, { width: cardWidth - 20, height: 40 });

      // إضافة اسم المنتج
      doc.fontSize(10).text(product.name, x + 5, y + 55, { width: cardWidth - 10, align: "center" });

      // إضافة السعر
      doc.fontSize(10).text(`${product.price} EGP`, x + 5, y + 70, { width: cardWidth - 10, align: "center" });

      // تحريك الكارد للمنتج التالي
      if ((i + 1) % itemsPerRow === 0) {
        x = xStart;
        y += cardHeight + marginY;
        // إذا وصلنا لأسفل الصفحة، اضف صفحة جديدة
        if (y + cardHeight > doc.page.height) {
          doc.addPage();
          y = yStart;
        }
      } else {
        x += cardWidth + marginX;
      }
    }

    doc.end();
  } catch (error) {
    console.error("❌ Error generating barcode PDF:", error);
    res.status(500).json({ error: "Failed to generate barcode PDF" });
  }
};

// Suggested next product code(s): {CATEGORY_CODE}-{NNN} for the selected category (optional `count`)
export const generateBarcode = async (req, res) => {
  try {
    const categoryId = req.query.categoryId != null ? String(req.query.categoryId).trim() : '';
    if (!categoryId || !mongoose.Types.ObjectId.isValid(categoryId)) {
      return res.status(400).json({ error: 'categoryId query parameter is required' });
    }

    const cat = await Category.findById(categoryId).lean();
    if (!cat) {
      return res.status(404).json({ error: 'Category not found' });
    }
    const rawPrefix = (cat.code || '').trim();
    if (!rawPrefix) {
      return res.status(400).json({
        error: 'Category has no code prefix; edit the category to set a code first',
      });
    }

    const countRaw = req.query.count != null ? Number(req.query.count) : 1;
    const count = Math.min(500, Math.max(1, Math.floor(Number.isFinite(countRaw) ? countRaw : 1)));
    const startFromRaw = req.query.startFrom != null ? Number(req.query.startFrom) : null;
    const startFrom =
      startFromRaw != null && Number.isFinite(startFromRaw) ? Math.floor(startFromRaw) : null;

    const codes = await allocateSequentialProductCodes(categoryId, count, startFrom);
    if (count === 1) {
      return res.json({ code: codes[0] });
    }
    return res.json({ codes });
  } catch (error) {
    console.error('❌ Error generating barcode:', error);
    res.status(500).json({ error: 'Failed to generate barcode' });
  }
};

export const generateBarcodeImage = async (req, res) => {
  try {
    const { code } = req.params;
    const { name } = req.query; // اسم المنتج

    if (!code) {
      return res.status(400).json({ error: 'Code is required' });
    }

    const bvRaw = req.query.bv;
    const barcodeParts = [];
    if (bvRaw != null) {
      const rawParts = Array.isArray(bvRaw) ? bvRaw : [bvRaw];
      for (const p of rawParts) {
        const t = String(p ?? '').trim();
        if (t) barcodeParts.push(t);
      }
    }
    /** One horizontal line: values separated by Arabic comma (also if legacy multi-param bv). */
    const barcodeAttrLine = barcodeParts.join('\u060c ');
    const barcodeAttrHtml = barcodeAttrLine
      ? `<div class="barcode-attr-line">${escapeHtml(barcodeAttrLine)}</div>`
      : '';

    const priceRaw = req.query.price;
    let barcodePriceHtml = '';
    if (priceRaw != null && String(priceRaw).trim() !== '') {
      const priceNum = Number(priceRaw);
      if (Number.isFinite(priceNum)) {
        barcodePriceHtml = `<div class="barcode-price">${escapeHtml(String(priceNum))} EGP</div>`;
      }
    }

    bwipjs.toBuffer(
      {
        bcid: 'code128',
        text: code,
        scale: 4,
        height: 10,
        includetext: false,
        paddingwidth: 1,
        paddingheight: 0,
      },
      (err, png) => {
        if (err) {
          return res.status(500).send(err);
        }

        res.send(`
          <!DOCTYPE html>
          <html>
            <head>
              <meta charset="utf-8" />
              <style>
           @page {
          size: 38mm 25mm;
          margin: 0;
        }

      html, body {
        width: 100%;
        height: 100%;
        margin: 0;
        padding: 0;
        display: flex;
        justify-content: center;
        align-items: center;
        box-sizing: border-box;
        color: #000;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }

      .sticker-name {
        width: 100%;
        max-width: 100%;
        min-height: 25mm;
        height: 25mm;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: stretch;
        box-sizing: border-box;
        /* quiet zone صغير يمين/شمال عشان السكانر */
        padding: 0.6mm 1mm;
        color: #000;
        font-family: Arial, Helvetica, sans-serif;
      }

      .product-name {
        font-size: 9px;
        font-weight: 900;
        line-height: 1.05;
        margin: 0 0 0.3mm;
        max-width: 100%;
        text-align: center;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        color: #000;
      }

      .barcode-img {
        width: 100%;
        max-width: 100%;
        height: 10.5mm;
        display: block;
        object-fit: fill;
        image-rendering: crisp-edges;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }

      .barcode-code {
        font-size: 8px;
        font-weight: 800;
        line-height: 1.1;
        margin-top: 0.3mm;
        max-width: 100%;
        text-align: center;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        color: #000;
      }

      .barcode-attr-line {
        font-size: 8px;
        font-weight: 700;
        line-height: 1.1;
        margin: 0 0 0.3mm;
        max-width: 100%;
        text-align: center;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        color: #000;
      }

      .barcode-price {
        font-size: 9px;
        font-weight: 900;
        line-height: 1.05;
        margin: 0 0 0.3mm;
        max-width: 100%;
        text-align: center;
        color: #000;
      }

</style>

            </head>

            <body>
            <div class="sticker-name">
               <div class="product-name">${name || ''}</div>
               ${barcodePriceHtml}
               ${barcodeAttrHtml}
               <img class="barcode-img" src="data:image/png;base64,${png.toString('base64')}" alt="${escapeHtml(code)}" />
               <div class="barcode-code">${escapeHtml(code)}</div>
            </div>
           
            </body>
          </html>
        `);
      }
    );
  } catch (error) {
    console.error('❌ Error in generateBarcodeImage:', error);
    res.status(500).json({ error: 'Failed to generate barcode image' });
  }
};



/** Shared list filters for GET /products and inventory audit. */
function buildProductsListQuery(queryParams = {}) {
  const {
    search = '',
    branchId,
    warehouseOnly,
    excludeWarehouse,
    booked,
    listedOnline,
    listedOnEcommerce,
    categoryId,
    attrKey,
    attrValue,
    includeRemoved,
    inStock,
    supplier_id,
    supplierId,
    vendor_id,
    vendorId,
  } = queryParams;

  const query = {};
  const andParts = [];

  // Soft-hidden after last-unit sale (deleteProductWhenOutOfStock) — exclude unless asked
  if (includeRemoved !== 'true' && includeRemoved !== true) {
    andParts.push({
      $or: [
        { removedWhenOutOfStock: { $ne: true } },
        { removedWhenOutOfStock: { $exists: false } },
      ],
    });
  }

  // Available (stock > 0) vs finished / out of stock (stock 0)
  if (inStock === 'true' || inStock === true) {
    query.stock = { $gt: 0 };
  } else if (inStock === 'false' || inStock === false) {
    query.stock = { $lte: 0 };
  }

  if (booked === 'true' || booked === true) {
    query.bookingStatus = 'active';
  } else if (booked === 'false' || booked === false) {
    andParts.push({
      $or: [
        { bookingStatus: { $ne: 'active' } },
        { bookingStatus: { $exists: false } },
      ],
    });
  }

  const listedFlag = listedOnline ?? listedOnEcommerce;
  if (listedFlag === 'true' || listedFlag === true) {
    query.listedOnEcommerce = true;
  } else if (listedFlag === 'false' || listedFlag === false) {
    andParts.push({
      $or: [
        { listedOnEcommerce: { $ne: true } },
        { listedOnEcommerce: { $exists: false } },
      ],
    });
  }

  if (search) {
    andParts.push({
      $or: [
        { name: { $regex: search, $options: 'i' } },
        { code: { $regex: search, $options: 'i' } },
      ],
    });
  }

  if (warehouseOnly === 'true' || warehouseOnly === true) {
    query.inWarehouse = true;
  } else if (excludeWarehouse === 'true' || excludeWarehouse === true) {
    query.inWarehouse = { $ne: true };
  }

  const categoryIds = toObjectIds(parseOidCsvList(categoryId));
  if (categoryIds.length === 1) {
    query.category = categoryIds[0];
  } else if (categoryIds.length > 1) {
    query.category = { $in: categoryIds };
  }

  const branchIds = toObjectIds(parseOidCsvList(branchId));
  if (branchIds.length === 1) {
    query.branch = branchIds[0];
  } else if (branchIds.length > 1) {
    query.branch = { $in: branchIds };
  }

  const supplierIds = toObjectIds(
    parseOidCsvList(supplier_id ?? supplierId ?? vendor_id ?? vendorId)
  );
  if (supplierIds.length === 1) {
    query['acquiredFrom.vendorId'] = supplierIds[0];
  } else if (supplierIds.length > 1) {
    query['acquiredFrom.vendorId'] = { $in: supplierIds };
  }

  if (attrKey && attrValue) {
    const k = String(attrKey).trim().toLowerCase().replace(/\s+/g, '_');
    const v = String(attrValue).trim();
    if (k && v) {
      andParts.push({
        [`attributes.${k}`]: { $regex: v, $options: 'i' },
      });
    }
  }

  if (andParts.length) {
    query.$and = andParts;
  }

  return query;
}

export const getProducts = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const query = buildProductsListQuery(req.query);

    const [products, total] = await Promise.all([
      Product.find(query)
        .populate('category', 'name code attributeDefs multiCodePerPiece showProductCodeOnInvoice sellByWeight weightUnit')
        .populate('branch', 'name')
        .skip(skip)
        .limit(Number(limit)),
      Product.countDocuments(query),
    ]);

    const totalPages = Math.ceil(total / limit);

    res.json({
      products,
      meta: {
        currentPage: Number(page),
        nextPage: page < totalPages ? Number(page) + 1 : null,
        prevPage: page > 1 ? Number(page) - 1 : null,
        totalCount: total,
        totalPages,
      },
    });
  } catch (error) {
    console.error('❌ Error fetching products:', error.message);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
};


// Get product by ID
export const getProductById = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id)
      .populate('category', 'name code attributeDefs multiCodePerPiece showProductCodeOnInvoice sellByWeight weightUnit')
      .populate('branch', 'name');

    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    res.json(product);
  } catch (error) {
    console.error('❌ Error fetching product by ID:', error.message);
    res.status(500).json({ error: 'Failed to fetch product' });
  }
};

// Create a new product
export const createProduct = async (req, res) => {
  try {
    const { name, code, price, netPrice, category, branch, stock, discount, inWarehouse, imageUrl, attributes, addedBy } =
      req.body;
    const listedOnEcommerce = parseListedOnEcommerce(req.body);
    const ecommerceDescription = normalizeEcommerceDescription(req.body.ecommerceDescription);
    const ecommerceShortDescription = normalizeEcommerceShortDescription(
      req.body.ecommerceShortDescription
    );
    const ecommerceIsFeatured = parseEcommerceIsFeatured(req.body);
    const imageUrlNorm = normalizeImageUrl(imageUrl);
    const addedByNorm = normalizeAddedBy(addedBy);
    const isWarehouse =
      inWarehouse === true || inWarehouse === 'true' || String(inWarehouse).toLowerCase() === 'true';

    const categoryId = resolveCategoryId(category);
    const priceNum = Number(price);
    const stockNum = Number(stock);
    const discountNum =
      discount === undefined || discount === null || discount === '' ? 0 : Number(discount);
    if (Number.isNaN(discountNum) || discountNum < 0) {
      return res.status(400).json({ error: 'Invalid discount' });
    }
    if (discountNum > 100) {
      return res.status(400).json({ error: 'Invalid discount (must be <= 100%)' });
    }
    const netNum = resolveNetPrice(priceNum, discountNum, netPrice);
    if (Number.isNaN(netNum) || netNum < 0) {
      return res.status(400).json({ error: 'Invalid net price' });
    }

    if (
      !name ||
      code == null ||
      String(code).trim() === '' ||
      Number.isNaN(priceNum) ||
      !categoryId ||
      stock === undefined ||
      stock === null ||
      Number.isNaN(stockNum)
    ) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    if (stockNum < 0) {
      return res.status(400).json({ error: 'stock must be a number >= 0' });
    }

    if (!mongoose.Types.ObjectId.isValid(categoryId)) {
      return res.status(400).json({ error: 'Invalid category' });
    }

    const attrs = await normalizeAttributesForCategory(categoryId, attributes);
    if (attrs === null) {
      return res.status(400).json({ error: 'attributes must be an object' });
    }

    let acquiredFromFields = {};
    try {
      const branchOidForSource =
        isWarehouse || !branch?._id
          ? null
          : mongoose.Types.ObjectId.isValid(String(branch._id))
            ? branch._id
            : null;
      const resolved = await resolveProductAcquiredFrom(req.body, {
        categoryId,
        branchOid: branchOidForSource,
      });
      if (resolved?.acquiredFrom) {
        acquiredFromFields = { acquiredFrom: resolved.acquiredFrom };
      }
    } catch (e) {
      const msg = e?.message || 'Invalid source party';
      return res.status(400).json({ error: msg, code: e?.code });
    }

    const catRow = await Category.findById(categoryId).select('multiCodePerPiece sellByWeight code').lean();
    const settingsDoc = await StoreSettings.findOne().sort({ updatedAt: -1 }).lean();
    const weightSalesEnabled = !!settingsDoc?.weightSalesEnabled;
    const categoryMultiCode = !!catRow?.multiCodePerPiece;
    if (catRow?.sellByWeight && categoryMultiCode) {
      return res.status(400).json({
        error: 'Category cannot combine sell-by-weight with multi-code-per-piece',
      });
    }
    const isWeightCategory = resolveSellByWeight({ weightSalesEnabled, category: catRow });
    let normalizedStock = stockNum;
    if (isWeightCategory) {
      if (stockNum < 0) {
        return res.status(400).json({ error: 'Invalid stock' });
      }
      normalizedStock = roundWeight(stockNum);
    } else if (Number.isNaN(stockNum) || stockNum < 1) {
      return res.status(400).json({ error: 'Stock must be at least 1' });
    } else {
      normalizedStock = Math.max(1, Math.floor(stockNum));
    }
    const categoryPrefix = catRow?.code || '';
    const unitCount = categoryMultiCode ? Math.max(1, Math.floor(stockNum)) : 1;

    if (categoryMultiCode && unitCount > 1) {
      let codes = [];
      let unitDetailsNorm = null;
      const rawDetails = Array.isArray(req.body.unitDetails) ? req.body.unitDetails : null;
      if (rawDetails?.length === unitCount) {
        const details = [];
        for (let i = 0; i < rawDetails.length; i++) {
          const row = rawDetails[i] && typeof rawDetails[i] === 'object' ? rawDetails[i] : {};
          const c = String(row.code ?? '').trim();
          if (!c) {
            return res.status(400).json({ error: `unitDetails[${i}] requires a code` });
          }
          const p = Number(row.price);
          const n = Number(row.netPrice);
          if (Number.isNaN(p) || p < 0 || Number.isNaN(n) || n < 0) {
            return res.status(400).json({ error: `Valid price and netPrice required for unit ${i + 1}` });
          }
          const dRaw =
            row.discount === undefined || row.discount === null || row.discount === ''
              ? discountNum
              : Number(row.discount);
          if (Number.isNaN(dRaw) || dRaw < 0 || dRaw > 100) {
            return res.status(400).json({ error: `Invalid discount for unit ${i + 1}` });
          }
          const unitAttrs = await normalizeAttributesForCategory(
            categoryId,
            row.attributes != null ? row.attributes : attrs
          );
          if (unitAttrs === null) {
            return res.status(400).json({ error: `attributes must be an object for unit ${i + 1}` });
          }
          const unitAttrsReq = await assertRequiredCategoryAttributes(categoryId, unitAttrs);
          if (!unitAttrsReq.ok) {
            return res.status(400).json({ error: `${unitAttrsReq.error} (unit ${i + 1})` });
          }
          details.push({
            code: c,
            price: Math.round(p * 100) / 100,
            netPrice: Math.round(n * 100) / 100,
            discount: Math.round(dRaw * 100) / 100,
            attributes: unitAttrs,
            imageUrl: normalizeImageUrl(row.imageUrl) || imageUrlNorm || '',
          });
        }
        const seenD = new Set(details.map((x) => x.code.toUpperCase()));
        if (seenD.size !== details.length) {
          return res.status(400).json({ error: 'Duplicate codes in unitDetails' });
        }
        for (const d of details) {
          const chk = await validateProductCodeForCategory(categoryId, d.code);
          if (!chk.ok) {
            return res.status(400).json({ error: chk.error });
          }
        }
        unitDetailsNorm = details;
        codes = details.map((d) => d.code);
      } else if (Array.isArray(req.body.unitCodes) && req.body.unitCodes.length) {
        const attrsReq = await assertRequiredCategoryAttributes(categoryId, attrs);
        if (!attrsReq.ok) {
          return res.status(400).json({ error: attrsReq.error });
        }
        codes = req.body.unitCodes.map((x) => String(x ?? '').trim()).filter(Boolean);
        if (codes.length !== unitCount) {
          return res.status(400).json({ error: 'unitCodes length must match stock quantity' });
        }
        const seen = new Set(codes.map((c) => c.toUpperCase()));
        if (seen.size !== codes.length) {
          return res.status(400).json({ error: 'Duplicate codes in unitCodes' });
        }
        for (const c of codes) {
          const chk = await validateProductCodeForCategory(categoryId, c);
          if (!chk.ok) {
            return res.status(400).json({ error: chk.error });
          }
        }
      } else {
        const attrsReq = await assertRequiredCategoryAttributes(categoryId, attrs);
        if (!attrsReq.ok) {
          return res.status(400).json({ error: attrsReq.error });
        }
        try {
          codes = await allocateSequentialProductCodes(categoryId, unitCount);
        } catch (e) {
          return res.status(400).json({ error: e?.message || 'Cannot allocate codes' });
        }
      }

      const pickUnit = (index, fallbackCode) => {
        if (unitDetailsNorm?.[index]) {
          const d = unitDetailsNorm[index];
          return {
            code: d.code || fallbackCode,
            price: d.price,
            netPrice: d.netPrice,
            discount: d.discount,
            attributes: d.attributes,
            imageUrl: normalizeImageUrl(d.imageUrl) || imageUrlNorm || '',
          };
        }
        return {
          code: fallbackCode,
          price: priceNum,
          netPrice: netNum,
          discount: discountNum,
          attributes: attrs,
          imageUrl: imageUrlNorm || '',
        };
      };

      if (isWarehouse) {
        const free = await assertCodesNotUsedInStorage(codes, null, true);
        if (!free.ok) {
          return res.status(409).json({
            error: free.error,
            code: 'PRODUCT_CODE_ALREADY_EXISTS',
          });
        }
        const serialFree = await assertSerialBodiesNotUsedInStorage(codes, { categoryPrefix });
        if (!serialFree.ok) {
          return res.status(409).json({ error: serialFree.error, code: serialFree.code });
        }
        const createdProducts = [];
        for (let i = 0; i < codes.length; i++) {
          const uf = pickUnit(i, codes[i]);
          const row = await createOrReviveProductRow({
            code: uf.code,
            isWarehouse: true,
            name,
            price: uf.price,
            netPrice: uf.netPrice,
            stock: 1,
            discount: uf.discount,
            categoryId,
            imageUrl: uf.imageUrl || imageUrlNorm,
            attributes: uf.attributes,
            addedBy: addedByNorm,
            listedOnEcommerce,
            ecommerceDescription,
            ecommerceShortDescription,
            ecommerceIsFeatured,
            ...acquiredFromFields,
          });
          if (!row.ok) {
            return res.status(409).json({ error: row.error, code: row.code });
          }
          createdProducts.push(row.product);
        }
        await auditLog(req, {
          action: 'create',
          module: 'products',
          entityType: 'Product',
          entityId: createdProducts[0]?._id,
          message: `Products created (warehouse) ×${createdProducts.length} (multi-code)`.trim(),
          after: {
            count: createdProducts.length,
            codes: createdProducts.map((x) => x.code),
            inWarehouse: true,
          },
        });
        return res.status(201).json({
          message: '✅ Products created',
          createdProducts,
          createdProduct: createdProducts[0],
        });
      }

      if (!branch?._id) {
        return res.status(400).json({ error: 'Branch is required when not storing in warehouse' });
      }
      if (!mongoose.Types.ObjectId.isValid(String(branch._id))) {
        return res.status(400).json({ error: 'Invalid branch' });
      }
      const branchOid = branch._id;
      const free = await assertCodesNotUsedInStorage(codes, branchOid, false);
      if (!free.ok) {
        return res.status(409).json({
          error: free.error,
          code: 'PRODUCT_CODE_ALREADY_EXISTS',
        });
      }
      const serialFree = await assertSerialBodiesNotUsedInStorage(codes, { categoryPrefix });
      if (!serialFree.ok) {
        return res.status(409).json({ error: serialFree.error, code: serialFree.code });
      }
      const createdProducts = [];
      for (let i = 0; i < codes.length; i++) {
        const uf = pickUnit(i, codes[i]);
        const row = await createOrReviveProductRow({
          code: uf.code,
          branchOid,
          isWarehouse: false,
          name,
          price: uf.price,
          netPrice: uf.netPrice,
          stock: 1,
          discount: uf.discount,
          categoryId,
          imageUrl: uf.imageUrl || imageUrlNorm,
          attributes: uf.attributes,
          addedBy: addedByNorm,
          listedOnEcommerce,
          ecommerceDescription,
          ecommerceShortDescription,
          ecommerceIsFeatured,
          ...acquiredFromFields,
        });
        if (!row.ok) {
          return res.status(409).json({ error: row.error, code: row.code });
        }
        createdProducts.push(row.product);
      }
      await auditLog(req, {
        action: 'create',
        module: 'products',
        entityType: 'Product',
        entityId: createdProducts[0]?._id,
        message: `Products created ×${createdProducts.length} (multi-code)`.trim(),
        after: {
          count: createdProducts.length,
          codes: createdProducts.map((x) => x.code),
          branch: branchOid,
          inWarehouse: false,
        },
      });
      return res.status(201).json({
        message: '✅ Products created',
        createdProducts,
        createdProduct: createdProducts[0],
      });
    }

    const attrsReq = await assertRequiredCategoryAttributes(categoryId, attrs);
    if (!attrsReq.ok) {
      return res.status(400).json({ error: attrsReq.error });
    }

    const codeCheck = await validateProductCodeForCategory(categoryId, code);
    if (!codeCheck.ok) {
      return res.status(400).json({ error: codeCheck.error });
    }

    {
      const serialFree = await assertSerialBodiesNotUsedInStorage([code], { categoryPrefix });
      if (!serialFree.ok) {
        return res.status(409).json({ error: serialFree.error, code: serialFree.code });
      }
    }

    if (isWarehouse) {
      // Unique index is { code, branch }; warehouse uses branch: null (matches null or missing field).
      const row = await createOrReviveProductRow({
        code,
        isWarehouse: true,
        name,
        price: priceNum,
        netPrice: netNum,
        stock: normalizedStock,
        discount: discountNum,
        categoryId,
        imageUrl: imageUrlNorm,
        attributes: attrs,
        addedBy: addedByNorm,
        listedOnEcommerce,
        ecommerceDescription,
        ecommerceShortDescription,
        ecommerceIsFeatured,
        ...acquiredFromFields,
      });
      if (!row.ok) {
        return res.status(409).json({ error: row.error, code: row.code });
      }
      const createdProduct = row.product;

      await auditLog(req, {
        action: 'create',
        module: 'products',
        entityType: 'Product',
        entityId: createdProduct?._id,
        message: `Product created (warehouse) ${createdProduct?.code || ''}`.trim(),
        after: {
          _id: createdProduct?._id,
          code: createdProduct?.code,
          name: createdProduct?.name,
          stock: createdProduct?.stock,
          inWarehouse: true,
        },
      });

      notifyProductChanged(createdProduct?._id);
      return res.status(201).json({ message: '✅ Product created', createdProduct });
    }

    if (!branch?._id) {
      return res.status(400).json({ error: 'Branch is required when not storing in warehouse' });
    }

    if (!mongoose.Types.ObjectId.isValid(String(branch._id))) {
      return res.status(400).json({ error: 'Invalid branch' });
    }

    const row = await createOrReviveProductRow({
      code,
      branchOid: branch._id,
      isWarehouse: false,
      name,
      price: priceNum,
      netPrice: netNum,
      stock: normalizedStock,
      discount: discountNum,
      categoryId,
      imageUrl: imageUrlNorm,
      attributes: attrs,
      addedBy: addedByNorm,
      listedOnEcommerce,
      ecommerceDescription,
      ecommerceShortDescription,
      ecommerceIsFeatured,
      ...acquiredFromFields,
    });
    if (!row.ok) {
      return res.status(409).json({
        error: row.error,
        code: row.code || 'PRODUCT_CODE_ALREADY_EXISTS',
      });
    }
    const createdProduct = row.product;

    await auditLog(req, {
      action: 'create',
      module: 'products',
      entityType: 'Product',
      entityId: createdProduct?._id,
      message: `Product created ${createdProduct?.code || ''}`.trim(),
      after: {
        _id: createdProduct?._id,
        code: createdProduct?.code,
        name: createdProduct?.name,
        stock: createdProduct?.stock,
        branch: createdProduct?.branch,
        inWarehouse: false,
      },
    });

    notifyProductChanged(createdProduct?._id);
    res.status(201).json({ message: '✅ Product created', createdProduct });
  } catch (error) {
    console.error('❌ Error creating product:', error.message);
    if (error.code === 11000) {
      return res.status(409).json({ error: 'Product code already exists for this storage location' });
    }
    if (error.name === 'ValidationError' || error.name === 'CastError') {
      return res.status(400).json({ error: error.message || 'Invalid product data' });
    }
    res.status(500).json({ error: 'Failed to create product' });
  }
};


// Update product
export const updateProduct = async (req, res) => {
  try {
    const { name, code, price, netPrice, category, branch, stock, discount, inWarehouse, attributes, addedBy } = req.body;
    const hasImageUrl = Object.prototype.hasOwnProperty.call(req.body, 'imageUrl');
    const hasAddedBy = Object.prototype.hasOwnProperty.call(req.body, 'addedBy');
    const hasListedOnEcommerce = Object.prototype.hasOwnProperty.call(req.body, 'listedOnEcommerce');
    const hasEcommerceDescription = Object.prototype.hasOwnProperty.call(req.body, 'ecommerceDescription');
    const hasEcommerceShortDescription = Object.prototype.hasOwnProperty.call(
      req.body,
      'ecommerceShortDescription'
    );
    const hasEcommerceIsFeatured = Object.prototype.hasOwnProperty.call(req.body, 'ecommerceIsFeatured');
    const ecommerceDescriptionNorm = hasEcommerceDescription
      ? normalizeEcommerceDescription(req.body.ecommerceDescription)
      : undefined;
    const ecommerceShortDescriptionNorm = hasEcommerceShortDescription
      ? normalizeEcommerceShortDescription(req.body.ecommerceShortDescription)
      : undefined;
    const imageUrlNorm = hasImageUrl ? normalizeImageUrl(req.body.imageUrl) : undefined;
    const isWarehouse =
      inWarehouse === true || inWarehouse === 'true' || String(inWarehouse).toLowerCase() === 'true';

    const categoryId = resolveCategoryId(category);
    const priceNum = Number(price);
    const stockNum = Number(stock);
    const discountNum =
      discount === undefined || discount === null || discount === '' ? 0 : Number(discount);
    if (Number.isNaN(discountNum) || discountNum < 0) {
      return res.status(400).json({ error: 'Invalid discount' });
    }
    if (discountNum > 100) {
      return res.status(400).json({ error: 'Invalid discount (must be <= 100%)' });
    }
    const netNum = resolveNetPrice(priceNum, discountNum, netPrice);
    if (Number.isNaN(netNum) || netNum < 0) {
      return res.status(400).json({ error: 'Invalid net price' });
    }

    if (
      !name ||
      code == null ||
      String(code).trim() === '' ||
      Number.isNaN(priceNum) ||
      !categoryId ||
      stock === undefined ||
      stock === null ||
      Number.isNaN(stockNum)
    ) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    if (!mongoose.Types.ObjectId.isValid(categoryId)) {
      return res.status(400).json({ error: 'Invalid category' });
    }

    const attrs = await normalizeAttributesForCategory(categoryId, attributes);
    if (attrs === null) {
      return res.status(400).json({ error: 'attributes must be an object' });
    }
    const attrsReq = await assertRequiredCategoryAttributes(categoryId, attrs);
    if (!attrsReq.ok) {
      return res.status(400).json({ error: attrsReq.error });
    }

    const catRowUpdate = await Category.findById(categoryId).select('sellByWeight multiCodePerPiece').lean();
    const settingsDocUpdate = await StoreSettings.findOne().sort({ updatedAt: -1 }).lean();
    const isWeightCategoryUpdate = resolveSellByWeight({
      weightSalesEnabled: !!settingsDocUpdate?.weightSalesEnabled,
      category: catRowUpdate,
    });
    let normalizedStock = stockNum;
    if (isWeightCategoryUpdate) {
      if (stockNum < 0) {
        return res.status(400).json({ error: 'Invalid stock' });
      }
      normalizedStock = roundWeight(stockNum);
    } else if (stockNum < 0) {
      return res.status(400).json({ error: 'Invalid stock' });
    } else {
      normalizedStock = Math.max(0, Math.floor(stockNum));
    }

    const codeCheck = await validateProductCodeForCategory(categoryId, code);
    if (!codeCheck.ok) {
      return res.status(400).json({ error: codeCheck.error });
    }

    {
      const catForPrefix = await Category.findById(categoryId).select('code').lean();
      const serialFree = await assertSerialBodiesNotUsedInStorage([code], {
        categoryPrefix: catForPrefix?.code || '',
        excludeProductIds: [req.params.id],
      });
      if (!serialFree.ok) {
        return res.status(409).json({ error: serialFree.error, code: serialFree.code });
      }
    }

    let acquiredFromSet = null;
    let acquiredFromUnset = false;
    if (shouldClearAcquiredFrom(req.body)) {
      acquiredFromUnset = true;
    } else if (Object.prototype.hasOwnProperty.call(req.body, 'acquiredFrom')) {
      try {
        const branchOidForSource =
          isWarehouse || !branch?._id
            ? null
            : mongoose.Types.ObjectId.isValid(String(branch._id))
              ? branch._id
              : null;
        const resolved = await resolveProductAcquiredFrom(req.body, {
          categoryId,
          branchOid: branchOidForSource,
        });
        if (resolved?.acquiredFrom) {
          acquiredFromSet = resolved.acquiredFrom;
        } else {
          acquiredFromUnset = true;
        }
      } catch (e) {
        const msg = e?.message || 'Invalid source party';
        return res.status(400).json({ error: msg, code: e?.code });
      }
    }

    if (isWarehouse) {
      const existingWh = await Product.findOne({
        code,
        branch: null,
        _id: { $ne: req.params.id },
      });
      if (existingWh) {
        return res.status(409).json({ error: 'Product code already exists in warehouse' });
      }

      const before = await Product.findById(req.params.id).lean();
      if (!before) {
        return res.status(404).json({ error: 'Product not found' });
      }
      if (!before.inWarehouse) {
        const activeBooking = await ProductBooking.findOne({
          product: req.params.id,
          status: 'active',
        })
          .select('_id')
          .lean();
        if (activeBooking) {
          return res.status(400).json({
            error: 'Cannot move product to warehouse while it has active bookings',
            code: 'ACTIVE_BOOKING_BLOCKS_WAREHOUSE',
          });
        }
      }

      const updateDoc = {
        name,
        code,
        price: priceNum,
        netPrice: netNum,
        category: categoryId,
        branch: null,
        inWarehouse: true,
        stock: normalizedStock,
        discount: discountNum,
        attributes: attrs,
      };
      if (imageUrlNorm !== undefined) {
        updateDoc.imageUrl = imageUrlNorm;
      }
      if (acquiredFromSet) {
        updateDoc.acquiredFrom = acquiredFromSet;
      }
      if (hasAddedBy) {
        updateDoc.addedBy = normalizeAddedBy(addedBy);
      }
      if (hasListedOnEcommerce) {
        updateDoc.listedOnEcommerce = parseListedOnEcommerce(req.body);
      }
      if (ecommerceDescriptionNorm !== undefined) {
        updateDoc.ecommerceDescription = ecommerceDescriptionNorm;
      }
      if (ecommerceShortDescriptionNorm !== undefined) {
        updateDoc.ecommerceShortDescription = ecommerceShortDescriptionNorm;
      }
      if (hasEcommerceIsFeatured) {
        updateDoc.ecommerceIsFeatured = parseEcommerceIsFeatured(req.body);
      }

      const updateOp = acquiredFromUnset
        ? { $set: updateDoc, $unset: { acquiredFrom: 1 } }
        : updateDoc;
      const product = await Product.findByIdAndUpdate(req.params.id, updateOp, { new: true });

      if (!product) {
        return res.status(404).json({ error: 'Product not found' });
      }

      await auditLog(req, {
        action: 'update',
        module: 'products',
        entityType: 'Product',
        entityId: product?._id,
        message: `Product updated (warehouse) ${product?.code || ''}`.trim(),
        before: before
          ? { code: before.code, name: before.name, stock: before.stock, price: before.price, netPrice: before.netPrice }
          : undefined,
        after: { code: product?.code, name: product?.name, stock: product?.stock, price: product?.price, netPrice: product?.netPrice },
      });

      notifyProductChanged(product?._id);
      return res.json({ message: '✅ Product updated', product });
    }

    if (!branch?._id) {
      return res.status(400).json({ error: 'Branch is required when not storing in warehouse' });
    }

    if (!mongoose.Types.ObjectId.isValid(String(branch._id))) {
      return res.status(400).json({ error: 'Invalid branch' });
    }

    const existingProduct = await Product.findOne({
      code,
      branch: branch._id,
      _id: { $ne: req.params.id },
    });

    if (existingProduct) {
      return res.status(409).json({ error: 'Product code already exists in this branch' });
    }

    const updateDocBranch = {
      name,
      code,
      price: priceNum,
      netPrice: netNum,
      category: categoryId,
      branch: branch._id,
      inWarehouse: false,
      stock: normalizedStock,
      discount: discountNum,
      attributes: attrs,
    };
    if (imageUrlNorm !== undefined) {
      updateDocBranch.imageUrl = imageUrlNorm;
    }
    if (acquiredFromSet) {
      updateDocBranch.acquiredFrom = acquiredFromSet;
    }
    if (hasAddedBy) {
      updateDocBranch.addedBy = normalizeAddedBy(addedBy);
    }
      if (hasListedOnEcommerce) {
        updateDocBranch.listedOnEcommerce = parseListedOnEcommerce(req.body);
      }
      if (ecommerceDescriptionNorm !== undefined) {
        updateDocBranch.ecommerceDescription = ecommerceDescriptionNorm;
      }
      if (ecommerceShortDescriptionNorm !== undefined) {
        updateDocBranch.ecommerceShortDescription = ecommerceShortDescriptionNorm;
      }
      if (hasEcommerceIsFeatured) {
        updateDocBranch.ecommerceIsFeatured = parseEcommerceIsFeatured(req.body);
      }

    const updateOpBranch = acquiredFromUnset
      ? { $set: updateDocBranch, $unset: { acquiredFrom: 1 } }
      : updateDocBranch;
    const before = await Product.findById(req.params.id).lean();
    const product = await Product.findByIdAndUpdate(req.params.id, updateOpBranch, { new: true });

    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    await auditLog(req, {
      action: 'update',
      module: 'products',
      entityType: 'Product',
      entityId: product?._id,
      message: `Product updated ${product?.code || ''}`.trim(),
      before: before
        ? { code: before.code, name: before.name, stock: before.stock, price: before.price, netPrice: before.netPrice }
        : undefined,
      after: { code: product?.code, name: product?.name, stock: product?.stock, price: product?.price, netPrice: product?.netPrice },
    });

    notifyProductChanged(product?._id);
    res.json({ message: '✅ Product updated', product });
  } catch (error) {
    console.error('❌ Error updating product:', error.message);
    if (error.code === 11000) {
      return res.status(409).json({ error: 'Product code already exists for this storage location' });
    }
    if (error.name === 'ValidationError' || error.name === 'CastError') {
      return res.status(400).json({ error: error.message || 'Invalid product data' });
    }
    res.status(500).json({ error: 'Failed to update product' });
  }
};

/** Fast selling-price update for the price list screen (does not change netPrice/discount). */
export const updateProductPrice = async (req, res) => {
  try {
    const priceNum = Number(req.body?.price);
    if (!Number.isFinite(priceNum) || priceNum < 0) {
      return res.status(400).json({ error: 'Invalid price' });
    }
    const rounded = Math.round(priceNum * 100) / 100;
    const before = await Product.findById(req.params.id).lean();
    if (!before) {
      return res.status(404).json({ error: 'Product not found' });
    }
    const product = await Product.findByIdAndUpdate(
      req.params.id,
      { $set: { price: rounded } },
      { new: true, runValidators: true }
    )
      .populate('category', 'name code')
      .populate('branch', 'name');

    await auditLog(req, {
      action: 'update',
      module: 'products',
      entityType: 'Product',
      entityId: product?._id,
      message: `Product price updated ${product?.code || ''}`.trim(),
      before: { code: before.code, name: before.name, price: before.price },
      after: { code: product?.code, name: product?.name, price: product?.price },
    });

    notifyProductChanged(product?._id);
    res.json({ message: '✅ Product updated', product });
  } catch (error) {
    console.error('❌ Error updating product price:', error.message);
    if (error.name === 'ValidationError' || error.name === 'CastError') {
      return res.status(400).json({ error: error.message || 'Invalid product data' });
    }
    res.status(500).json({ error: 'Failed to update product' });
  }
};


// Delete product
export const deleteProduct = async (req, res) => {
  try {
    const existing = await Product.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Product not found' });
    }
    if (Number(existing.transferReservedQuantity || 0) > 0) {
      return res.status(400).json({
        error: 'Cannot delete product while a branch transfer is pending',
      });
    }

    // Keep transfer list readable after hard-delete (esp. rejected/approved history).
    try {
      const snapName = String(existing.name || '').trim();
      const snapCode = String(existing.code || '').trim();
      if (snapName || snapCode) {
        await ProductBranchTransfer.updateMany(
          {
            product: existing._id,
            $or: [
              { productNameSnapshot: { $in: [null, ''] } },
              { productCodeSnapshot: { $in: [null, ''] } },
            ],
          },
          {
            $set: {
              ...(snapName ? { productNameSnapshot: snapName } : {}),
              ...(snapCode ? { productCodeSnapshot: snapCode } : {}),
            },
          }
        );
      }
    } catch (snapErr) {
      console.warn('⚠️ transfer snapshot backfill on delete:', snapErr?.message || snapErr);
    }

    const product = await Product.findByIdAndDelete(req.params.id);

    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    await auditLog(req, {
      action: 'delete',
      module: 'products',
      entityType: 'Product',
      entityId: product?._id,
      message: `Product deleted ${product?.code || ''}`.trim(),
      before: { code: product?.code, name: product?.name, stock: product?.stock, branch: product?.branch, inWarehouse: product?.inWarehouse },
    });

    notifyProductDeleted(product?._id);
    res.json({ message: '✅ Product deleted' });
  } catch (error) {
    console.error('❌ Error deleting product:', error.message);
    res.status(500).json({ error: 'Failed to delete product' });
  }
};

/** Branch → branch transfer pending approval at destination. Body: userId, productId, toBranchId, quantity */
export const requestBranchTransfer = async (req, res) => {
  try {
    const userId = pickActorUserId(req);
    const { productId, toBranchId, quantity } = req.body;
    const qty = Math.floor(Number(quantity));
    if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) {
      return res.status(400).json({ error: 'userId is required' });
    }
    if (!productId || !mongoose.Types.ObjectId.isValid(String(productId))) {
      return res.status(400).json({ error: 'Invalid productId' });
    }
    if (!toBranchId || !mongoose.Types.ObjectId.isValid(String(toBranchId))) {
      return res.status(400).json({ error: 'Invalid toBranchId' });
    }
    if (!qty || qty < 1) {
      return res.status(400).json({ error: 'quantity must be >= 1' });
    }

    const user = await loadUserForBranchTransfer(userId);
    if (!user) {
      return res.status(400).json({ error: 'User not found' });
    }

    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    try {
      assertMayInitiateBranchTransfer(user, product);
    } catch (e) {
      if (e.code === 'WAREHOUSE') {
        return res.status(400).json({ error: 'Warehouse products cannot use pending branch transfer' });
      }
      if (e.code === 'NO_BRANCH') {
        return res.status(400).json({ error: 'Product has no branch' });
      }
      return res.status(403).json({ error: 'You cannot request this transfer' });
    }

    const fromBranchId = product.branch;
    if (String(fromBranchId) === String(toBranchId)) {
      return res.status(400).json({ error: 'Source and destination branch must differ' });
    }

    const booked = await sumActiveBookedQuantityProducts(product._id);
    const reserved = Number(product.transferReservedQuantity) || 0;
    const stock = Math.max(0, Number(product.stock) || 0);
    const available = Math.max(0, stock - booked - reserved);
    if (qty > available) {
      return res.status(400).json({
        error: `Only ${available} unit(s) available to transfer (stock minus bookings and pending transfers)`,
      });
    }

    product.transferReservedQuantity = reserved + qty;
    await product.save();

    const transfer = await ProductBranchTransfer.create({
      product: product._id,
      productNameSnapshot: String(product.name || '').trim(),
      productCodeSnapshot: String(product.code || '').trim(),
      fromBranch: fromBranchId,
      toBranch: toBranchId,
      quantity: qty,
      status: 'pending',
      initiatedBy: userId,
    });

    const populated = await ProductBranchTransfer.findById(transfer._id)
      .populate('product', 'name code')
      .populate('fromBranch', 'name')
      .populate('toBranch', 'name')
      .populate('initiatedBy', 'name')
      .lean();

    try {
      const recipientIds = await collectIncomingTransferNotifyUserIds(toBranchId);
      const fromName = populated?.fromBranch?.name || 'Branch';
      const toName = populated?.toBranch?.name || 'Branch';
      const pname = populated?.product?.name || 'Product';
      const notification = await Notification.create({
        type: 'branch_transfer_pending',
        title: 'Product transfer pending receipt',
        body: `${pname} ×${qty}: ${fromName} → ${toName} (awaiting approval)`,
        data: {
          transferId: transfer._id,
          productId: product._id,
          productName: pname,
          quantity: qty,
          fromBranchId,
          toBranchId,
          initiatedById: userId,
        },
        recipients: recipientIds,
        readBy: [],
      });
      emitToUsers(recipientIds, 'notification:new', { notification });
    } catch (notifyErr) {
      console.warn('⚠️ branch transfer notification:', notifyErr?.message || notifyErr);
    }

    await auditLog(req, {
      action: 'branch_transfer_request',
      module: 'products',
      entityType: 'ProductBranchTransfer',
      entityId: transfer._id,
      message: `Branch transfer requested (${qty})`,
      metadata: { productId: product._id, fromBranchId, toBranchId, quantity: qty },
    });

    return res.status(201).json({
      message: 'Transfer requested; waiting for destination branch approval',
      transfer: populated,
    });
  } catch (e) {
    console.error('requestBranchTransfer:', e);
    return res.status(500).json({ error: 'Failed to request branch transfer' });
  }
};

/** Body: userId */
export const approveBranchTransfer = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const userId = pickActorUserId(req);
    const { id } = req.params;
    if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: 'userId is required' });
    }
    if (!mongoose.Types.ObjectId.isValid(String(id))) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: 'Invalid transfer id' });
    }

    const user = await loadUserForBranchTransfer(userId);
    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: 'User not found' });
    }

    const transfer = await ProductBranchTransfer.findById(id).session(session);
    if (!transfer || transfer.status !== 'pending') {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ error: 'Pending transfer not found' });
    }

    try {
      assertMayResolveBranchTransfer(user, transfer);
    } catch (e) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({ error: 'You cannot approve this transfer' });
    }

    const sourceProduct = await Product.findById(transfer.product).session(session);
    if (!sourceProduct) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ error: 'Product not found' });
    }

    if (String(sourceProduct.branch) !== String(transfer.fromBranch)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: 'Product branch no longer matches transfer source' });
    }

    const qty = Number(transfer.quantity);
    const reserved = Number(sourceProduct.transferReservedQuantity) || 0;
    if (reserved < qty) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: 'Transfer reservation mismatch; cancel and recreate transfer' });
    }

    const booked = await sumActiveBookedQuantityProducts(sourceProduct._id);
    const stock = Math.max(0, Number(sourceProduct.stock) || 0);
    if (stock - booked < qty) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        error: 'Not enough free stock to complete transfer (bookings may have increased)',
      });
    }

    sourceProduct.transferReservedQuantity = Math.max(0, reserved - qty);
    sourceProduct.stock = stock - qty;
    await applyZeroStockAfterTransfer(sourceProduct);
    await sourceProduct.save({ session });

    const toBranchId = transfer.toBranch;
    let destinationProduct = await Product.findOne({
      code: sourceProduct.code,
      branch: toBranchId,
      inWarehouse: { $ne: true },
    }).session(session);

    const attrs = copyProductAttributesForBranchClone(sourceProduct);
    const imageUrlNorm = normalizeImageUrl(sourceProduct.imageUrl);

    if (destinationProduct) {
      destinationProduct.stock = Number(destinationProduct.stock) + qty;
      destinationProduct.removedWhenOutOfStock = false;
      if (!destinationProduct.acquiredFrom && sourceProduct.acquiredFrom) {
        destinationProduct.acquiredFrom = sourceProduct.acquiredFrom;
      }
      await destinationProduct.save({ session });
    } else {
      const created = await Product.create(
        [
          {
            name: sourceProduct.name,
            code: sourceProduct.code,
            price: sourceProduct.price,
            netPrice: sourceProduct.netPrice,
            stock: qty,
            discount: sourceProduct.discount || 0,
            category: sourceProduct.category,
            branch: toBranchId,
            inWarehouse: false,
            imageUrl: imageUrlNorm,
            attributes: attrs,
            addedBy: normalizeAddedBy(sourceProduct.addedBy),
            listedOnEcommerce: Boolean(sourceProduct.listedOnEcommerce),
            ecommerceDescription: String(sourceProduct.ecommerceDescription || ''),
            ecommerceShortDescription: String(sourceProduct.ecommerceShortDescription || ''),
            ecommerceIsFeatured: Boolean(sourceProduct.ecommerceIsFeatured),
            ...(sourceProduct.acquiredFrom
              ? { acquiredFrom: sourceProduct.acquiredFrom }
              : {}),
          },
        ],
        { session }
      );
      destinationProduct = Array.isArray(created) ? created[0] : created;
    }

    transfer.status = 'approved';
    transfer.destinationProduct = destinationProduct._id;
    if (!String(transfer.productNameSnapshot || '').trim()) {
      transfer.productNameSnapshot = String(sourceProduct.name || '').trim();
    }
    if (!String(transfer.productCodeSnapshot || '').trim()) {
      transfer.productCodeSnapshot = String(sourceProduct.code || '').trim();
    }
    transfer.resolvedBy = userId;
    transfer.resolvedAt = new Date();
    await transfer.save({ session });

    await session.commitTransaction();
    session.endSession();

    try {
      await StockMovement.create({
        movementType: 'transfer',
        productId: sourceProduct._id,
        productName: sourceProduct.name,
        branchId: toBranchId,
        fromBranchId: transfer.fromBranch,
        toBranchId,
        quantity: qty,
        unitPrice: Number(sourceProduct.price || 0),
        totalValue: Number(sourceProduct.price || 0) * qty,
        referenceType: 'branch_transfer',
        referenceId: transfer._id,
        notes: 'Branch transfer approved',
      });
    } catch (movementError) {
      console.error('⚠️ Failed to log branch transfer movement:', movementError.message);
    }

    try {
      const initiatorId = transfer.initiatedBy;
      const confirmerName = user.name || 'Manager';
      const notification = await Notification.create({
        type: 'branch_transfer_approved',
        title: 'Branch transfer approved',
        body: `${sourceProduct.name} ×${qty} received — ${confirmerName}`,
        data: {
          transferId: transfer._id,
          productId: sourceProduct._id,
          quantity: qty,
          approvedById: userId,
        },
        recipients: [initiatorId],
        readBy: [],
      });
      emitToUsers([initiatorId], 'notification:new', { notification });
    } catch (notifyErr) {
      console.warn('⚠️ branch transfer approve notification:', notifyErr?.message || notifyErr);
    }

    await auditLog(req, {
      action: 'branch_transfer_approve',
      module: 'products',
      entityType: 'ProductBranchTransfer',
      entityId: transfer._id,
      message: `Branch transfer approved (${qty})`,
      metadata: {
        productId: sourceProduct._id,
        destinationProductId: destinationProduct._id,
        fromBranchId: transfer.fromBranch,
        toBranchId,
      },
    });

    return res.json({ message: 'Transfer approved and stock moved', transferId: transfer._id });
  } catch (e) {
    await session.abortTransaction();
    session.endSession();
    console.error('approveBranchTransfer:', e);
    return res.status(500).json({ error: 'Failed to approve transfer' });
  }
};

/** Body: userId, rejectReason (required) */
export const rejectBranchTransfer = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const userId = pickActorUserId(req);
    const { id } = req.params;
    const rejectReason = String(req.body?.rejectReason || '').trim().slice(0, 500);

    if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: 'userId is required' });
    }
    if (!rejectReason) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: 'rejectReason is required' });
    }
    if (!mongoose.Types.ObjectId.isValid(String(id))) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: 'Invalid transfer id' });
    }

    const user = await loadUserForBranchTransfer(userId);
    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: 'User not found' });
    }

    const transfer = await ProductBranchTransfer.findById(id).session(session);
    if (!transfer || transfer.status !== 'pending') {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ error: 'Pending transfer not found' });
    }

    try {
      assertMayResolveBranchTransfer(user, transfer);
    } catch (e) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({ error: 'You cannot reject this transfer' });
    }

    const sourceProduct = await Product.findById(transfer.product).session(session);
    if (!sourceProduct) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ error: 'Product not found' });
    }

    const qty = Number(transfer.quantity);
    const reserved = Number(sourceProduct.transferReservedQuantity) || 0;
    sourceProduct.transferReservedQuantity = Math.max(0, reserved - qty);
    await sourceProduct.save({ session });

    if (!String(transfer.productNameSnapshot || '').trim()) {
      transfer.productNameSnapshot = String(sourceProduct.name || '').trim();
    }
    if (!String(transfer.productCodeSnapshot || '').trim()) {
      transfer.productCodeSnapshot = String(sourceProduct.code || '').trim();
    }
    transfer.status = 'rejected';
    transfer.resolvedBy = userId;
    transfer.resolvedAt = new Date();
    transfer.rejectReason = rejectReason;
    await transfer.save({ session });

    await session.commitTransaction();
    session.endSession();

    try {
      const initiatorId = transfer.initiatedBy;
      const pname = String(sourceProduct.name || '').trim() || 'Product';
      const notification = await Notification.create({
        type: 'branch_transfer_rejected',
        title: 'Branch transfer rejected',
        body: rejectReason
          ? `${pname} ×${qty}: ${rejectReason}`
          : `${pname} ×${qty} transfer was rejected`,
        data: {
          transferId: transfer._id,
          productId: sourceProduct._id,
          productName: pname,
          productCode: String(sourceProduct.code || '').trim(),
          quantity: qty,
          rejectedById: userId,
          rejectReason,
        },
        recipients: [initiatorId],
        readBy: [],
      });
      emitToUsers([initiatorId], 'notification:new', { notification });
    } catch (notifyErr) {
      console.warn('⚠️ branch transfer reject notification:', notifyErr?.message || notifyErr);
    }

    await auditLog(req, {
      action: 'branch_transfer_reject',
      module: 'products',
      entityType: 'ProductBranchTransfer',
      entityId: transfer._id,
      message: `Branch transfer rejected (${qty})`,
      metadata: { productId: sourceProduct._id, rejectReason },
    });

    return res.json({ message: 'Transfer rejected; reservation released', transferId: transfer._id });
  } catch (e) {
    await session.abortTransaction();
    session.endSession();
    console.error('rejectBranchTransfer:', e);
    return res.status(500).json({ error: 'Failed to reject transfer' });
  }
};

/**
 * Query: userId (required), status=pending|approved|rejected|all,
 * page, limit, branchId (csv), categoryId (csv), search (product name/code)
 */
export const listBranchTransfers = async (req, res) => {
  try {
    const userId = req.query.userId || req.query.user_id;
    if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) {
      return res.status(400).json({ error: 'userId is required' });
    }
    const user = await loadUserForBranchTransfer(userId);
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    const rawStatus = String(req.query.status || 'pending').trim().toLowerCase();
    const andParts = [];

    if (rawStatus === 'all') {
      // no status filter
    } else if (['pending', 'approved', 'rejected'].includes(rawStatus)) {
      andParts.push({ status: rawStatus });
    } else {
      andParts.push({ status: 'pending' });
    }

    if (!TRANSFER_ADMIN_ROLES.includes(String(user.role || '').trim())) {
      if (user.role === 'Branch Manager' && user.branch) {
        const bid = user.branch;
        andParts.push({ $or: [{ toBranch: bid }, { fromBranch: bid }] });
      } else {
        return res.json({
          transfers: [],
          meta: {
            currentPage: page,
            totalCount: 0,
            totalPages: 0,
            nextPage: null,
            prevPage: null,
          },
        });
      }
    }

    // Optional createdAt date range (Cairo business days), query: from / to as YYYY-MM-DD
    const fromDate = String(req.query.from || '').trim();
    const toDate = String(req.query.to || '').trim();
    if (fromDate || toDate) {
      const timezone = 'Africa/Cairo';
      const createdAt = {};
      if (fromDate) {
        createdAt.$gte = moment.tz(fromDate, 'YYYY-MM-DD', timezone).startOf('day').utc().toDate();
      }
      if (toDate) {
        createdAt.$lte = moment.tz(toDate, 'YYYY-MM-DD', timezone).endOf('day').utc().toDate();
      }
      andParts.push({ createdAt });
    }

    const fromBranchIds = toObjectIds(parseOidCsvList(req.query.fromBranchId));
    if (fromBranchIds.length) {
      andParts.push({ fromBranch: { $in: fromBranchIds } });
    }

    const toBranchIds = toObjectIds(parseOidCsvList(req.query.toBranchId));
    if (toBranchIds.length) {
      andParts.push({ toBranch: { $in: toBranchIds } });
    }

    const categoryIds = toObjectIds(parseOidCsvList(req.query.categoryId));
    const search = String(req.query.search || '').trim();
    if (categoryIds.length || search) {
      const productQuery = {};
      if (categoryIds.length === 1) {
        productQuery.category = categoryIds[0];
      } else if (categoryIds.length > 1) {
        productQuery.category = { $in: categoryIds };
      }
      if (search) {
        productQuery.$or = [
          { name: { $regex: escapeRegex(search), $options: 'i' } },
          { code: { $regex: escapeRegex(search), $options: 'i' } },
        ];
      }
      const matchingProducts = await Product.find(productQuery).select('_id').lean();
      const productIds = (matchingProducts || []).map((p) => p._id);
      const productMatchOr = [];
      if (productIds.length) {
        productMatchOr.push(
          { product: { $in: productIds } },
          { destinationProduct: { $in: productIds } }
        );
      }
      if (search) {
        productMatchOr.push(
          { productNameSnapshot: { $regex: escapeRegex(search), $options: 'i' } },
          { productCodeSnapshot: { $regex: escapeRegex(search), $options: 'i' } }
        );
      }
      if (!productMatchOr.length) {
        return res.json({
          transfers: [],
          meta: {
            currentPage: page,
            totalCount: 0,
            totalPages: 0,
            nextPage: null,
            prevPage: null,
          },
        });
      }
      andParts.push({ $or: productMatchOr });
    }

    const q =
      andParts.length === 0
        ? {}
        : andParts.length === 1
          ? andParts[0]
          : { $and: andParts };

    const [totalCount, transfers] = await Promise.all([
      ProductBranchTransfer.countDocuments(q),
      ProductBranchTransfer.find(q)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate({
          path: 'product',
          select: 'name code stock branch inWarehouse transferReservedQuantity category',
          populate: { path: 'category', select: 'name deleteProductWhenOutOfStock' },
        })
        .populate('destinationProduct', 'name code')
        .populate('fromBranch', 'name')
        .populate('toBranch', 'name')
        .populate('initiatedBy', 'name')
        .populate('resolvedBy', 'name')
        .lean(),
    ]);

    // Source product may have been deleted (common after reject/approve) —
    // fall back to dest / snapshot / stock movement / notification.
    const missingProductTransfers = (transfers || []).filter((t) => !t.product);
    const missingProductTransferIds = missingProductTransfers.map((t) => t._id);
    let movementNameByTransferId = new Map();
    let notifyMetaByTransferId = new Map();
    if (missingProductTransferIds.length) {
      const [movements, notifications] = await Promise.all([
        StockMovement.find({
          referenceType: 'branch_transfer',
          referenceId: { $in: missingProductTransferIds },
        })
          .select('referenceId productName')
          .lean(),
        Notification.find({
          type: {
            $in: [
              'branch_transfer_pending',
              'branch_transfer_rejected',
              'branch_transfer_approved',
            ],
          },
          $or: [
            { 'data.transferId': { $in: missingProductTransferIds } },
            {
              'data.transferId': {
                $in: missingProductTransferIds.map((id) => String(id)),
              },
            },
          ],
        })
          .select('data body type createdAt')
          .sort({ createdAt: 1 })
          .lean(),
      ]);
      movementNameByTransferId = new Map(
        (movements || [])
          .filter((m) => m.referenceId)
          .map((m) => [String(m.referenceId), String(m.productName || '').trim()])
      );
      for (const n of notifications || []) {
        const tid = n?.data?.transferId != null ? String(n.data.transferId) : '';
        if (!tid || notifyMetaByTransferId.has(tid)) continue;
        const dataName = String(n.data?.productName || '').trim();
        const dataCode = String(n.data?.productCode || '').trim();
        let bodyName = '';
        if (!dataName && n.body) {
          // Bodies like: "ProductName ×3: reason" or "ProductName ×3 transfer was rejected"
          const m = String(n.body).match(/^(.*?)\s×\d+/);
          bodyName = m ? String(m[1] || '').trim() : '';
        }
        notifyMetaByTransferId.set(tid, {
          name: dataName || bodyName || '',
          code: dataCode || '',
        });
      }
    }

    const hydratedTransfers = (transfers || []).map((t) => {
      if (t.product) {
        return t;
      }
      const dest = t.destinationProduct;
      const notifyMeta = notifyMetaByTransferId.get(String(t._id)) || {};
      const name =
        (dest && dest.name) ||
        t.productNameSnapshot ||
        movementNameByTransferId.get(String(t._id)) ||
        notifyMeta.name ||
        '';
      const code =
        (dest && dest.code) || t.productCodeSnapshot || notifyMeta.code || '';
      return {
        ...t,
        productNameSnapshot: t.productNameSnapshot || name || '',
        productCodeSnapshot: t.productCodeSnapshot || code || '',
        product: name || code ? { name, code } : null,
      };
    });

    const totalPages = Math.ceil(totalCount / limit) || 0;

    return res.json({
      transfers: hydratedTransfers,
      meta: {
        currentPage: page,
        totalCount,
        totalPages,
        nextPage: page < totalPages ? page + 1 : null,
        prevPage: page > 1 ? page - 1 : null,
      },
    });
  } catch (e) {
    console.error('listBranchTransfers:', e);
    return res.status(500).json({ error: 'Failed to list transfers' });
  }
};

/** Incoming pending transfers for toolbar badge */
export const getPendingBranchTransferCount = async (req, res) => {
  try {
    const userId = req.query.userId || req.query.user_id;
    if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) {
      return res.status(400).json({ error: 'userId is required' });
    }
    const user = await loadUserForBranchTransfer(userId);
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    let count = 0;
    if (TRANSFER_ADMIN_ROLES.includes(String(user.role || '').trim())) {
      count = await ProductBranchTransfer.countDocuments({ status: 'pending' });
    } else if (user.role === 'Branch Manager' && user.branch) {
      count = await ProductBranchTransfer.countDocuments({
        status: 'pending',
        toBranch: user.branch,
      });
    }

    return res.json({ count });
  } catch (e) {
    console.error('getPendingBranchTransferCount:', e);
    return res.status(500).json({ error: 'Failed to count transfers' });
  }
};

/**
 * Transfer product stock from one branch to another.
 * Reuses existing product data; only stock and branch placement are affected.
 */
export const transferProductStock = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { productId, quantity, fromBranchId, toBranchId, fromWarehouse } = req.body;
    const transferQty = Number(quantity);
    const fromWh =
      fromWarehouse === true || fromWarehouse === 'true' || String(fromWarehouse).toLowerCase() === 'true';

    if (!productId || !toBranchId || !transferQty || transferQty <= 0) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        error: fromWh
          ? 'productId, quantity, toBranchId are required.'
          : 'productId, quantity, fromBranchId, toBranchId are required.',
      });
    }

    if (!fromWh && !fromBranchId) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: 'productId, quantity, fromBranchId, toBranchId are required.' });
    }

    if (!fromWh && fromBranchId === toBranchId) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: 'From/To branch cannot be the same.' });
    }

    const sourceProduct = await Product.findById(productId).session(session);
    if (!sourceProduct) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ error: 'Source product not found.' });
    }

    if (fromWh) {
      if (!sourceProduct.inWarehouse) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ error: 'Selected product is not in warehouse.' });
      }
    } else if (String(sourceProduct.branch) !== String(fromBranchId)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: 'Source branch does not match selected product branch.' });
    }

    const reserved = Number(sourceProduct.transferReservedQuantity) || 0;
    const sellable = Number(sourceProduct.stock) - reserved;
    if (sellable < transferQty) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        error: fromWh
          ? 'Not enough stock in warehouse.'
          : 'Not enough stock in source branch (some quantity may be reserved for pending transfers).',
      });
    }

    // Decrease stock at source (warehouse or branch)
    sourceProduct.stock = Number(sourceProduct.stock) - transferQty;
    await applyZeroStockAfterTransfer(sourceProduct);
    await sourceProduct.save({ session });

    // Increase stock in destination branch if same code exists there, otherwise create one.
    let destinationProduct = await Product.findOne({
      code: sourceProduct.code,
      branch: toBranchId,
      inWarehouse: { $ne: true },
    }).session(session);

    if (destinationProduct) {
      destinationProduct.stock = Number(destinationProduct.stock) + transferQty;
      destinationProduct.removedWhenOutOfStock = false;
      if (!destinationProduct.acquiredFrom && sourceProduct.acquiredFrom) {
        destinationProduct.acquiredFrom = sourceProduct.acquiredFrom;
      }
      await destinationProduct.save({ session });
    } else {
      const created = await Product.create(
        [
          {
            name: sourceProduct.name,
            code: sourceProduct.code,
            price: sourceProduct.price,
            netPrice: sourceProduct.netPrice,
            stock: transferQty,
            discount: sourceProduct.discount || 0,
            category: sourceProduct.category,
            branch: toBranchId,
            inWarehouse: false,
            addedBy: normalizeAddedBy(sourceProduct.addedBy),
            listedOnEcommerce: Boolean(sourceProduct.listedOnEcommerce),
            ecommerceDescription: String(sourceProduct.ecommerceDescription || ''),
            ecommerceShortDescription: String(sourceProduct.ecommerceShortDescription || ''),
            ecommerceIsFeatured: Boolean(sourceProduct.ecommerceIsFeatured),
            ...(sourceProduct.acquiredFrom
              ? { acquiredFrom: sourceProduct.acquiredFrom }
              : {}),
          },
        ],
        { session }
      );
      destinationProduct = Array.isArray(created) ? created[0] : created;
    }

    await session.commitTransaction();
    session.endSession();

    // Stock movement audit log (outside transaction)
    try {
      await StockMovement.create({
        movementType: 'transfer',
        productId: sourceProduct._id,
        productName: sourceProduct.name,
        branchId: fromWh ? toBranchId : fromBranchId,
        fromBranchId: fromWh ? null : fromBranchId,
        toBranchId,
        quantity: transferQty,
        unitPrice: Number(sourceProduct.price || 0),
        totalValue: Number(sourceProduct.price || 0) * Number(transferQty || 0),
        referenceType: 'transfer',
        referenceId: sourceProduct._id,
        notes: fromWh ? 'Warehouse -> Branch transfer' : 'Branch -> Branch transfer',
      });
    } catch (movementError) {
      console.error('⚠️ Failed to log transfer stock movement:', movementError.message);
    }

    return res.status(200).json({
      message: "✅ Stock transferred successfully",
      sourceProduct,
      destinationProduct: Array.isArray(destinationProduct) ? destinationProduct[0] : destinationProduct,
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("❌ Error transferring stock:", error.message);
    return res.status(500).json({ error: "Failed to transfer stock" });
  }
};

/** GET /products/inventory-audit — stock totals for current list filters, grouped by location. */
export const getProductsInventoryAudit = async (req, res) => {
  try {
    const query = buildProductsListQuery(req.query);
    const search = String(req.query.search || '').trim();

    const stockValueExpr = {
      $multiply: [{ $ifNull: ['$stock', 0] }, { $ifNull: ['$netPrice', 0] }],
    };

    const [totalsAgg, byLocationRaw] = await Promise.all([
      Product.aggregate([
        { $match: query },
        {
          $group: {
            _id: null,
            productsCount: { $sum: 1 },
            totalStock: { $sum: { $ifNull: ['$stock', 0] } },
            totalBooked: { $sum: { $ifNull: ['$bookedQuantity', 0] } },
            totalTransferReserved: { $sum: { $ifNull: ['$transferReservedQuantity', 0] } },
            inventoryCapital: { $sum: stockValueExpr },
          },
        },
        {
          $project: {
            _id: 0,
            productsCount: 1,
            totalStock: 1,
            totalBooked: 1,
            totalTransferReserved: 1,
            inventoryCapital: { $round: ['$inventoryCapital', 2] },
          },
        },
      ]),
      Product.aggregate([
        { $match: query },
        {
          $group: {
            _id: {
              inWarehouse: { $ifNull: ['$inWarehouse', false] },
              branch: '$branch',
            },
            productsCount: { $sum: 1 },
            totalStock: { $sum: { $ifNull: ['$stock', 0] } },
            totalBooked: { $sum: { $ifNull: ['$bookedQuantity', 0] } },
            totalTransferReserved: { $sum: { $ifNull: ['$transferReservedQuantity', 0] } },
            inventoryCapital: { $sum: stockValueExpr },
          },
        },
        {
          $lookup: {
            from: 'branches',
            localField: '_id.branch',
            foreignField: '_id',
            as: 'branchDoc',
          },
        },
        {
          $project: {
            _id: 0,
            inWarehouse: '$_id.inWarehouse',
            branchId: '$_id.branch',
            branchName: {
              $cond: [
                { $eq: ['$_id.inWarehouse', true] },
                null,
                { $ifNull: [{ $arrayElemAt: ['$branchDoc.name', 0] }, 'N/A'] },
              ],
            },
            productsCount: 1,
            totalStock: 1,
            totalBooked: 1,
            totalTransferReserved: 1,
            inventoryCapital: { $round: ['$inventoryCapital', 2] },
          },
        },
        {
          $sort: {
            inWarehouse: 1,
            branchName: 1,
          },
        },
      ]),
    ]);

    const totals = totalsAgg[0] || {
      productsCount: 0,
      totalStock: 0,
      totalBooked: 0,
      totalTransferReserved: 0,
      inventoryCapital: 0,
    };

    const byLocation = (byLocationRaw || []).map((row) => ({
      ...row,
      inventoryCapital: row.inventoryCapital ?? 0,
      totalAvailable: Math.max(
        0,
        (row.totalStock || 0) - (row.totalBooked || 0) - (row.totalTransferReserved || 0)
      ),
    }));

    res.json({
      search: search || null,
      totals: {
        productsCount: totals.productsCount || 0,
        totalStock: totals.totalStock || 0,
        totalBooked: totals.totalBooked || 0,
        totalTransferReserved: totals.totalTransferReserved || 0,
        inventoryCapital: totals.inventoryCapital || 0,
        totalAvailable: Math.max(
          0,
          (totals.totalStock || 0) -
            (totals.totalBooked || 0) -
            (totals.totalTransferReserved || 0)
        ),
      },
      byLocation,
    });
  } catch (error) {
    console.error('getProductsInventoryAudit:', error);
    res.status(500).json({ error: 'Failed to generate products inventory audit' });
  }
};

export const getProductStats = async (req, res) => {
  try {
    const { branchId } = req.query;
    const safeBranchId = parseBranchIdFilter(branchId);
    const filter = {
      ...(safeBranchId ? { branch: safeBranchId } : {}),
      $or: [
        { removedWhenOutOfStock: { $ne: true } },
        { removedWhenOutOfStock: { $exists: false } },
      ],
    };

    // Count stats
    const totalProducts = await Product.countDocuments(filter);
    const inStock = await Product.countDocuments({ ...filter, stock: { $gt: 0 } });
    const outOfStock = await Product.countDocuments({ ...filter, stock: { $lte: 0 } });

    res.status(200).json({
      totalProducts,
      inStock,
      outOfStock,
      branch: safeBranchId || 'All Branches',
    });
  } catch (error) {
    console.error('Error fetching product stats:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

/** GET /api/products/:id/history — full timeline for one product row */
export const getProductHistory = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(String(id))) {
      return res.status(400).json({ error: 'Invalid product id' });
    }

    const product = await Product.findById(id)
      .populate('category', 'name code')
      .populate('branch', 'name')
      .lean();

    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const { events } = await buildProductHistoryEvents(product);

    res.json({
      product: {
        _id: product._id,
        name: product.name,
        code: product.code,
        stock: product.stock,
        inWarehouse: !!product.inWarehouse,
        branch: product.branch,
        category: product.category,
        addedBy: product.addedBy || '',
        createdAt: product.createdAt,
        updatedAt: product.updatedAt,
      },
      events,
    });
  } catch (error) {
    console.error('getProductHistory:', error);
    res.status(500).json({ error: 'Failed to fetch product history' });
  }
};

/**
 * GET /api/products/serial-track?code=XXX
 * Lookup unit/serial by code — includes deleted (out-of-stock removed) products.
 */
export const getProductSerialTrack = async (req, res) => {
  try {
    const code = req.query?.code ?? req.query?.serial ?? '';
    const result = await trackProductByCode(code);
    if (!result.ok) {
      return res.status(result.statusCode || 404).json({ error: result.error });
    }
    return res.json({
      exists: result.exists,
      status: result.status,
      product: result.product,
      locations: result.locations || [],
      totalStock: result.totalStock ?? result.product?.stock ?? 0,
      events: result.events,
    });
  } catch (error) {
    console.error('getProductSerialTrack:', error);
    res.status(500).json({ error: 'Failed to track product serial' });
  }
};