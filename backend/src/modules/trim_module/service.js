import mongoose from 'mongoose';
import Product from '../../DB/models/product.model.js';
import Branch from '../../DB/models/branch.model.js';
import User from '../../DB/models/user.model.js';
import StockMovement from '../../DB/models/stockMovement.model.js';
import TrimTicket from '../../DB/models/trimTicket.model.js';
import { roundWeight } from '../../utils/sale-quantity.util.js';
import { butcherFeaturesEnabled } from '../../utils/business-activity.util.js';
import { auditLog } from '../audit_module/audit.service.js';
import StoreSettings from '../../DB/models/storeSettings.model.js';
import {
  roundMoney,
  weightedAverageUnitCost,
} from '../../utils/slaughter-cost.util.js';

const ADMIN_ROLES = ['Super Admin', 'Co Admin', 'Admin'];
const STAFF_ROLES = [...ADMIN_ROLES, 'Branch Manager', 'Warehouse', 'Operation Manager'];

function loadActor(userId) {
  if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) return null;
  return User.findById(userId).select('role branch name').lean();
}

function canUse(actor) {
  return actor && STAFF_ROLES.includes(actor.role);
}

function actorMayUseBranch(actor, branchIdStr) {
  if (!actor || !branchIdStr) return false;
  if (ADMIN_ROLES.includes(actor.role)) return true;
  if (!actor.branch) return false;
  return String(actor.branch) === String(branchIdStr);
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function assertTrimActivityEnabled() {
  const doc = await StoreSettings.findOne().sort({ updatedAt: -1 }).lean();
  if (!butcherFeaturesEnabled(doc)) {
    throw httpError(
      403,
      'Trim is disabled. Set business activity to butcher or farm in store settings.'
    );
  }
}

function categoryIdOf(product) {
  if (!product?.category) return null;
  if (typeof product.category === 'object' && product.category._id) {
    return String(product.category._id);
  }
  return String(product.category);
}

function q(query, session) {
  return session ? query.session(session) : query;
}

export const listTickets = async (req, res) => {
  try {
    await assertTrimActivityEnabled();
    const actor = await loadActor(req.query.userId);
    if (!canUse(actor)) {
      return res.status(403).json({ error: 'Not allowed' });
    }
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const filter = {};
    if (req.query.branch_id && mongoose.Types.ObjectId.isValid(String(req.query.branch_id))) {
      filter.branch = req.query.branch_id;
    } else if (!ADMIN_ROLES.includes(actor.role) && actor.branch) {
      filter.branch = actor.branch;
    }
    const [tickets, total] = await Promise.all([
      TrimTicket.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('branch', 'name')
        .populate('sourceProductId', 'name code stock')
        .populate('createdBy', 'name')
        .lean(),
      TrimTicket.countDocuments(filter),
    ]);
    return res.json({
      tickets,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
    });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || 'Failed to list trim tickets' });
  }
};

export const getTicket = async (req, res) => {
  try {
    await assertTrimActivityEnabled();
    const ticket = await TrimTicket.findById(req.params.id)
      .populate('branch', 'name')
      .populate('sourceProductId', 'name code stock')
      .populate('outputs.productId', 'name code stock')
      .populate('createdBy', 'name')
      .lean();
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    return res.json({ ticket });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || 'Failed to load trim ticket' });
  }
};

