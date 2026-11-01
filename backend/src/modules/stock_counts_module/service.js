import mongoose from 'mongoose';
import StockCount from '../../DB/models/stockCount.model.js';
import User from '../../DB/models/user.model.js';
import Branch from '../../DB/models/branch.model.js';
import Category from '../../DB/models/category.model.js';
import Product from '../../DB/models/product.model.js';
import { findLiveProductsByScannedCode } from '../../utils/product-serial-track.js';
import {
  buildAllRows,
  buildScannedRows,
  buildShortageRows,
  buildSummary,
  buildSurplusRows,
  categoryIdOf,
  classifyScan,
  filterLines,
  isWeightProduct,
  paginateLines,
} from '../../utils/stock-count.js';

const ADMIN_ROLES = ['Super Admin', 'Co Admin', 'Admin'];
const WAREHOUSE_ROLES = ['Warehouse', 'Operation Manager'];
const BRANCH_ROLES = ['Branch Manager', 'Cashier'];

function actorUserId(req) {
  const body = req?.body || {};
  const query = req?.query || {};
  return body.userId || body.viewerUserId || query.userId || query.viewerUserId || null;
}

async function loadActor(userId) {
  if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) return null;
  return User.findById(userId).select('role branch name').lean();
}

function canUseStockCount(actor) {
  if (!actor) return false;
  const role = String(actor.role || '');
  return ADMIN_ROLES.includes(role) || WAREHOUSE_ROLES.includes(role) || BRANCH_ROLES.includes(role);
}

function isStorewide(actor) {
  const role = String(actor?.role || '');
  return ADMIN_ROLES.includes(role) || WAREHOUSE_ROLES.includes(role);
}

function actorCanAccess(actor, count) {
  if (!canUseStockCount(actor) || !count) return false;
  if (isStorewide(actor)) return true;
  if (!actor.branch) return false;
  return count.locationType === 'branch' && String(count.branch || '') === String(actor.branch);
}

function fail(res, status, code, extra = {}) {
  return res.status(status).json({ error: code, code, ...extra });
}

async function requireActor(req, res) {
  const userId = actorUserId(req);
  if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) {
    fail(res, 400, 'user_required');
    return null;
  }
  const actor = await loadActor(userId);
  if (!actor) {
    fail(res, 401, 'user_not_found');
    return null;
  }
  if (!canUseStockCount(actor)) {
    fail(res, 403, 'not_allowed');
    return null;
  }
  return actor;
}

async function loadCountForActor(req, res, actor) {
  const id = req.params?.id;
  if (!id || !mongoose.Types.ObjectId.isValid(String(id))) {
    fail(res, 404, 'not_found');
    return null;
  }
  const count = await StockCount.findById(id);
  if (!count || !actorCanAccess(actor, count)) {
    fail(res, 404, 'not_found');
    return null;
  }
  return count;
}

function publicCount(count) {
  const branchId = count.branch?._id || count.branch || null;
  return {
    _id: count._id,
    locationType: count.locationType,
    branch: branchId
      ? { _id: branchId, name: count.branchName || count.branch?.name || '' }
      : null,
    branchName: count.branchName || '',
    categories: (count.categories || []).map((row) => ({
      categoryId: row.categoryId,
      name: row.name || '',
    })),
    status: count.status,
    note: count.note || '',
    startedAt: count.startedAt,
    completedAt: count.completedAt || null,
    createdBy: {
      userId: count.createdBy?.userId || null,
      name: count.createdBy?.name || '',
    },
    summary: {
      expectedUnits: Number(count.summary?.expectedUnits) || 0,
      countedUnits: Number(count.summary?.countedUnits) || 0,
      shortageUnits: Number(count.summary?.shortageUnits) || 0,
      surplusUnits: Number(count.summary?.surplusUnits) || 0,
    },
  };
}

function productFeedback(product, rawCode) {
  if (!product) {
    return { name: '', code: String(rawCode || '').trim(), categoryName: '' };
  }
  return {
    name: product.name || '',
    code: product.code || '',
    categoryName: product.category?.name || '',
  };
}

