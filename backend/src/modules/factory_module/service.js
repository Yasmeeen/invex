import mongoose from 'mongoose';
import Factory from '../../DB/models/factory.model.js';
import Product from '../../DB/models/product.model.js';
import Branch from '../../DB/models/branch.model.js';
import User from '../../DB/models/user.model.js';
import Client from '../../DB/models/client.model.js';
import Vendor from '../../DB/models/vendor.model.js';
import StockMovement from '../../DB/models/stockMovement.model.js';
import ManufacturingRecipe from '../../DB/models/manufacturingRecipe.model.js';
import ManufacturingOrder from '../../DB/models/manufacturingOrder.model.js';
import FactoryStockTransfer from '../../DB/models/factoryStockTransfer.model.js';
import FactorySale from '../../DB/models/factorySale.model.js';
import { roundWeight } from '../../utils/sale-quantity.util.js';
import { roundMoney, weightedAverageUnitCost } from '../../utils/slaughter-cost.util.js';
import { auditLog } from '../audit_module/audit.service.js';

const ADMIN_ROLES = ['Super Admin', 'Co Admin', 'Admin'];
const STAFF_ROLES = [...ADMIN_ROLES, 'Warehouse', 'Operation Manager', 'Branch Manager'];

function loadActor(userId) {
  if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) return null;
  return User.findById(userId).select('role branch name').lean();
}

function canUse(actor) {
  return actor && STAFF_ROLES.includes(actor.role);
}

function canManageFactories(actor) {
  return actor && ADMIN_ROLES.includes(actor.role);
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function oid(id) {
  return new mongoose.Types.ObjectId(String(id));
}

function availableStock(product) {
  const stock = Number(product?.stock) || 0;
  const reserved = Number(product?.transferReservedQuantity) || 0;
  const booked = Number(product?.bookedQuantity) || 0;
  const ecom = Number(product?.ecommerceReservedQuantity) || 0;
  return Math.max(0, stock - reserved - booked - ecom);
}

async function requireFactory(factoryId, session) {
  if (!factoryId || !mongoose.Types.ObjectId.isValid(String(factoryId))) {
    throw httpError(400, 'factoryId is required');
  }
  const q = Factory.findById(factoryId);
  if (session) q.session(session);
  const factory = await q;
  if (!factory) throw httpError(404, 'Factory not found');
  if (!factory.isActive) throw httpError(400, 'Factory is inactive');
  return factory;
}

function factoryProductFilter(factoryId) {
  return {
    factory: oid(factoryId),
    inWarehouse: { $ne: true },
    $or: [{ branch: null }, { branch: { $exists: false } }],
  };
}

async function findFactoryProductByCode(factoryId, code, session) {
  const filter = { ...factoryProductFilter(factoryId), code: String(code || '').trim() };
  let q = Product.findOne(filter).populate('category', 'name code sellByWeight');
  if (session) q = q.session(session);
  return q;
}

async function resolveOrCreateFactoryProduct(session, template, factoryId, { unitCost } = {}) {
  const code = String(template.code || '').trim();
  const categoryId = template.category?._id || template.category;
  if (!code || !categoryId) {
    return { error: 'Template product is missing code or category' };
  }

  let target = await findFactoryProductByCode(factoryId, code, session);
  if (target) return { product: target };

  const [created] = await Product.create(
    [
      {
        name: String(template.name || '').trim(),
        code,
        price: Number(template.price) || 0,
        netPrice: unitCost != null ? Number(unitCost) : template.netPrice != null ? Number(template.netPrice) : 0,
        discount: Number(template.discount) || 0,
        stock: 0,
        category: oid(categoryId),
        branch: null,
        inWarehouse: false,
        factory: oid(factoryId),
        imageUrl: String(template.imageUrl || '').trim(),
        attributes:
          template.attributes && typeof template.attributes === 'object' && !Array.isArray(template.attributes)
            ? template.attributes
            : {},
        productType: template.productType || 'good',
        sellByWeightOverride: template.sellByWeightOverride,
        processingExtraCost: Number(template.processingExtraCost) || 0,
        catalogKey: String(template.catalogKey || '').trim(),
      },
    ],
    { session }
  );
  const populated = await Product.findById(created._id)
    .populate('category', 'name code sellByWeight')
    .session(session);
  return { product: populated, created: true };
}

function cloneProductFields(source) {
  return {
    name: source.name,
    code: source.code,
    price: source.price,
    netPrice: source.netPrice,
    discount: source.discount || 0,
    category: source.category,
    addedBy: source.addedBy || '',
    listedOnEcommerce: Boolean(source.listedOnEcommerce),
    ecommerceDescription: String(source.ecommerceDescription || ''),
    ecommerceShortDescription: String(source.ecommerceShortDescription || ''),
    ecommerceIsFeatured: Boolean(source.ecommerceIsFeatured),
    productType: source.productType || 'good',
    sellByWeightOverride: source.sellByWeightOverride,
    processingExtraCost: Number(source.processingExtraCost) || 0,
    catalogKey: String(source.catalogKey || '').trim(),
    imageUrl: String(source.imageUrl || '').trim(),
    ...(source.acquiredFrom ? { acquiredFrom: source.acquiredFrom } : {}),
  };
}

// ─── Factories CRUD ─────────────────────────────────────────────

export const listFactories = async (req, res) => {
  try {
    const actor = await loadActor(req.query.userId);
    if (!canUse(actor)) return res.status(403).json({ error: 'Not allowed' });
    const activeOnly = String(req.query.activeOnly || 'true') !== 'false';
    const filter = activeOnly ? { isActive: true } : {};
    const factories = await Factory.find(filter).sort({ name: 1 }).lean();
    return res.json({ factories });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || 'Failed to list factories' });
  }
};