async function persistTrimTicket(req, session) {
  await assertTrimActivityEnabled();
  const actor = await loadActor(req.body.userId);
  if (!canUse(actor)) throw httpError(403, 'Not allowed');

  const sourceProductId = req.body.sourceProductId || req.body.productId;
  if (!sourceProductId || !mongoose.Types.ObjectId.isValid(String(sourceProductId))) {
    throw httpError(400, 'sourceProductId is required');
  }

  const source = await q(
    Product.findById(sourceProductId).populate('category', 'name code'),
    session
  );
  if (!source) throw httpError(400, 'Source product not found');
  if (source.inWarehouse || !source.branch) {
    throw httpError(400, 'Trim is only allowed for branch products');
  }

  const branchId = req.body.branchId || req.body.branch || source.branch;
  if (!branchId || !mongoose.Types.ObjectId.isValid(String(branchId))) {
    throw httpError(400, 'Valid branch is required');
  }
  if (!actorMayUseBranch(actor, String(branchId))) {
    throw httpError(403, 'Cannot trim for this branch');
  }
  if (String(source.branch) !== String(branchId)) {
    throw httpError(400, 'Source product is not in this branch');
  }
  const branch = await q(Branch.findById(branchId), session);
  if (!branch) throw httpError(400, 'Branch not found');

  const productType = String(source.productType || 'good').toLowerCase();
  if (productType === 'service' || productType === 'farm') {
    throw httpError(400, 'Cannot trim service or farm animal products');
  }

  const inputQty = roundWeight(Number(req.body.inputQty) || 0);
  if (inputQty <= 0) throw httpError(400, 'inputQty must be greater than 0');

  const sourceStock = roundWeight(Number(source.stock || 0));
  if (sourceStock + 0.0001 < inputQty) {
    throw httpError(
      400,
      `Not enough stock (have ${sourceStock}, need ${inputQty})`
    );
  }

  const sourceCategoryId = categoryIdOf(source);
  if (!sourceCategoryId) throw httpError(400, 'Source product has no category');

  const rawOutputs = Array.isArray(req.body.outputs) ? req.body.outputs : [];
  /** @type {{ product: any, qty: number }[]} */
  const pendingOutputs = [];
  const seen = new Set();
  for (const row of rawOutputs) {
    const qty = roundWeight(Number(row.quantity) || 0);
    if (qty <= 0) continue;
    if (!row.productId || !mongoose.Types.ObjectId.isValid(String(row.productId))) {
      throw httpError(400, 'Each output needs a valid productId');
    }
    const pid = String(row.productId);
    if (seen.has(pid)) {
      throw httpError(400, 'Duplicate output product in the same ticket');
    }
    seen.add(pid);

    let product;
    if (pid === String(source._id)) {
      // Same SKU as source is allowed: e.g. fridge meat in → meat yield out + waste.
      product = source;
    } else {
      product = await q(Product.findById(pid).populate('category', 'name'), session);
      if (!product) throw httpError(400, `Output product not found (${pid})`);
      if (String(product.branch) !== String(branchId)) {
        throw httpError(400, `Output ${product.name} is not in this branch`);
      }
      if (categoryIdOf(product) !== sourceCategoryId) {
        throw httpError(400, `Output ${product.name} must be in the same category`);
      }
      const outType = String(product.productType || 'good').toLowerCase();
      if (outType === 'service' || outType === 'farm') {
        throw httpError(400, `Cannot use ${product.name} as trim output`);
      }
    }
    pendingOutputs.push({ product, qty });
  }

  if (!pendingOutputs.length) {
    throw httpError(400, 'At least one output quantity is required');
  }

  const outputQty = roundWeight(pendingOutputs.reduce((s, o) => s + o.qty, 0));
  let wasteQty = 0;
  if (req.body.wasteQty === 0 || req.body.wasteQty === '0') {
    wasteQty = 0;
  } else if (req.body.wasteQty != null && req.body.wasteQty !== '') {
    const n = Number(req.body.wasteQty);
    wasteQty = Number.isFinite(n) ? roundWeight(Math.max(0, n)) : 0;
  } else {
    wasteQty = roundWeight(Math.max(0, inputQty - outputQty));
  }

  const accounted = roundWeight(outputQty + wasteQty);
  if (accounted - inputQty > 0.001) {
    throw httpError(
      400,
      `Outputs + waste (${accounted}) cannot exceed input quantity (${inputQty})`
    );
  }
  // Any unaccounted remainder is treated as extra waste.
  if (inputQty - accounted > 0.001) {
    wasteQty = roundWeight(wasteQty + (inputQty - accounted));
  }

  const sourceCostTotal = roundMoney(Math.max(0, Number(source.netPrice || 0)) * inputQty);
  const costPerUnit = outputQty > 0 ? roundMoney(sourceCostTotal / outputQty) : 0;
  const sourceId = String(source._id);

  // Consume input first, then add yields (same-SKU yield must use the reduced stock).
  let workingStock = roundWeight(sourceStock - inputQty);
  let workingCost = Number(source.netPrice || 0);

  const outputLines = [];
  for (const row of pendingOutputs) {
    const unitCost = costPerUnit;
    if (String(row.product._id) === sourceId) {
      const oldStock = workingStock;
      const oldCost = workingCost;
      workingStock = roundWeight(oldStock + row.qty);
      workingCost = weightedAverageUnitCost(oldStock, oldCost, row.qty, unitCost);
      outputLines.push({
        productId: source._id,
        name: source.name,
        code: source.code || '',
        quantity: row.qty,
        unitCost,
      });
    } else {
      const oldStock = roundWeight(Number(row.product.stock || 0));
      const oldCost = Number(row.product.netPrice || 0);
      row.product.stock = roundWeight(oldStock + row.qty);
      row.product.netPrice = weightedAverageUnitCost(oldStock, oldCost, row.qty, unitCost);
      await row.product.save(session ? { session } : undefined);
      outputLines.push({
        productId: row.product._id,
        name: row.product.name,
        code: row.product.code || '',
        quantity: row.qty,
        unitCost,
      });
    }
  }

  source.stock = workingStock;
  source.netPrice = workingCost;
  await source.save(session ? { session } : undefined);

  const createOpts = session ? { session, ordered: true } : undefined;
  const ticketDocs = await TrimTicket.create(
    [
      {
        branch: branchId,
        sourceProductId: source._id,
        sourceProductName: source.name,
        sourceProductCode: source.code || '',
        categoryId: source.category?._id || source.category,
        categoryName: source.category?.name || '',
        inputQty,
        outputQty,
        wasteQty,
        sourceCostTotal,
        costPerUnit,
        outputs: outputLines,
        notes: String(req.body.notes || '').trim(),
        createdBy: actor._id,
      },
    ],
    createOpts
  );
  const ticket = Array.isArray(ticketDocs) ? ticketDocs[0] : ticketDocs;

  await StockMovement.create(
    [
      {
        movementType: 'production',
        productId: source._id,
        productName: source.name,
        branchId,
        quantity: inputQty,
        notes: `Trim consume ${inputQty} (waste ${wasteQty})`,
        referenceType: 'TrimTicket',
        referenceId: ticket._id,
      },
      ...outputLines.map((line) => ({
        movementType: 'production',
        productId: line.productId,
        productName: line.name,
        branchId,
        quantity: line.quantity,
        notes: `Trim yield @ ${line.unitCost}/unit`,
        referenceType: 'TrimTicket',
        referenceId: ticket._id,
      })),
    ],
    createOpts
  );

  await auditLog(req, {
    action: 'create',
    module: 'trim',
    entityType: 'TrimTicket',
    entityId: ticket._id,
    message: `Trim ${source.name} input ${inputQty}, waste ${wasteQty}`,
    after: { inputQty, outputQty, wasteQty, outputs: outputLines.length, sourceCostTotal },
  });

  return TrimTicket.findById(ticket._id)
    .populate('branch', 'name')
    .populate('sourceProductId', 'name code stock netPrice')
    .populate('createdBy', 'name')
    .lean();
}

export const createTicket = async (req, res) => {
  let session = null;
  try {
    session = await mongoose.startSession();
    session.startTransaction();
    const populated = await persistTrimTicket(req, session);
    await session.commitTransaction();
    session.endSession();
    session = null;
    return res.status(201).json({ ticket: populated });
  } catch (e) {
    if (session) {
      try {
        await session.abortTransaction();
      } catch (_) {
        /* ignore */
      }
      session.endSession();
      session = null;
    }
    const txFail = /transaction|replica set|IllegalOperation|Txn/i.test(String(e.message || ''));
    if (txFail && !(e.status >= 400 && e.status < 500)) {
      try {
        const populated = await persistTrimTicket(req, null);
        return res.status(201).json({ ticket: populated });
      } catch (e2) {
        return res.status(e2.status || 500).json({ error: e2.message || 'Failed to create trim ticket' });
      }
    }
    return res.status(e.status || 500).json({ error: e.message || 'Failed to create trim ticket' });
  }
};
