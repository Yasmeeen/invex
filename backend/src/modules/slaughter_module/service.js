import mongoose from 'mongoose';
import Product from '../../DB/models/product.model.js';
import Branch from '../../DB/models/branch.model.js';
import Category from '../../DB/models/category.model.js';
import User from '../../DB/models/user.model.js';
import StockMovement from '../../DB/models/stockMovement.model.js';
import SlaughterTemplate from '../../DB/models/slaughterTemplate.model.js';
import SlaughterTicket from '../../DB/models/slaughterTicket.model.js';
import {
  AL_RAJI_CATEGORIES,
  AL_RAJI_SLAUGHTER_TEMPLATES,
} from '../../../scripts/alRajiCatalogData.js';
import { scaleCodeForSku } from '../../../scripts/alRajiScaleCodes.js';
import {
  isFarmProduct,
  isServiceProduct,
  isValidSlaughterShare,
  normalizeProductType,
  roundFarmHeads,
} from '../../utils/product-type.util.js';
import { roundWeight } from '../../utils/sale-quantity.util.js';
import { butcherFeaturesEnabled } from '../../utils/business-activity.util.js';
import { auditLog } from '../audit_module/audit.service.js';
import StoreSettings from '../../DB/models/storeSettings.model.js';
import {
  allocateSlaughterCost,
  weightedAverageUnitCost,
} from '../../utils/slaughter-cost.util.js';

const ADMIN_ROLES = ['Super Admin', 'Co Admin', 'Admin'];
const STAFF_ROLES = [...ADMIN_ROLES, 'Branch Manager', 'Warehouse', 'Operation Manager'];
const WAREHOUSE_ROLES = [...ADMIN_ROLES, 'Warehouse', 'Operation Manager'];

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

function actorMayUseWarehouse(actor) {
  return actor && WAREHOUSE_ROLES.includes(actor.role);
}

