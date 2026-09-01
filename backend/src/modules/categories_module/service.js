import mongoose from 'mongoose';
import Category from '../../DB/models/category.model.js';
import Product from '../../DB/models/product.model.js';
import User from '../../DB/models/user.model.js';
import {
  notifyCategoryChanged,
  notifyCategoryDeleted,
} from '../integrations_module/catalogSync.js';

/** Roles allowed to create / edit / delete categories (matches frontend RoleGuard). */
const CATEGORY_WRITE_ROLES = ['Super Admin', 'Co Admin', 'Admin', 'Branch Manager'];

function pickActorUserId(req) {
  const body = req?.body || {};
  const query = req?.query || {};
  return body.userId || body.user_id || query.userId || query.user_id || null;
}

async function loadActor(userId) {
  if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) return null;
  return User.findById(userId).select('role branch name').lean();
}

function canManageCategories(actor) {
  if (!actor) return false;
  return CATEGORY_WRITE_ROLES.includes(String(actor.role || '').trim());
}

async function assertCanManageCategories(req, res) {
  const userId = pickActorUserId(req);
  if (!userId) {
    res.status(400).json({ error: 'userId is required' });
    return null;
  }
  const actor = await loadActor(userId);
  if (!actor) {
    res.status(401).json({ error: 'User not found' });
    return null;
  }
  if (!canManageCategories(actor)) {
    res.status(403).json({ error: 'Not allowed to manage categories' });
    return null;
  }
  return actor;
}

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizeCategoryCode = (raw) => {
  const t = raw != null ? String(raw).trim() : '';
  if (!t) return '';
  if (!/^[A-Za-z0-9-]+$/.test(t)) {
    return null;
  }
  return t.toUpperCase().replace(/-+$/, '');
};

const normalizeAttrKey = (raw) =>
  String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');

const normalizeAttributeDefs = (raw) => {
  if (raw == null) return [];
  if (!Array.isArray(raw)) return null;
  const out = [];
  const seen = new Set();
  for (const r of raw) {
    // Accept: [{key,label?}] or ["color","storage"]
    const key = normalizeAttrKey(typeof r === 'string' ? r : r?.key);
    const label =
      typeof r === 'string' ? '' : String(r?.label || '').trim();
    const showOnInvoice =
      typeof r === 'string' ? false : !!r?.showOnInvoice;
    const showInBarcode =
      typeof r === 'string' ? false : !!r?.showInBarcode;
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, label: label || key, showOnInvoice, showInBarcode });
  }
  return out;
};

/** Plain object for API: always include `code` (JSON omits undefined). */
const toCategoryResponse = (doc, extra = {}) => {
  const o = doc && typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };
  const code = o.code != null && String(o.code).trim() !== '' ? String(o.code).trim() : '';
  return {
    ...o,
    code,
    imageUrl: o.imageUrl != null ? String(o.imageUrl).trim() : '',
    multiCodePerPiece: !!o.multiCodePerPiece,
    sellByWeight: !!o.sellByWeight,
    weightUnit: o.weightUnit === 'g' ? 'g' : 'kg',
    deleteProductWhenOutOfStock: !!o.deleteProductWhenOutOfStock,
    // Legacy categories without the field → default true
    showProductCodeOnInvoice:
      o.showProductCodeOnInvoice == null ? true : !!o.showProductCodeOnInvoice,
    ...extra,
  };
};

// Get all categories with pagination and search