export const getFactory = async (req, res) => {
  try {
    const actor = await loadActor(req.query.userId);
    if (!canUse(actor)) return res.status(403).json({ error: 'Not allowed' });
    const factory = await Factory.findById(req.params.id).lean();
    if (!factory) return res.status(404).json({ error: 'Factory not found' });
    return res.json({ factory });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || 'Failed to load factory' });
  }
};

export const createFactory = async (req, res) => {
  try {
    const actor = await loadActor(req.body.userId);
    if (!canManageFactories(actor)) return res.status(403).json({ error: 'Not allowed' });
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name is required' });
    const factory = await Factory.create({
      name,
      address: String(req.body.address || '').trim(),
      notes: String(req.body.notes || '').trim(),
      isActive: req.body.isActive !== false,
    });
    await auditLog(req, {
      action: 'create',
      module: 'factory',
      entityType: 'Factory',
      entityId: factory._id,
      message: `Factory created: ${name}`,
    });
    return res.status(201).json({ factory });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || 'Failed to create factory' });
  }
};

export const updateFactory = async (req, res) => {
  try {
    const actor = await loadActor(req.body.userId);
    if (!canManageFactories(actor)) return res.status(403).json({ error: 'Not allowed' });
    const factory = await Factory.findById(req.params.id);
    if (!factory) return res.status(404).json({ error: 'Factory not found' });
    if (req.body.name != null) factory.name = String(req.body.name).trim();
    if (req.body.address != null) factory.address = String(req.body.address).trim();
    if (req.body.notes != null) factory.notes = String(req.body.notes).trim();
    if (req.body.isActive != null) factory.isActive = !!req.body.isActive;
    if (!factory.name) return res.status(400).json({ error: 'name is required' });
    await factory.save();
    await auditLog(req, {
      action: 'update',
      module: 'factory',
      entityType: 'Factory',
      entityId: factory._id,
      message: `Factory updated: ${factory.name}`,
    });
    return res.json({ factory });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || 'Failed to update factory' });
  }
};

export const listFactoryStock = async (req, res) => {
  try {
    const actor = await loadActor(req.query.userId);
    if (!canUse(actor)) return res.status(403).json({ error: 'Not allowed' });
    await requireFactory(req.params.id);
    const search = String(req.query.search || '').trim();
    const filter = factoryProductFilter(req.params.id);
    if (search) {
      filter.$and = [
        {
          $or: [
            { name: { $regex: search, $options: 'i' } },
            { code: { $regex: search, $options: 'i' } },
          ],
        },
      ];
    }
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const [products, total] = await Promise.all([
      Product.find(filter)
        .populate('category', 'name code sellByWeight weightUnit')
        .sort({ name: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Product.countDocuments(filter),
    ]);
    return res.json({
      products,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
    });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || 'Failed to list factory stock' });
  }
};

// ─── Recipes ────────────────────────────────────────────────────