function parseBool(v) {
  return v === true || v === 'true' || v === 1 || v === '1';
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

function productInWarehouse(product) {
  return !!(product && product.inWarehouse);
}

export async function ensureDefaultTemplates() {
  for (const t of AL_RAJI_SLAUGHTER_TEMPLATES) {
    await SlaughterTemplate.findOneAndUpdate(
      { code: t.code },
      {
        $set: {
          name: t.name,
          farmSkuKey: t.farmSkuKey,
          outputs: t.outputs,
        },
        $setOnInsert: { code: t.code },
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
    const warehouseOnly = parseBool(req.query.inWarehouse) || parseBool(req.query.warehouse_only);

    if (warehouseOnly) {
      if (!actorMayUseWarehouse(actor)) {
        return res.status(403).json({ error: 'Cannot view warehouse slaughter tickets' });
      }
      filter.inWarehouse = true;
    } else if (req.query.branch_id && mongoose.Types.ObjectId.isValid(String(req.query.branch_id))) {
      filter.branch = req.query.branch_id;
      filter.inWarehouse = { $ne: true };
    } else if (!ADMIN_ROLES.includes(actor.role)) {
      if (actorMayUseWarehouse(actor) && !actor.branch) {
        filter.inWarehouse = true;
      } else if (actor.branch) {
        filter.branch = actor.branch;
        filter.inWarehouse = { $ne: true };
      }
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

function kindFromTemplate(template, skuKey) {
  if (!template || !skuKey) return null;
  const row = (template.outputs || []).find((o) => String(o.skuKey) === String(skuKey));
  return row && ['fridge', 'offal', 'waste'].includes(row.kind) ? row.kind : null;
}

function locationProductFilter(inWarehouse, branchId) {
  const noFactory = [{ factory: null }, { factory: { $exists: false } }];
  if (inWarehouse) {
    return {
      inWarehouse: true,
      branch: null,
      $or: noFactory,
    };
  }
  return {
    branch: branchId,
    inWarehouse: { $ne: true },
    $or: noFactory,
  };
}

function productAtLocation(product, inWarehouse, branchId) {
  if (!product) return false;
  if (product.factory) return false;
  if (inWarehouse) return productInWarehouse(product);
  return String(product.branch) === String(branchId) && !product.inWarehouse;
}

/** Clone a goods product into the slaughter location (stock 0). */
async function cloneProductToLocation(source, { inWarehouse, branchId }, session) {
  const doc = {
    name: source.name,
    code: source.code,
    price: source.price,
    netPrice: source.netPrice ?? null,
    stock: 0,
    discount: source.discount || 0,
    category: source.category,
    productType: normalizeProductType(source.productType),
    catalogKey: source.catalogKey || '',
    sellByWeightOverride: source.sellByWeightOverride,
    processingExtraCost: source.processingExtraCost || 0,
    branch: inWarehouse ? null : branchId,
    inWarehouse: !!inWarehouse,
    factory: null,
    sourceProductId: null,
  };
  const created = await Product.create([doc], session ? { session } : undefined);
  return Array.isArray(created) ? created[0] : created;
}

/**
 * Resolve output product to one that exists at the slaughter location.
 * If the picked product is on another branch, reuse local catalogKey or clone it.
 */
async function resolveOutputProductAtLocation(product, { inWarehouse, branchId }, session) {
  if (!product) return null;
  if (isFarmProduct(product) || isServiceProduct(product)) {
    throw httpError(400, `Output ${product.name} must be a goods product`);
  }
  if (productAtLocation(product, inWarehouse, branchId)) {
    return product;
  }
  const skuKey = String(product.catalogKey || '').trim();
  if (skuKey) {
    const localQuery = inWarehouse
      ? { catalogKey: skuKey, inWarehouse: true, branch: null }
      : { catalogKey: skuKey, branch: branchId, inWarehouse: { $ne: true } };
    let local = await q(Product.findOne(localQuery), session);
    if (local && !local.factory) return local;
  }
  return cloneProductToLocation(product, { inWarehouse, branchId }, session);
}

function isEligibleSlaughterOutput(product) {
  if (!product) return false;
  if (isFarmProduct(product) || isServiceProduct(product)) return false;
  const key = String(product.catalogKey || '');
  if (key.startsWith('farm_') || key.startsWith('svc_')) return false;
  return true;
}

function catalogDefsBySkuKey() {
  const map = new Map();
  for (const cat of AL_RAJI_CATEGORIES) {
    if (cat.code === 'FARM' || cat.code === 'SERV') continue;
    for (const p of cat.products || []) {
      if (!p?.skuKey) continue;
      map.set(String(p.skuKey), { def: p, categoryCode: cat.code });
    }
  }
  return map;
}

function slaughterOutputSkuKeys() {
  const keys = new Set();
  for (const t of AL_RAJI_SLAUGHTER_TEMPLATES) {
    for (const o of t.outputs || []) {
      if (o?.skuKey) keys.add(String(o.skuKey));
    }
  }
  for (const cat of AL_RAJI_CATEGORIES) {
    if (cat.code !== 'OFFAL') continue;
    for (const p of cat.products || []) {
      if (p?.skuKey) keys.add(String(p.skuKey));
    }
  }
  for (const cat of AL_RAJI_CATEGORIES) {
    for (const p of cat.products || []) {
      if (p?.isSource && p.skuKey) keys.add(String(p.skuKey));
    }
  }
  return keys;
}

/** Create missing fridge/offal SKUs at the slaughter location from catalog defs. */
async function ensureSlaughterCatalogOutputsAtLocation({ inWarehouse, branchId }) {
  const needed = slaughterOutputSkuKeys();
  if (!needed.size) return;

  const localFilter = locationProductFilter(inWarehouse, branchId);
  const existing = await Product.find({
    ...localFilter,
    catalogKey: { $in: [...needed] },
  })
    .select('catalogKey')
    .lean();
  const have = new Set(existing.map((p) => String(p.catalogKey)));
  const missing = [...needed].filter((k) => !have.has(k));
  if (!missing.length) return;

  const defs = catalogDefsBySkuKey();
  const categoryCache = new Map();
  for (const skuKey of missing) {
    const row = defs.get(skuKey);
    if (!row) continue;
    let categoryId = categoryCache.get(row.categoryCode);
    if (!categoryId) {
      const cat = await Category.findOne({ code: row.categoryCode }).select('_id').lean();
      if (!cat) continue;
      categoryId = cat._id;
      categoryCache.set(row.categoryCode, categoryId);
    }
    const scaleCode = scaleCodeForSku(skuKey);
    const code =
      scaleCode || `${row.categoryCode}-${String(skuKey).replace(/_/g, '-')}`.slice(0, 40);
    try {
      await Product.create({
        name: row.def.name,
        code,
        price: row.def.price,
        netPrice: row.def.netPrice ?? null,
        stock: 0,
        discount: 0,
        category: categoryId,
        productType: normalizeProductType(row.def.productType),
        catalogKey: skuKey,
        ...(row.def.sellByWeightOverride !== undefined
          ? { sellByWeightOverride: row.def.sellByWeightOverride }
          : {}),
        branch: inWarehouse ? null : branchId,
        inWarehouse: !!inWarehouse,
        factory: null,
        sourceProductId: null,
      });
    } catch {
      // Unique code race / already exists — ignore and continue.
    }
  }
}

/**
 * Goods products the user may pick as slaughter yields.
 * Prefers SKUs at the slaughter location; also includes catalog goods from other
 * locations (deduped by catalogKey) so the list is not stuck on e.g. كندوز ثلاجة only.
 */
export const listOutputProducts = async (req, res) => {
  try {
    await assertSlaughterActivityEnabled();
    const actor = await loadActor(req.query.userId);
    if (!canUse(actor)) {
      return res.status(403).json({ error: 'Not allowed' });
    }

    const inWarehouse = parseBool(req.query.inWarehouse) || parseBool(req.query.warehouse_only);
    let branchId = null;
    if (inWarehouse) {
      if (!actorMayUseWarehouse(actor)) {
        return res.status(403).json({ error: 'Cannot view warehouse slaughter products' });
      }
    } else {
      branchId = req.query.branchId || req.query.branch_id;
      if (!branchId || !mongoose.Types.ObjectId.isValid(String(branchId))) {
        return res.status(400).json({ error: 'Valid branch is required (or set inWarehouse)' });
      }
      if (!actorMayUseBranch(actor, String(branchId))) {
        return res.status(403).json({ error: 'Cannot view slaughter products for this branch' });
      }
    }

    await ensureSlaughterCatalogOutputsAtLocation({ inWarehouse, branchId });

    const localFilter = locationProductFilter(inWarehouse, branchId);
    const [localRows, companyRows] = await Promise.all([
      Product.find(localFilter)
        .select('name code catalogKey productType stock category branch inWarehouse')
        .populate('category', 'code name')
        .lean(),
      Product.find({
        productType: { $nin: ['farm', 'service'] },
        $or: [{ factory: null }, { factory: { $exists: false } }],
      })
        .select('name code catalogKey productType stock category branch inWarehouse')
        .populate('category', 'code name')
        .limit(2000)
        .lean(),
    ]);

    const byKey = new Map();
    const noKey = [];

    const consider = (p, preferLocal) => {
      if (!isEligibleSlaughterOutput(p)) return;
      const key = String(p.catalogKey || '').trim();
      if (!key) {
        if (productAtLocation(p, inWarehouse, branchId)) {
          noKey.push(p);
        }
        return;
      }
      const existing = byKey.get(key);
      const isLocal = productAtLocation(p, inWarehouse, branchId);
      if (!existing) {
        byKey.set(key, p);
        return;
      }
      if (preferLocal && isLocal && !productAtLocation(existing, inWarehouse, branchId)) {
        byKey.set(key, p);
      }
    };

    for (const p of localRows) consider(p, true);
    for (const p of companyRows) consider(p, true);

    const products = [...byKey.values(), ...noKey]
      .map((p) => ({ ...p, _id: String(p._id) }))
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ar'));

    return res.json({ products });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || 'Failed to list output products' });
  }
};

async function persistSlaughterTicket(req, session) {
  await assertSlaughterActivityEnabled();
  const actor = await loadActor(req.body.userId);
  if (!canUse(actor)) throw httpError(403, 'Not allowed');

  const inWarehouse = parseBool(req.body.inWarehouse);
  let branchId = null;

  if (inWarehouse) {
    if (!actorMayUseWarehouse(actor)) {
      throw httpError(403, 'Cannot slaughter in warehouse');
    }
  } else {
    branchId = req.body.branchId || req.body.branch;
    if (!branchId || !mongoose.Types.ObjectId.isValid(String(branchId))) {
      throw httpError(400, 'Valid branch is required (or set inWarehouse)');
    }
    if (!actorMayUseBranch(actor, String(branchId))) {
      throw httpError(403, 'Cannot slaughter for this branch');
    }
    const branch = await q(Branch.findById(branchId), session);
    if (!branch) throw httpError(400, 'Branch not found');
  }

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
  if (!farm) {
    throw httpError(400, 'Farm animal not found');
  }
  if (inWarehouse) {
    if (!productInWarehouse(farm)) {
      throw httpError(400, 'Farm animal not found in warehouse');
    }
  } else if (String(farm.branch) !== String(branchId) || farm.inWarehouse) {
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

  const rawOutputs = Array.isArray(req.body.outputs) ? req.body.outputs : [];
  /** @type {{ product: any, qty: number, kind: string, skuKey: string }[]} */
  const pendingOutputs = [];
  const seenProductIds = new Set();

  for (const row of rawOutputs) {
    const qty = roundWeight(Number(row.quantity) || 0);
    if (qty <= 0) continue;
    const skuKey = String(row.skuKey || '').trim();
    let product = null;
    if (row.productId && mongoose.Types.ObjectId.isValid(String(row.productId))) {
      product = await q(Product.findById(row.productId).populate('category', 'code'), session);
    }
    if (!product && skuKey) {
      if (inWarehouse) {
        product = await q(
          Product.findOne({ catalogKey: skuKey, inWarehouse: true, branch: null }).populate(
            'category',
            'code'
          ),
          session
        );
      } else {
        product = await q(
          Product.findOne({ catalogKey: skuKey, branch: branchId }).populate('category', 'code'),
          session
        );
      }
      if (!product) {
        product = await q(
          Product.findOne({ catalogKey: skuKey }).populate('category', 'code'),
          session
        );
      }
    }
    if (!product) {
      throw httpError(400, `Output product not found (${skuKey || row.productId})`);
    }
    product = await resolveOutputProductAtLocation(product, { inWarehouse, branchId }, session);
    const pid = String(product._id);
    if (seenProductIds.has(pid)) {
      throw httpError(400, `Duplicate output product: ${product.name}`);
    }
    seenProductIds.add(pid);

    let kind = ['fridge', 'offal', 'waste'].includes(row.kind) ? row.kind : null;
    if (!kind) {
      kind = kindFromTemplate(template, product.catalogKey || skuKey) || 'offal';
    }
    pendingOutputs.push({
      product,
      qty,
      kind,
      skuKey: product.catalogKey || skuKey,
    });
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

  const locationLabel = inWarehouse ? 'warehouse' : 'branch';
  const createOpts = session ? { session, ordered: true } : undefined;
  const ticketDocs = await SlaughterTicket.create(
    [
      {
        branch: inWarehouse ? null : branchId,
        inWarehouse,
        farmProductId: farm._id,
        farmProductName: farm.name,
        templateId: template?._id || null,
        templateCode: template?.code || '',
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
        branchId: inWarehouse ? null : branchId,
        quantity: share,
        notes: `Slaughter consume ${share} head (${locationLabel}, cost ${farmCostTotal})`,
        referenceType: 'SlaughterTicket',
        referenceId: ticket._id,
      },
      ...outputLines.map((line) => ({
        movementType: 'production',
        productId: line.productId,
        productName: line.name,
        branchId: inWarehouse ? null : branchId,
        quantity: line.quantity,
        notes: `Slaughter yield ${line.kind} @ ${line.unitCost}/kg (${locationLabel})`,
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
    message: `Slaughter ${farm.name} share ${share} (${locationLabel}), cost/kg ${costPerKg}`,
    after: { share, outputs: outputLines.length, farmCostTotal, costPerKg, inWarehouse },
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