function applySummary(count) {
  count.summary = buildSummary(count.expectedItems, count.scans);
}

function sectionLines(count, section) {
  if (section === 'all') return buildAllRows(count.expectedItems, count.scans);
  if (section === 'scanned') return buildScannedRows(count.scans);
  if (section === 'surplus') {
    if (count.status === 'completed' && Array.isArray(count.result?.surpluses)) {
      return count.result.surpluses;
    }
    return buildSurplusRows(count.scans);
  }
  if (count.status === 'completed' && Array.isArray(count.result?.shortages)) {
    return count.result.shortages;
  }
  return buildShortageRows(count.expectedItems, count.scans);
}

async function expectedProductsForScope({ locationType, branch, categoryIds }) {
  const filter = {
    category: { $in: categoryIds },
    removedWhenOutOfStock: { $ne: true },
    stock: { $gt: 0 },
  };
  if (locationType === 'warehouse') {
    filter.inWarehouse = true;
  } else {
    filter.branch = branch;
    filter.inWarehouse = { $ne: true };
  }
  const products = await Product.find(filter)
    .select('name code stock category sellByWeightOverride removedWhenOutOfStock')
    .populate('category', 'name sellByWeight')
    .lean();
  return (products || []).filter((product) => !isWeightProduct(product));
}

function toExpectedItem(product) {
  const expectedQty = Math.max(0, Math.round(Number(product.stock) || 0));
  return {
    productId: product._id,
    name: product.name || '',
    code: product.code || '',
    categoryName: product.category?.name || '',
    expectedQty,
  };
}

export const createStockCount = async (req, res) => {
  try {
    const actor = await requireActor(req, res);
    if (!actor) return;

    const body = req.body || {};
    const note = String(body.note || '').trim().slice(0, 500);
    const rawIds = Array.isArray(body.categoryIds) ? body.categoryIds : [];
    const categoryIds = [...new Set(rawIds.map((id) => String(id || '').trim()))].filter((id) =>
      mongoose.Types.ObjectId.isValid(id)
    );
    if (!categoryIds.length) return fail(res, 400, 'categories_required');

    const categories = await Category.find({ _id: { $in: categoryIds } })
      .select('name sellByWeight')
      .lean();
    if (categories.length !== categoryIds.length) return fail(res, 400, 'category_not_found');

    const weight = categories.filter((category) => category.sellByWeight);
    if (weight.length) {
      return fail(res, 400, 'weight_category', {
        names: weight.map((category) => category.name || ''),
      });
    }

    let locationType = 'branch';
    let branch = null;
    let branchName = '';

    if (isStorewide(actor)) {
      locationType = body.locationType === 'warehouse' ? 'warehouse' : 'branch';
      if (locationType === 'branch') {
        const branchId = String(body.branchId || '').trim();
        if (!branchId || !mongoose.Types.ObjectId.isValid(branchId)) {
          return fail(res, 400, 'branch_required');
        }
        const branchDoc = await Branch.findById(branchId).select('name').lean();
        if (!branchDoc) return fail(res, 400, 'branch_not_found');
        branch = branchDoc._id;
        branchName = branchDoc.name || '';
      }
    } else {
      if (!actor.branch) return fail(res, 400, 'no_branch');
      const branchDoc = await Branch.findById(actor.branch).select('name').lean();
      if (!branchDoc) return fail(res, 400, 'branch_not_found');
      branch = branchDoc._id;
      branchName = branchDoc.name || '';
    }

    const products = await expectedProductsForScope({ locationType, branch, categoryIds });
    const expectedItems = products
      .map(toExpectedItem)
      .filter((item) => item.expectedQty > 0);

    const count = await StockCount.create({
      locationType,
      branch,
      branchName,
      categories: categories.map((category) => ({
        categoryId: category._id,
        name: category.name || '',
      })),
      expectedItems,
      status: 'open',
      note,
      startedAt: new Date(),
      createdBy: { userId: actor._id, name: actor.name || '' },
      scans: [],
      summary: buildSummary(expectedItems, []),
      result: { shortages: [], surpluses: [] },
    });

    return res.status(201).json({ count: publicCount(count) });
  } catch (err) {
    console.error('createStockCount:', err);
    return res.status(500).json({ error: 'Failed to create stock count', code: 'server' });
  }
};