export const getCategories = async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '' } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const searchRegex = new RegExp(search, 'i');

    const query = search ? { name: { $regex: searchRegex } } : {};

    // Fetch categories and total count in parallel
    const [categories, total] = await Promise.all([
      Category.find(query)
        .skip(skip)
        .limit(Number(limit)),
      Category.countDocuments(query),
    ]);

    // Add product count and total stock per category
    const categoriesWithCount = await Promise.all(
      categories.map(async (category) => {
        const products = await Product.find({ category: category._id });
        const productsCount = products.length;
        const totalItems = products.reduce((acc, p) => acc + (p.stock || 0), 0);

        return toCategoryResponse(category, { productsCount, totalItems });
      })
    );

    const totalPages = Math.ceil(total / limit);

    res.json({
      categories: categoriesWithCount,
      meta: {
        currentPage: Number(page),
        limit: Number(limit), // ✅ same naming as getProducts
        nextPage: page < totalPages ? Number(page) + 1 : null,
        prevPage: page > 1 ? Number(page) - 1 : null,
        totalCount: total,
        totalPages,
      },
    });
  } catch (err) {
    console.error('❌ Error fetching categories:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
};




// Get category by ID
export const getCategoryById = async (req, res) => {
  try {
    const category = await Category.findById(req.params.id);

    if (!category) {
      return res.status(404).json({ error: 'Category not found' });
    }

    res.json(toCategoryResponse(category));
  } catch (err) {
    console.error('❌ Error fetching category:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

const parseBool = (v) => v === true || v === 'true' || String(v).toLowerCase() === 'true';

const normalizeWeightUnit = (raw) => (String(raw || 'kg').trim().toLowerCase() === 'g' ? 'g' : 'kg');

const assertCategoryWeightFlags = (sellByWeight, multiCodePerPiece) => {
  if (parseBool(sellByWeight) && parseBool(multiCodePerPiece)) {
    return 'Category cannot combine sell-by-weight with multi-code-per-piece';
  }
  return null;
};

const normalizeImageUrl = (raw) => {
  if (raw == null) return '';
  return String(raw).trim();
};

// Create category
export const createCategory = async (req, res) => {
  try {
    const actor = await assertCanManageCategories(req, res);
    if (!actor) return;

    const {
      name,
      code,
      imageUrl,
      attributeDefs,
      multiCodePerPiece,
      deleteProductWhenOutOfStock,
      showProductCodeOnInvoice,
      sellByWeight,
      weightUnit,
    } = req.body;
    const codeNorm = normalizeCategoryCode(code);
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }
    if (!codeNorm) {
      return res.status(400).json({
        error:
          'Category code is required (letters, numbers, and hyphens only, e.g. ELEC)',
      });
    }

    const dup = await Category.findOne({
      code: new RegExp(`^${escapeRegex(codeNorm)}$`, 'i'),
    });
    if (dup) {
      return res.status(409).json({ error: 'Category code already in use' });
    }

    const attr = normalizeAttributeDefs(attributeDefs);
    if (attr === null) {
      return res.status(400).json({ error: 'attributeDefs must be an array' });
    }

    const weightFlagErr = assertCategoryWeightFlags(sellByWeight, multiCodePerPiece);
    if (weightFlagErr) {
      return res.status(400).json({ error: weightFlagErr });
    }

    const newCategory = await Category.create({
      name: name.trim(),
      code: codeNorm,
      imageUrl: normalizeImageUrl(imageUrl),
      attributeDefs: attr,
      multiCodePerPiece: parseBool(multiCodePerPiece),
      sellByWeight: parseBool(sellByWeight),
      weightUnit: normalizeWeightUnit(weightUnit),
      deleteProductWhenOutOfStock: parseBool(deleteProductWhenOutOfStock),
      // Default true when omitted (schema default + product intent)
      showProductCodeOnInvoice:
        showProductCodeOnInvoice == null ? true : parseBool(showProductCodeOnInvoice),
    });

    notifyCategoryChanged(newCategory._id);
    res.status(201).json({
      message: '✅ Category created',
      category: toCategoryResponse(newCategory),
    });
  } catch (err) {
    console.error('❌ Error creating category:', err.message);
    if (err.code === 11000) {
      return res.status(409).json({ error: 'Category code already in use' });
    }
    res.status(500).json({ error: 'Server error' });
  }
};

// Update category
export const updateCategory = async (req, res) => {
  try {
    const actor = await assertCanManageCategories(req, res);
    if (!actor) return;

    const {
      name,
      code,
      imageUrl,
      attributeDefs,
      multiCodePerPiece,
      deleteProductWhenOutOfStock,
      showProductCodeOnInvoice,
      sellByWeight,
      weightUnit,
    } = req.body;
    const updates = {};

    if (name != null && String(name).trim() !== '') {
      updates.name = String(name).trim();
    }
    if (imageUrl !== undefined) {
      updates.imageUrl = normalizeImageUrl(imageUrl);
    }
    if (code !== undefined) {
      const codeNorm = normalizeCategoryCode(code);
      if (!codeNorm) {
        return res.status(400).json({
          error:
            'Category code is required (letters, numbers, and hyphens only, e.g. ELEC)',
        });
      }
      const dup = await Category.findOne({
        _id: { $ne: req.params.id },
        code: new RegExp(`^${escapeRegex(codeNorm)}$`, 'i'),
      });
      if (dup) {
        return res.status(409).json({ error: 'Category code already in use' });
      }
      updates.code = codeNorm;
    }

    if (attributeDefs !== undefined) {
      const attr = normalizeAttributeDefs(attributeDefs);
      if (attr === null) {
        return res.status(400).json({ error: 'attributeDefs must be an array' });
      }
      updates.attributeDefs = attr;
    }

    if (multiCodePerPiece !== undefined) {
      updates.multiCodePerPiece = parseBool(multiCodePerPiece);
    }

    if (sellByWeight !== undefined) {
      updates.sellByWeight = parseBool(sellByWeight);
    }

    if (weightUnit !== undefined) {
      updates.weightUnit = normalizeWeightUnit(weightUnit);
    }

    if (deleteProductWhenOutOfStock !== undefined) {
      updates.deleteProductWhenOutOfStock = parseBool(deleteProductWhenOutOfStock);
    }

    if (showProductCodeOnInvoice !== undefined) {
      updates.showProductCodeOnInvoice = parseBool(showProductCodeOnInvoice);
    }

    const nextSellByWeight =
      updates.sellByWeight !== undefined
        ? updates.sellByWeight
        : undefined;
    const nextMultiCode =
      updates.multiCodePerPiece !== undefined
        ? updates.multiCodePerPiece
        : undefined;
    if (nextSellByWeight !== undefined || nextMultiCode !== undefined) {
      const existingCat = await Category.findById(req.params.id).lean();
      if (!existingCat) {
        return res.status(404).json({ error: 'Category not found' });
      }
      const weightFlagErr = assertCategoryWeightFlags(
        nextSellByWeight ?? existingCat.sellByWeight,
        nextMultiCode ?? existingCat.multiCodePerPiece
      );
      if (weightFlagErr) {
        return res.status(400).json({ error: weightFlagErr });
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'Nothing to update' });
    }

    const updatedCategory = await Category.findByIdAndUpdate(req.params.id, updates, {
      new: true,
    });

    if (!updatedCategory) {
      return res.status(404).json({ error: 'Category not found' });
    }

    notifyCategoryChanged(updatedCategory._id);
    res.json({
      message: '✅ Category updated',
      category: toCategoryResponse(updatedCategory),
    });
  } catch (err) {
    console.error('❌ Error updating category:', err.message);
    if (err.code === 11000) {
      return res.status(409).json({ error: 'Category code already in use' });
    }
    res.status(500).json({ error: 'Server error' });
  }
};

// Delete category
export const deleteCategory = async (req, res) => {
  try {
    const actor = await assertCanManageCategories(req, res);
    if (!actor) return;

    const deletedCategory = await Category.findByIdAndDelete(req.params.id);

    if (!deletedCategory) {
      return res.status(404).json({ error: 'Category not found' });
    }

    notifyCategoryDeleted(deletedCategory._id);
    res.json({ message: '✅ Category deleted' });
  } catch (err) {
    console.error('❌ Error deleting category:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
};