export const listRecipes = async (req, res) => {
  try {
    const actor = await loadActor(req.query.userId);
    if (!canUse(actor)) return res.status(403).json({ error: 'Not allowed' });
    const filter = {};
    if (String(req.query.activeOnly || 'true') !== 'false') filter.isActive = true;
    if (req.query.outputProductCode) {
      filter.outputProductCode = String(req.query.outputProductCode).trim();
    }
    const recipes = await ManufacturingRecipe.find(filter).sort({ outputName: 1 }).lean();
    return res.json({ recipes });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || 'Failed to list recipes' });
  }
};

export const getRecipe = async (req, res) => {
  try {
    const actor = await loadActor(req.query.userId);
    if (!canUse(actor)) return res.status(403).json({ error: 'Not allowed' });
    const recipe = await ManufacturingRecipe.findById(req.params.id).lean();
    if (!recipe) return res.status(404).json({ error: 'Recipe not found' });
    return res.json({ recipe });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || 'Failed to load recipe' });
  }
};

function normalizeRecipeLines(linesRaw) {
  const lines = Array.isArray(linesRaw) ? linesRaw : [];
  return lines
    .map((l) => ({
      ingredientProductCode: String(l.ingredientProductCode || l.code || '').trim(),
      ingredientCatalogKey: String(l.ingredientCatalogKey || '').trim(),
      name: String(l.name || '').trim(),
      defaultQtyPerOutputUnit: Math.max(0, Number(l.defaultQtyPerOutputUnit) || 0),
    }))
    .filter((l) => l.ingredientProductCode && l.defaultQtyPerOutputUnit > 0);
}

export const createRecipe = async (req, res) => {
  try {
    const actor = await loadActor(req.body.userId);
    if (!canManageFactories(actor) && !canUse(actor)) {
      return res.status(403).json({ error: 'Not allowed' });
    }
    const outputProductCode = String(req.body.outputProductCode || '').trim();
    const outputName = String(req.body.outputName || '').trim();
    if (!outputProductCode || !outputName) {
      return res.status(400).json({ error: 'outputProductCode and outputName are required' });
    }
    const lines = normalizeRecipeLines(req.body.lines);
    if (!lines.length) return res.status(400).json({ error: 'At least one recipe line is required' });
    const recipe = await ManufacturingRecipe.create({
      outputProductCode,
      outputCatalogKey: String(req.body.outputCatalogKey || '').trim(),
      outputName,
      outputUnit: req.body.outputUnit === 'unit' ? 'unit' : 'kg',
      lines,
      notes: String(req.body.notes || '').trim(),
      isActive: req.body.isActive !== false,
      createdBy: actor?._id || null,
    });
    return res.status(201).json({ recipe });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || 'Failed to create recipe' });
  }
};

export const updateRecipe = async (req, res) => {
  try {
    const actor = await loadActor(req.body.userId);
    if (!canManageFactories(actor) && !canUse(actor)) {
      return res.status(403).json({ error: 'Not allowed' });
    }
    const recipe = await ManufacturingRecipe.findById(req.params.id);
    if (!recipe) return res.status(404).json({ error: 'Recipe not found' });
    if (req.body.outputProductCode != null) {
      recipe.outputProductCode = String(req.body.outputProductCode).trim();
    }
    if (req.body.outputName != null) recipe.outputName = String(req.body.outputName).trim();
    if (req.body.outputCatalogKey != null) {
      recipe.outputCatalogKey = String(req.body.outputCatalogKey).trim();
    }
    if (req.body.outputUnit != null) {
      recipe.outputUnit = req.body.outputUnit === 'unit' ? 'unit' : 'kg';
    }
    if (req.body.lines != null) {
      const lines = normalizeRecipeLines(req.body.lines);
      if (!lines.length) return res.status(400).json({ error: 'At least one recipe line is required' });
      recipe.lines = lines;
    }
    if (req.body.notes != null) recipe.notes = String(req.body.notes).trim();
    if (req.body.isActive != null) recipe.isActive = !!req.body.isActive;
    await recipe.save();
    return res.json({ recipe });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || 'Failed to update recipe' });
  }
};

// ─── Manufacturing orders ───────────────────────────────────────

export const listManufacturingOrders = async (req, res) => {
  try {
    const actor = await loadActor(req.query.userId);
    if (!canUse(actor)) return res.status(403).json({ error: 'Not allowed' });
    const filter = {};
    if (req.query.factoryId && mongoose.Types.ObjectId.isValid(String(req.query.factoryId))) {
      filter.factory = req.query.factoryId;
    }
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const [orders, total] = await Promise.all([
      ManufacturingOrder.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('factory', 'name')
        .populate('outputProductId', 'name code stock netPrice')
        .populate('recipeId', 'outputName outputProductCode')
        .populate('createdBy', 'name')
        .lean(),
      ManufacturingOrder.countDocuments(filter),
    ]);
    return res.json({
      orders,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
    });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || 'Failed to list manufacturing orders' });
  }
};

