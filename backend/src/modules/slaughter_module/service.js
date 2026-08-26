import mongoose from 'mongoose';
import Product from '../../DB/models/product.model.js';
import Branch from '../../DB/models/branch.model.js';
import User from '../../DB/models/user.model.js';
import StockMovement from '../../DB/models/stockMovement.model.js';
import SlaughterTemplate from '../../DB/models/slaughterTemplate.model.js';
import SlaughterTicket from '../../DB/models/slaughterTicket.model.js';
import { AL_RAJI_SLAUGHTER_TEMPLATES } from '../../../scripts/alRajiCatalogData.js';
import { isFarmProduct, isValidSlaughterShare, roundFarmHeads } from '../../utils/product-type.util.js';
import { roundWeight } from '../../utils/sale-quantity.util.js';
import { normalizeBusinessActivityType, butcherFeaturesEnabled } from '../../utils/business-activity.util.js';
import { auditLog } from '../audit_module/audit.service.js';
import StoreSettings from '../../DB/models/storeSettings.model.js';
import {
  allocateSlaughterCost,
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

async function assertSlaughterActivityEnabled() {
  const doc = await StoreSettings.findOne().sort({ updatedAt: -1 }).lean();
  if (!butcherFeaturesEnabled(doc)) {
    throw httpError(
      403,
      'Slaughter is disabled. Set business activity to butcher or farm in store settings.'
    );
  }
}

export async function ensureDefaultTemplates() {
  for (const t of AL_RAJI_SLAUGHTER_TEMPLATES) {
    await SlaughterTemplate.findOneAndUpdate(
      { code: t.code },
      {
        $setOnInsert: {
          code: t.code,
          name: t.name,
          farmSkuKey: t.farmSkuKey,
          outputs: t.outputs,
        },
      },
      { upsert: true, new: true }
    );
  }
}

export const listTemplates = async (req, res) => {
  try {
    await assertSlaughterActivityEnabled();
    await ensureDefaultTemplates();
    const templates = await SlaughterTemplate.find().sort({ name: 1 }).lean();
    return res.json({ templates });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || 'Failed to list templates' });
  }
};

export const upsertTemplate = async (req, res) => {
  try {
    const actor = await loadActor(req.body.userId);
    if (!actor || !ADMIN_ROLES.includes(actor.role)) {
      return res.status(403).json({ error: 'Not allowed' });
    }
    const code = String(req.body.code || '').trim().toUpperCase();
    const name = String(req.body.name || '').trim();
    const farmSkuKey = String(req.body.farmSkuKey || '').trim();
    if (!code || !name || !farmSkuKey) {
      return res.status(400).json({ error: 'code, name, farmSkuKey are required' });
    }
    const outputs = Array.isArray(req.body.outputs) ? req.body.outputs : [];
    const template = await SlaughterTemplate.findOneAndUpdate(
      { code },
      { code, name, farmSkuKey, outputs },
      { upsert: true, new: true }
    );
    return res.json({ template });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Failed to save template' });
  }
};

export const listTickets = async (req, res) => {
  try {
    await assertSlaughterActivityEnabled();
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
      SlaughterTicket.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('branch', 'name')
        .populate('farmProductId', 'name code catalogKey stock')
        .populate('createdBy', 'name')
        .lean(),
      SlaughterTicket.countDocuments(filter),
    ]);
    return res.json({
      tickets,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
    });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || 'Failed to list tickets' });
  }
};

export const getTicket = async (req, res) => {
  try {
    await assertSlaughterActivityEnabled();
    const ticket = await SlaughterTicket.findById(req.params.id)
      .populate('branch', 'name')
      .populate('farmProductId', 'name code catalogKey stock')
      .populate('outputs.productId', 'name code stock')
      .lean();
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    return res.json({ ticket });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || 'Failed to load ticket' });
  }
};

function q(query, session) {
  return session ? query.session(session) : query;
}

function resolveWasteKg(body, liveWeightKg, outputsTotalKg) {
  if (body.wasteKg === 0 || body.wasteKg === '0') return 0;
  if (body.wasteKg != null && body.wasteKg !== '') {
    const n = Number(body.wasteKg);
    return Number.isFinite(n) ? roundWeight(Math.max(0, n)) : 0;
  }
  if (liveWeightKg > 0) {
    return roundWeight(Math.max(0, liveWeightKg - outputsTotalKg));
  }
  return 0;
}