export const listStockCounts = async (req, res) => {
  try {
    const actor = await requireActor(req, res);
    if (!actor) return;

    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 15));
    const query = {};

    if (!isStorewide(actor)) {
      if (!actor.branch) return fail(res, 400, 'no_branch');
      query.locationType = 'branch';
      query.branch = actor.branch;
    } else if (req.query.location === 'warehouse') {
      query.locationType = 'warehouse';
    } else if (
      req.query.location &&
      mongoose.Types.ObjectId.isValid(String(req.query.location))
    ) {
      query.locationType = 'branch';
      query.branch = new mongoose.Types.ObjectId(String(req.query.location));
    }

    const status = String(req.query.status || '').trim();
    if (status === 'open' || status === 'completed') query.status = status;

    if (req.query.categoryId && mongoose.Types.ObjectId.isValid(String(req.query.categoryId))) {
      query['categories.categoryId'] = new mongoose.Types.ObjectId(String(req.query.categoryId));
    }

    const started = {};
    if (req.query.dateFrom) {
      const from = new Date(String(req.query.dateFrom));
      if (!Number.isNaN(from.getTime())) {
        from.setHours(0, 0, 0, 0);
        started.$gte = from;
      }
    }
    if (req.query.dateTo) {
      const to = new Date(String(req.query.dateTo));
      if (!Number.isNaN(to.getTime())) {
        to.setHours(23, 59, 59, 999);
        started.$lte = to;
      }
    }
    if (Object.keys(started).length) query.startedAt = started;

    const skip = (page - 1) * limit;
    const [rows, total] = await Promise.all([
      StockCount.find(query)
        .select('-scans -expectedItems -result')
        .sort({ startedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      StockCount.countDocuments(query),
    ]);

    const totalPages = total ? Math.ceil(total / limit) : 0;
    return res.json({
      counts: rows.map(publicCount),
      meta: {
        currentPage: page,
        totalCount: total,
        totalPages,
        nextPage: total && page < totalPages ? page + 1 : null,
        prevPage: page > 1 ? page - 1 : null,
      },
    });
  } catch (err) {
    console.error('listStockCounts:', err);
    return res.status(500).json({ error: 'Failed to list stock counts', code: 'server' });
  }
};

async function attachProductFaces(rows) {
  const ids = [
    ...new Set(
      (rows || [])
        .map((row) => String(row.productId || ''))
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
    ),
  ];
  if (!ids.length) return rows || [];
  const products = await Product.find({ _id: { $in: ids } })
    .select('imageUrl ecommerceVariantLabel')
    .lean();
  const faces = new Map(products.map((product) => [String(product._id), product]));
  return (rows || []).map((row) => {
    const face = faces.get(String(row.productId || ''));
    return {
      ...row,
      imageUrl: face?.imageUrl || '',
      subtitle: face?.ecommerceVariantLabel || '',
    };
  });
}

export const getStockCount = async (req, res) => {
  try {
    const actor = await requireActor(req, res);
    if (!actor) return;
    const count = await loadCountForActor(req, res, actor);
    if (!count) return;

    const sectionRaw = String(req.query.section || 'all');
    const section = ['all', 'shortage', 'surplus', 'scanned'].includes(sectionRaw)
      ? sectionRaw
      : 'all';

    if (count.status === 'open') {
      applySummary(count);
      await StockCount.updateOne({ _id: count._id }, { $set: { summary: count.summary } });
    }

    const lines = filterLines(sectionLines(count, section), req.query.q, req.query.category);
    const exportAll = String(req.query.export || '') === '1';
    const { rows, meta } = exportAll
      ? {
          rows: lines.slice(0, 5000),
          meta: {
            currentPage: 1,
            totalCount: lines.length,
            totalPages: lines.length ? 1 : 0,
            nextPage: null,
            prevPage: null,
          },
        }
      : paginateLines(lines, req.query.page, req.query.limit);

    return res.json({
      count: publicCount(count),
      section,
      lines: await attachProductFaces(rows),
      meta,
    });
  } catch (err) {
    console.error('getStockCount:', err);
    return res.status(500).json({ error: 'Failed to load stock count', code: 'server' });
  }
};