export const getManufacturingOrder = async (req, res) => {
  try {
    const actor = await loadActor(req.query.userId);
    if (!canUse(actor)) return res.status(403).json({ error: 'Not allowed' });
    const order = await ManufacturingOrder.findById(req.params.id)
      .populate('factory', 'name')
      .populate('outputProductId', 'name code stock netPrice')
      .populate('ingredients.productId', 'name code stock netPrice')
      .populate('recipeId', 'outputName outputProductCode lines')
      .populate('createdBy', 'name')
      .lean();
    if (!order) return res.status(404).json({ error: 'Manufacturing order not found' });
    return res.json({ order });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || 'Failed to load manufacturing order' });
  }
};

export const createManufacturingOrder = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const actor = await loadActor(req.body.userId);
    if (!canUse(actor)) throw httpError(403, 'Not allowed');

    const factory = await requireFactory(req.body.factoryId, session);
    const outputQtyRaw = Number(req.body.outputQty);
    if (!Number.isFinite(outputQtyRaw) || outputQtyRaw <= 0) {
      throw httpError(400, 'outputQty must be > 0');
    }
    const outputQty = roundWeight(outputQtyRaw);
    const wasteQty = Math.max(0, Number(req.body.wasteQty) || 0);

    let outputProduct = null;
    const outputProductId = req.body.outputProductId;
    if (outputProductId && mongoose.Types.ObjectId.isValid(String(outputProductId))) {
      outputProduct = await Product.findById(outputProductId).session(session);
      if (!outputProduct) throw httpError(404, 'Output product not found');
      if (String(outputProduct.factory) !== String(factory._id)) {
        throw httpError(400, 'Output product is not in this factory');
      }
    } else {
      const code = String(req.body.outputProductCode || '').trim();
      const name = String(req.body.outputProductName || '').trim();
      const categoryId = req.body.outputCategoryId;
      if (!code || !name || !categoryId) {
        throw httpError(400, 'outputProductId or (outputProductCode, outputProductName, outputCategoryId) required');
      }
      const resolved = await resolveOrCreateFactoryProduct(
        session,
        {
          code,
          name,
          category: categoryId,
          price: Number(req.body.outputPrice) || 0,
          netPrice: 0,
        },
        factory._id
      );
      if (resolved.error) throw httpError(400, resolved.error);
      outputProduct = resolved.product;
    }

    const ingredientsRaw = Array.isArray(req.body.ingredients) ? req.body.ingredients : [];
    if (!ingredientsRaw.length) throw httpError(400, 'At least one ingredient is required');

    const ingredientLines = [];
    let totalIngredientCost = 0;

    for (const row of ingredientsRaw) {
      const productId = row.productId;
      const qty = roundWeight(Number(row.qty) || 0);
      if (!productId || !mongoose.Types.ObjectId.isValid(String(productId))) {
        throw httpError(400, 'Each ingredient needs a valid productId');
      }
      if (qty <= 0) throw httpError(400, 'Ingredient quantity must be > 0');

      const ing = await Product.findById(productId).session(session);
      if (!ing) throw httpError(404, `Ingredient product not found: ${productId}`);
      if (String(ing.factory) !== String(factory._id)) {
        throw httpError(400, `Ingredient ${ing.code} is not in this factory`);
      }
      if (String(ing._id) === String(outputProduct._id)) {
        throw httpError(400, 'Output product cannot be used as its own ingredient');
      }
      const avail = availableStock(ing);
      if (avail < qty) {
        throw httpError(400, `Insufficient stock for ${ing.name} (${ing.code}): available ${avail}`);
      }

      const unitCost = roundMoney(Number(ing.netPrice) || 0);
      const lineCost = roundMoney(unitCost * qty);
      totalIngredientCost = roundMoney(totalIngredientCost + lineCost);

      ing.stock = roundWeight(Math.max(0, Number(ing.stock) - qty));
      await ing.save({ session });

      ingredientLines.push({
        productId: ing._id,
        name: ing.name,
        code: ing.code,
        qty,
        unitCost,
        lineCost,
      });

      await StockMovement.create(
        [
          {
            movementType: 'production',
            productId: ing._id,
            productName: ing.name,
            factoryId: factory._id,
            fromFactoryId: factory._id,
            quantity: qty,
            unitPrice: unitCost,
            totalValue: lineCost,
            referenceType: 'manufacturingOrder',
            notes: `Consumed in manufacturing ${outputProduct.code}`,
          },
        ],
        { session }
      );
    }

    const usefulQty = outputQty > 0 ? outputQty : 0;
    const unitCost = usefulQty > 0 ? roundMoney(totalIngredientCost / usefulQty) : 0;

    const oldStock = Number(outputProduct.stock) || 0;
    const oldCost = Number(outputProduct.netPrice) || 0;
    outputProduct.stock = roundWeight(oldStock + outputQty);
    outputProduct.removedWhenOutOfStock = false;
    outputProduct.netPrice = weightedAverageUnitCost(oldStock, oldCost, outputQty, unitCost);
    await outputProduct.save({ session });

    let recipeId = null;
    if (req.body.recipeId && mongoose.Types.ObjectId.isValid(String(req.body.recipeId))) {
      recipeId = req.body.recipeId;
    }

    const [order] = await ManufacturingOrder.create(
      [
        {
          factory: factory._id,
          status: 'completed',
          outputProductId: outputProduct._id,
          outputProductName: outputProduct.name,
          outputProductCode: outputProduct.code,
          outputQty,
          wasteQty,
          recipeId,
          ingredients: ingredientLines,
          totalIngredientCost,
          unitCost,
          notes: String(req.body.notes || '').trim(),
          createdBy: actor?._id || null,
        },
      ],
      { session }
    );

    await StockMovement.create(
      [
        {
          movementType: 'production',
          productId: outputProduct._id,
          productName: outputProduct.name,
          factoryId: factory._id,
          toFactoryId: factory._id,
          quantity: outputQty,
          unitPrice: unitCost,
          totalValue: totalIngredientCost,
          referenceType: 'manufacturingOrder',
          referenceId: order._id,
          notes: 'Manufactured output',
        },
      ],
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    await auditLog(req, {
      action: 'create',
      module: 'factory',
      entityType: 'ManufacturingOrder',
      entityId: order._id,
      message: `Manufactured ${outputQty} of ${outputProduct.code} at factory`,
      metadata: { totalIngredientCost, unitCost, ingredientCount: ingredientLines.length },
    });

    const populated = await ManufacturingOrder.findById(order._id)
      .populate('factory', 'name')
      .populate('outputProductId', 'name code stock netPrice')
      .populate('createdBy', 'name')
      .lean();

    return res.status(201).json({ order: populated });
  } catch (e) {
    await session.abortTransaction();
    session.endSession();
    return res.status(e.status || 500).json({ error: e.message || 'Failed to create manufacturing order' });
  }
};