async function persistSlaughterTicket(req, session) {
  await assertSlaughterActivityEnabled();
  const actor = await loadActor(req.body.userId);
  if (!canUse(actor)) throw httpError(403, 'Not allowed');

  const branchId = req.body.branchId || req.body.branch;
  if (!branchId || !mongoose.Types.ObjectId.isValid(String(branchId))) {
    throw httpError(400, 'Valid branch is required');
  }
  if (!actorMayUseBranch(actor, String(branchId))) {
    throw httpError(403, 'Cannot slaughter for this branch');
  }
  const branch = await q(Branch.findById(branchId), session);
  if (!branch) throw httpError(400, 'Branch not found');

  const share = Number(req.body.share);
  if (!isValidSlaughterShare(share)) {
    throw httpError(400, 'share must be 1, 0.5, or 0.25');
  }

  const farmProductId = req.body.farmProductId;
  if (!farmProductId || !mongoose.Types.ObjectId.isValid(String(farmProductId))) {
    throw httpError(400, 'farmProductId is required');
  }
  const farm = await q(
    Product.findById(farmProductId).populate('category', 'code'),
    session
  );
  if (!farm || String(farm.branch) !== String(branchId)) {
    throw httpError(400, 'Farm animal not found in this branch');
  }
  if (!isFarmProduct(farm)) {
    throw httpError(400, 'Selected product is not a farm animal');
  }
  const farmStock = roundFarmHeads(farm.stock);
  if (farmStock + 0.0001 < share) {
    throw httpError(
      400,
      `Not enough live animals in farm stock (have ${farmStock}, need ${share}). Add heads on the product first.`
    );
  }

  await ensureDefaultTemplates();
  let template = null;
  if (req.body.templateId && mongoose.Types.ObjectId.isValid(String(req.body.templateId))) {
    template = await q(SlaughterTemplate.findById(req.body.templateId), session);
  }
  if (!template && farm.catalogKey) {
    template = await q(SlaughterTemplate.findOne({ farmSkuKey: farm.catalogKey }), session);
  }
  if (!template) {
    throw httpError(400, 'Slaughter template not found for this animal');
  }

  const rawOutputs = Array.isArray(req.body.outputs) ? req.body.outputs : [];
  /** @type {{ product: any, qty: number, kind: string, skuKey: string }[]} */
  const pendingOutputs = [];
  for (const row of rawOutputs) {
    const qty = roundWeight(Number(row.quantity) || 0);
    if (qty <= 0) continue;
    const skuKey = String(row.skuKey || '').trim();
    let product = null;
    if (row.productId && mongoose.Types.ObjectId.isValid(String(row.productId))) {
      product = await q(Product.findById(row.productId), session);
    }
    if (!product && skuKey) {
      product = await q(Product.findOne({ catalogKey: skuKey, branch: branchId }), session);
    }
    if (!product) {
      throw httpError(400, `Output product not found (${skuKey || row.productId})`);
    }
    if (String(product.branch) !== String(branchId)) {
      throw httpError(400, `Output ${product.name} is not in this branch`);
    }
    const kind = ['fridge', 'offal', 'waste'].includes(row.kind) ? row.kind : 'offal';
    pendingOutputs.push({ product, qty, kind, skuKey: product.catalogKey || skuKey });
  }

  if (!pendingOutputs.length) {
    throw httpError(400, 'At least one output quantity is required');
  }

  const outputsTotalKg = roundWeight(pendingOutputs.reduce((s, o) => s + o.qty, 0));
  const { farmCostTotal, costPerKg } = allocateSlaughterCost({
    farmNetPricePerHead: farm.netPrice,
    share,
    outputLines: pendingOutputs.map((o) => ({ kind: o.kind, quantity: o.qty })),
  });

  const outputLines = [];
  for (const row of pendingOutputs) {
    const oldStock = roundWeight(Number(row.product.stock || 0));
    const oldCost = Number(row.product.netPrice || 0);
    const unitCost = row.kind === 'waste' ? 0 : costPerKg;
    row.product.stock = roundWeight(oldStock + row.qty);
    row.product.netPrice = weightedAverageUnitCost(oldStock, oldCost, row.qty, unitCost);
    await row.product.save(session ? { session } : undefined);
    outputLines.push({
      productId: row.product._id,
      skuKey: row.skuKey,
      name: row.product.name,
      kind: row.kind,
      quantity: row.qty,
      unitCost,
    });
  }

  farm.stock = roundFarmHeads(farmStock - share);
  await farm.save(session ? { session } : undefined);

  const liveWeightKg = roundWeight(Number(req.body.liveWeightKg) || 0);
  const wasteKg = resolveWasteKg(req.body, liveWeightKg, outputsTotalKg);

  const createOpts = session ? { session, ordered: true } : undefined;
  const ticketDocs = await SlaughterTicket.create(
    [
      {
        branch: branchId,
        farmProductId: farm._id,
        farmProductName: farm.name,
        templateId: template._id,
        templateCode: template.code,
        share,
        liveWeightKg,
        wasteKg,
        farmCostTotal,
        costPerKg,
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
        productId: farm._id,
        productName: farm.name,
        branchId,
        quantity: share,
        notes: `Slaughter consume ${share} head (cost ${farmCostTotal})`,
        referenceType: 'SlaughterTicket',
        referenceId: ticket._id,
      },
      ...outputLines.map((line) => ({
        movementType: 'production',
        productId: line.productId,
        productName: line.name,
        branchId,
        quantity: line.quantity,
        notes: `Slaughter yield ${line.kind} @ ${line.unitCost}/kg`,
        referenceType: 'SlaughterTicket',
        referenceId: ticket._id,
      })),
    ],
    createOpts
  );

  await auditLog(req, {
    action: 'create',
    module: 'slaughter',
    entityType: 'SlaughterTicket',
    entityId: ticket._id,
    message: `Slaughter ${farm.name} share ${share}, cost/kg ${costPerKg}`,
    after: { share, outputs: outputLines.length, farmCostTotal, costPerKg },
  });

  return SlaughterTicket.findById(ticket._id)
    .populate('branch', 'name')
    .populate('farmProductId', 'name code catalogKey stock netPrice')
    .lean();
}

export const createTicket = async (req, res) => {
  let session = null;
  try {
    session = await mongoose.startSession();
    session.startTransaction();
    const populated = await persistSlaughterTicket(req, session);
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
        const populated = await persistSlaughterTicket(req, null);
        return res.status(201).json({ ticket: populated });
      } catch (e2) {
        return res.status(e2.status || 500).json({ error: e2.message || 'Failed to create slaughter ticket' });
      }
    }
    return res.status(e.status || 500).json({ error: e.message || 'Failed to create slaughter ticket' });
  }
};