export const scanStockCount = async (req, res) => {
  try {
    const actor = await requireActor(req, res);
    if (!actor) return;
    const count = await loadCountForActor(req, res, actor);
    if (!count) return;
    if (count.status !== 'open') return fail(res, 409, 'already_closed');

    const rawCode = req.body?.code;
    const matches = await findLiveProductsByScannedCode(rawCode);
    const decision = classifyScan(count, matches, rawCode);

    if (decision.action === 'invalid') return fail(res, 400, 'code_required');
    if (decision.action === 'too_long') return fail(res, 400, 'code_too_long');

    if (decision.action === 'record') {
      const product = decision.product;
      count.scans.push({
        rawCode: decision.rawCode,
        normalizedCode: decision.normalized,
        productId: product?._id || null,
        productName: product?.name || '',
        productCode: product?.code || '',
        categoryId: product ? categoryIdOf(product) || null : null,
        categoryName: product?.category?.name || '',
        kind: decision.kind,
        surplusReason: decision.reason || '',
        scannedAt: new Date(),
      });
      applySummary(count);
      await count.save();
    }

    const feedback =
      decision.action === 'record' ? decision.kind : decision.action;

    return res.json({
      feedback,
      reason: decision.reason || '',
      rawCode: decision.rawCode || String(rawCode || '').trim(),
      product: productFeedback(decision.product, decision.rawCode),
      summary: publicCount(count).summary,
    });
  } catch (err) {
    console.error('scanStockCount:', err);
    return res.status(500).json({ error: 'Failed to scan', code: 'server' });
  }
};

export const removeStockCountScan = async (req, res) => {
  try {
    const actor = await requireActor(req, res);
    if (!actor) return;
    const count = await loadCountForActor(req, res, actor);
    if (!count) return;
    if (count.status !== 'open') return fail(res, 409, 'already_closed');

    const scanId = String(req.params.scanId || '');
    if (!mongoose.Types.ObjectId.isValid(scanId)) return fail(res, 404, 'scan_not_found');
    const before = count.scans.length;
    count.scans.pull(scanId);
    if (count.scans.length === before) return fail(res, 404, 'scan_not_found');

    applySummary(count);
    await count.save();
    return res.json({ count: publicCount(count) });
  } catch (err) {
    console.error('removeStockCountScan:', err);
    return res.status(500).json({ error: 'Failed to remove scan', code: 'server' });
  }
};

export const completeStockCount = async (req, res) => {
  try {
    const actor = await requireActor(req, res);
    if (!actor) return;
    const count = await loadCountForActor(req, res, actor);
    if (!count) return;
    if (count.status !== 'open') return fail(res, 409, 'already_closed');

    applySummary(count);
    count.result = {
      shortages: buildShortageRows(count.expectedItems, count.scans),
      surpluses: buildSurplusRows(count.scans),
    };
    count.status = 'completed';
    count.completedAt = new Date();
    await count.save();
    return res.json({ count: publicCount(count) });
  } catch (err) {
    console.error('completeStockCount:', err);
    return res.status(500).json({ error: 'Failed to complete stock count', code: 'server' });
  }
};

export const deleteStockCount = async (req, res) => {
  try {
    const actor = await requireActor(req, res);
    if (!actor) return;
    const count = await loadCountForActor(req, res, actor);
    if (!count) return;
    if (count.status !== 'open') return fail(res, 409, 'already_closed');
    await count.deleteOne();
    return res.json({ ok: true });
  } catch (err) {
    console.error('deleteStockCount:', err);
    return res.status(500).json({ error: 'Failed to delete stock count', code: 'server' });
  }
};