// ─── Transfers ──────────────────────────────────────────────────

export const listFactoryTransfers = async (req, res) => {
  try {
    const actor = await loadActor(req.query.userId);
    if (!canUse(actor)) return res.status(403).json({ error: 'Not allowed' });
    const filter = {};
    const factoryId = req.query.factoryId;
    if (factoryId && mongoose.Types.ObjectId.isValid(String(factoryId))) {
      filter.$or = [{ fromFactory: factoryId }, { toFactory: factoryId }];
    }
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const [transfers, total] = await Promise.all([
      FactoryStockTransfer.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('fromBranch', 'name')
        .populate('toBranch', 'name')
        .populate('fromFactory', 'name')
        .populate('toFactory', 'name')
        .populate('product', 'name code')
        .populate('destinationProduct', 'name code')
        .populate('createdBy', 'name')
        .lean(),
      FactoryStockTransfer.countDocuments(filter),
    ]);
    return res.json({
      transfers,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
    });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || 'Failed to list transfers' });
  }
};

/**
 * POST body:
 * - direction: 'to_factory' | 'from_factory'
 * - productId, quantity, factoryId
 * - to_factory: fromBranchId OR fromWarehouse=true
 * - from_factory: toBranchId
 */
export const createFactoryTransfer = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const actor = await loadActor(req.body.userId);
    if (!canUse(actor)) throw httpError(403, 'Not allowed');

    const factory = await requireFactory(req.body.factoryId, session);
    const qty = roundWeight(Number(req.body.quantity) || 0);
    if (qty <= 0) throw httpError(400, 'quantity must be > 0');

    const productId = req.body.productId;
    if (!productId || !mongoose.Types.ObjectId.isValid(String(productId))) {
      throw httpError(400, 'productId is required');
    }

    const direction = String(req.body.direction || '').trim();
    const fromWarehouse =
      req.body.fromWarehouse === true ||
      req.body.fromWarehouse === 'true' ||
      String(req.body.fromWarehouse).toLowerCase() === 'true';

    const sourceProduct = await Product.findById(productId).session(session);
    if (!sourceProduct) throw httpError(404, 'Source product not found');

    let destinationProduct = null;
    let transferDoc = null;
    let fromBranch = null;
    let toBranch = null;
    let fromFactory = null;
    let toFactory = null;
    let notes = '';

    if (direction === 'to_factory') {
      // Branch or warehouse → factory
      toFactory = factory._id;
      if (fromWarehouse) {
        if (!sourceProduct.inWarehouse) {
          throw httpError(400, 'Selected product is not in warehouse');
        }
      } else {
        fromBranch = req.body.fromBranchId;
        if (!fromBranch || !mongoose.Types.ObjectId.isValid(String(fromBranch))) {
          throw httpError(400, 'fromBranchId is required');
        }
        if (String(sourceProduct.branch) !== String(fromBranch)) {
          throw httpError(400, 'Source branch does not match product');
        }
        if (sourceProduct.inWarehouse || sourceProduct.factory) {
          throw httpError(400, 'Source product must be a branch product');
        }
        const branch = await Branch.findById(fromBranch).session(session).lean();
        if (!branch) throw httpError(400, 'Branch not found');
      }

      const avail = availableStock(sourceProduct);
      if (avail < qty) throw httpError(400, `Only ${avail} available to transfer`);

      sourceProduct.stock = roundWeight(Math.max(0, Number(sourceProduct.stock) - qty));
      await sourceProduct.save({ session });

      const resolved = await resolveOrCreateFactoryProduct(session, sourceProduct, factory._id, {
        unitCost: Number(sourceProduct.netPrice) || 0,
      });
      if (resolved.error) throw httpError(400, resolved.error);
      destinationProduct = resolved.product;

      const oldStock = Number(destinationProduct.stock) || 0;
      const oldCost = Number(destinationProduct.netPrice) || 0;
      const addCost = Number(sourceProduct.netPrice) || 0;
      destinationProduct.stock = roundWeight(oldStock + qty);
      destinationProduct.removedWhenOutOfStock = false;
      destinationProduct.netPrice = weightedAverageUnitCost(oldStock, oldCost, qty, addCost);
      if (!destinationProduct.acquiredFrom && sourceProduct.acquiredFrom) {
        destinationProduct.acquiredFrom = sourceProduct.acquiredFrom;
      }
      await destinationProduct.save({ session });

      notes = fromWarehouse ? 'Warehouse → Factory' : 'Branch → Factory';
      const [created] = await FactoryStockTransfer.create(
        [
          {
            product: sourceProduct._id,
            productNameSnapshot: sourceProduct.name,
            productCodeSnapshot: sourceProduct.code,
            destinationProduct: destinationProduct._id,
            fromBranch: fromWarehouse ? null : fromBranch,
            fromWarehouse: !!fromWarehouse,
            fromFactory: null,
            toBranch: null,
            toFactory: factory._id,
            quantity: qty,
            unitCost: addCost,
            notes,
            createdBy: actor?._id || null,
          },
        ],
        { session }
      );
      transferDoc = created;

      await StockMovement.create(
        [
          {
            movementType: 'transfer',
            productId: sourceProduct._id,
            productName: sourceProduct.name,
            fromBranchId: fromWarehouse ? null : fromBranch,
            toFactoryId: factory._id,
            factoryId: factory._id,
            quantity: qty,
            unitPrice: addCost,
            totalValue: roundMoney(addCost * qty),
            referenceType: 'factoryStockTransfer',
            referenceId: transferDoc._id,
            notes,
          },
        ],
        { session }
      );
    } else if (direction === 'from_factory') {
      // Factory → branch
      fromFactory = factory._id;
      toBranch = req.body.toBranchId;
      if (!toBranch || !mongoose.Types.ObjectId.isValid(String(toBranch))) {
        throw httpError(400, 'toBranchId is required');
      }
      if (String(sourceProduct.factory) !== String(factory._id)) {
        throw httpError(400, 'Source product is not in this factory');
      }
      const branch = await Branch.findById(toBranch).session(session).lean();
      if (!branch) throw httpError(400, 'Destination branch not found');

      const avail = availableStock(sourceProduct);
      if (avail < qty) throw httpError(400, `Only ${avail} available to transfer`);

      sourceProduct.stock = roundWeight(Math.max(0, Number(sourceProduct.stock) - qty));
      await sourceProduct.save({ session });

      let dest = await Product.findOne({
        code: sourceProduct.code,
        branch: oid(toBranch),
        inWarehouse: { $ne: true },
        $or: [{ factory: null }, { factory: { $exists: false } }],
      }).session(session);

      const unitCost = Number(sourceProduct.netPrice) || 0;
      if (dest) {
        const oldStock = Number(dest.stock) || 0;
        const oldCost = Number(dest.netPrice) || 0;
        dest.stock = roundWeight(oldStock + qty);
        dest.removedWhenOutOfStock = false;
        dest.netPrice = weightedAverageUnitCost(oldStock, oldCost, qty, unitCost);
        if (!dest.acquiredFrom && sourceProduct.acquiredFrom) {
          dest.acquiredFrom = sourceProduct.acquiredFrom;
        }
        await dest.save({ session });
      } else {
        const [created] = await Product.create(
          [
            {
              ...cloneProductFields(sourceProduct),
              stock: qty,
              netPrice: unitCost,
              branch: oid(toBranch),
              inWarehouse: false,
              factory: null,
            },
          ],
          { session }
        );
        dest = created;
      }
      destinationProduct = dest;
      notes = 'Factory → Branch';

      const [created] = await FactoryStockTransfer.create(
        [
          {
            product: sourceProduct._id,
            productNameSnapshot: sourceProduct.name,
            productCodeSnapshot: sourceProduct.code,
            destinationProduct: destinationProduct._id,
            fromBranch: null,
            fromWarehouse: false,
            fromFactory: factory._id,
            toBranch: oid(toBranch),
            toFactory: null,
            quantity: qty,
            unitCost,
            notes,
            createdBy: actor?._id || null,
          },
        ],
        { session }
      );
      transferDoc = created;

      await StockMovement.create(
        [
          {
            movementType: 'transfer',
            productId: sourceProduct._id,
            productName: sourceProduct.name,
            fromFactoryId: factory._id,
            toBranchId: toBranch,
            factoryId: factory._id,
            quantity: qty,
            unitPrice: unitCost,
            totalValue: roundMoney(unitCost * qty),
            referenceType: 'factoryStockTransfer',
            referenceId: transferDoc._id,
            notes,
          },
        ],
        { session }
      );
    } else {
      throw httpError(400, 'direction must be to_factory or from_factory');
    }

    await session.commitTransaction();
    session.endSession();

    const populated = await FactoryStockTransfer.findById(transferDoc._id)
      .populate('fromBranch', 'name')
      .populate('toBranch', 'name')
      .populate('fromFactory', 'name')
      .populate('toFactory', 'name')
      .populate('product', 'name code')
      .populate('destinationProduct', 'name code stock')
      .lean();

    return res.status(201).json({
      transfer: populated,
      sourceProduct,
      destinationProduct,
    });
  } catch (e) {
    await session.abortTransaction();
    session.endSession();
    return res.status(e.status || 500).json({ error: e.message || 'Failed to transfer stock' });
  }
};

// ─── Factory sales (B2B) ────────────────────────────────────────

export const listFactorySales = async (req, res) => {
  try {
    const actor = await loadActor(req.query.userId);
    if (!canUse(actor)) return res.status(403).json({ error: 'Not allowed' });
    const filter = {};
    if (req.query.factoryId && mongoose.Types.ObjectId.isValid(String(req.query.factoryId))) {
      filter.factory = req.query.factoryId;
    }
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const [sales, total] = await Promise.all([
      FactorySale.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('factory', 'name')
        .populate('clientId', 'name phone')
        .populate('vendorId', 'name phone')
        .populate('createdBy', 'name')
        .lean(),
      FactorySale.countDocuments(filter),
    ]);
    return res.json({
      sales,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
    });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || 'Failed to list factory sales' });
  }
};

export const createFactorySale = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const actor = await loadActor(req.body.userId);
    if (!canUse(actor)) throw httpError(403, 'Not allowed');

    const factory = await requireFactory(req.body.factoryId, session);
    const partyType = String(req.body.partyType || '').trim();
    if (partyType !== 'client' && partyType !== 'vendor') {
      throw httpError(400, 'partyType must be client or vendor');
    }

    let partyName = String(req.body.partyName || '').trim();
    let clientId = null;
    let vendorId = null;

    if (partyType === 'client') {
      clientId = req.body.clientId;
      if (!clientId || !mongoose.Types.ObjectId.isValid(String(clientId))) {
        throw httpError(400, 'clientId is required');
      }
      const client = await Client.findById(clientId).session(session).lean();
      if (!client) throw httpError(404, 'Client not found');
      partyName = partyName || client.name || '';
    } else {
      vendorId = req.body.vendorId;
      if (!vendorId || !mongoose.Types.ObjectId.isValid(String(vendorId))) {
        throw httpError(400, 'vendorId is required');
      }
      const vendor = await Vendor.findById(vendorId).session(session).lean();
      if (!vendor) throw httpError(404, 'Vendor not found');
      partyName = partyName || vendor.name || '';
    }

    const linesRaw = Array.isArray(req.body.lines) ? req.body.lines : [];
    if (!linesRaw.length) throw httpError(400, 'At least one sale line is required');

    const lines = [];
    let totalAmount = 0;

    for (const row of linesRaw) {
      const productId = row.productId;
      const quantity = roundWeight(Number(row.quantity) || 0);
      const unitPrice = roundMoney(Number(row.unitPrice) || 0);
      if (!productId || !mongoose.Types.ObjectId.isValid(String(productId))) {
        throw httpError(400, 'Each line needs productId');
      }
      if (quantity <= 0) throw httpError(400, 'Line quantity must be > 0');
      if (unitPrice < 0) throw httpError(400, 'unitPrice must be >= 0');

      const product = await Product.findById(productId).session(session);
      if (!product) throw httpError(404, 'Product not found');
      if (String(product.factory) !== String(factory._id)) {
        throw httpError(400, `Product ${product.code} is not in this factory`);
      }
      const avail = availableStock(product);
      if (avail < quantity) {
        throw httpError(400, `Insufficient stock for ${product.name}: available ${avail}`);
      }

      const unitCost = roundMoney(Number(product.netPrice) || 0);
      const lineTotal = roundMoney(unitPrice * quantity);
      totalAmount = roundMoney(totalAmount + lineTotal);

      product.stock = roundWeight(Math.max(0, Number(product.stock) - quantity));
      await product.save({ session });

      lines.push({
        productId: product._id,
        name: product.name,
        code: product.code,
        quantity,
        unitPrice,
        unitCost,
        lineTotal,
      });

      await StockMovement.create(
        [
          {
            movementType: 'sale',
            productId: product._id,
            productName: product.name,
            factoryId: factory._id,
            fromFactoryId: factory._id,
            quantity,
            unitPrice,
            totalValue: lineTotal,
            referenceType: 'factorySale',
            notes: `Factory sale to ${partyName || partyType}`,
          },
        ],
        { session }
      );
    }

    const [sale] = await FactorySale.create(
      [
        {
          factory: factory._id,
          partyType,
          clientId,
          vendorId,
          partyName,
          lines,
          totalAmount,
          notes: String(req.body.notes || '').trim(),
          createdBy: actor?._id || null,
        },
      ],
      { session }
    );

    // Attach referenceId on movements (best-effort; already created inside loop without id)
    await StockMovement.updateMany(
      {
        referenceType: 'factorySale',
        factoryId: factory._id,
        referenceId: { $exists: false },
        createdAt: { $gte: new Date(Date.now() - 60000) },
      },
      { $set: { referenceId: sale._id } },
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    await auditLog(req, {
      action: 'create',
      module: 'factory',
      entityType: 'FactorySale',
      entityId: sale._id,
      message: `Factory sale ${totalAmount} to ${partyName}`,
    });

    const populated = await FactorySale.findById(sale._id)
      .populate('factory', 'name')
      .populate('clientId', 'name phone')
      .populate('vendorId', 'name phone')
      .populate('createdBy', 'name')
      .lean();

    return res.status(201).json({ sale: populated });
  } catch (e) {
    await session.abortTransaction();
    session.endSession();
    return res.status(e.status || 500).json({ error: e.message || 'Failed to create factory sale' });
  }
};

/** Exported for purchase-quantity factory destination. */
export { resolveOrCreateFactoryProduct, factoryProductFilter, requireFactory };
