import mongoose from 'mongoose';
import Product from '../../DB/models/product.model.js';
import StockMovement from '../../DB/models/stockMovement.model.js';
import Category from '../../DB/models/category.model.js';
import { auditLog } from '../audit_module/audit.service.js';

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Ensures product code uses the category prefix; category must have a non-empty code. */
async function validateProductCodeForCategory(categoryId, productCode) {
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

// Suggested next product code: {CATEGORY_CODE}-{NNN} for the selected category
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

    const next = max + 1;
    const code = `${base}-${String(next).padStart(3, '0')}`;
    res.json({ code });
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

    bwipjs.toBuffer(
      {
        bcid: 'code128',
        text: code,
        scale: 3,
        height: 10,
        includetext: false, // هنكتب الكود لوحدنا لو حابة
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
        justify-content: center; /* يضع الاستيكر في منتصف الصفحة عرضياً */
        align-items: center;     /* يضع الاستيكر في منتصف الصفحة طولياً */
      }

      .sticker {
        width: 38mm;   /* نفس عرض الاستيكر */
        height: 25mm;  /* نفس طول الاستيكر */
        display: flex;
        flex-direction: column;
        justify-content: center; /* يوسّط المحتوى طولياً داخل الاستيكر */
        align-items: center;     /* يوسّط المحتوى عرضياً داخل الاستيكر */
        box-sizing: border-box;
      }

      .product-name {
        font-size: 8px;
        font-weight: bold;
        line-height: 1.1;
        margin-bottom: 1mm;
        max-width: 95%;
        text-align: center;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      img {
        max-width: 90%;
        max-height: 60%; 
        height: auto;
        display: block;
      }

      .code-name {
        margin-top: 1mm;
        text-align: center;
           font-size: 12px;
        font-weight: bold;
      }

</style>

            </head>

            <body>
            <div class="sticker-name">
               <div class="product-name">${name || ''}</div>
               <img src="data:image/png;base64,${png.toString('base64')}" />
               <div class="code-name">${code || ''}</div>
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



export const getProducts = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = '',
      branchId,
      warehouseOnly,
      excludeWarehouse,
      booked,
    } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    // Build query
    const query = {};
    const andParts = [];

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

    const safeBranchId = parseBranchIdFilter(branchId);
    if (safeBranchId) {
      query.branch = safeBranchId;
    }

    if (andParts.length) {
      query.$and = andParts;
    }

    const [products, total] = await Promise.all([
      Product.find(query)
        .populate('category', 'name code')
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
      .populate('category', 'name code')
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
    const { name, code, price, netPrice, category, branch, stock, discount, inWarehouse, imageUrl } = req.body;
    const imageUrlNorm = normalizeImageUrl(imageUrl);
    const isWarehouse =
      inWarehouse === true || inWarehouse === 'true' || String(inWarehouse).toLowerCase() === 'true';

    const categoryId = resolveCategoryId(category);
    const priceNum = Number(price);
    const netNum = Number(netPrice);
    const stockNum = Number(stock);

    if (
      !name ||
      code == null ||
      String(code).trim() === '' ||
      Number.isNaN(priceNum) ||
      Number.isNaN(netNum) ||
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

    const codeCheck = await validateProductCodeForCategory(categoryId, code);
    if (!codeCheck.ok) {
      return res.status(400).json({ error: codeCheck.error });
    }

    if (isWarehouse) {
      // Unique index is { code, branch }; warehouse uses branch: null (matches null or missing field).
      const existingWh = await Product.findOne({ code, branch: null });
      if (existingWh) {
        return res.status(409).json({ error: 'Product code already exists in warehouse' });
      }

      const createdProduct = await Product.create({
        name,
        code,
        price: priceNum,
        netPrice: netNum,
        stock: stockNum,
        discount: discount ?? 0,
        category: categoryId,
        branch: null,
        inWarehouse: true,
        imageUrl: imageUrlNorm,
      });

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

      return res.status(201).json({ message: '✅ Product created', createdProduct });
    }

    if (!branch?._id) {
      return res.status(400).json({ error: 'Branch is required when not storing in warehouse' });
    }

    if (!mongoose.Types.ObjectId.isValid(String(branch._id))) {
      return res.status(400).json({ error: 'Invalid branch' });
    }

    const existingProduct = await Product.findOne({ code, branch: branch._id });
    if (existingProduct) {
      return res.status(409).json({ error: 'Product code already exists in this branch' });
    }

    const createdProduct = await Product.create({
      name,
      code,
      price: priceNum,
      netPrice: netNum,
      stock: stockNum,
      discount: discount ?? 0,
      category: categoryId,
      branch: branch._id,
      inWarehouse: false,
      imageUrl: imageUrlNorm,
    });

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
    const { name, code, price, netPrice, category, branch, stock, discount, inWarehouse } = req.body;
    const hasImageUrl = Object.prototype.hasOwnProperty.call(req.body, 'imageUrl');
    const imageUrlNorm = hasImageUrl ? normalizeImageUrl(req.body.imageUrl) : undefined;
    const isWarehouse =
      inWarehouse === true || inWarehouse === 'true' || String(inWarehouse).toLowerCase() === 'true';

    const categoryId = resolveCategoryId(category);
    const priceNum = Number(price);
    const netNum = Number(netPrice);
    const stockNum = Number(stock);

    if (
      !name ||
      code == null ||
      String(code).trim() === '' ||
      Number.isNaN(priceNum) ||
      Number.isNaN(netNum) ||
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

    const codeCheck = await validateProductCodeForCategory(categoryId, code);
    if (!codeCheck.ok) {
      return res.status(400).json({ error: codeCheck.error });
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

      const updateDoc = {
        name,
        code,
        price: priceNum,
        netPrice: netNum,
        category: categoryId,
        branch: null,
        inWarehouse: true,
        stock: stockNum,
        discount: discount ?? 0,
      };
      if (imageUrlNorm !== undefined) {
        updateDoc.imageUrl = imageUrlNorm;
      }

      const before = await Product.findById(req.params.id).lean();
      const product = await Product.findByIdAndUpdate(req.params.id, updateDoc, { new: true });

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
      stock: stockNum,
      discount: discount ?? 0,
    };
    if (imageUrlNorm !== undefined) {
      updateDocBranch.imageUrl = imageUrlNorm;
    }

    const before = await Product.findById(req.params.id).lean();
    const product = await Product.findByIdAndUpdate(req.params.id, updateDocBranch, { new: true });

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


// Delete product
export const deleteProduct = async (req, res) => {
  try {
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

    res.json({ message: '✅ Product deleted' });
  } catch (error) {
    console.error('❌ Error deleting product:', error.message);
    res.status(500).json({ error: 'Failed to delete product' });
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

    if (Number(sourceProduct.stock) < transferQty) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        error: fromWh ? 'Not enough stock in warehouse.' : 'Not enough stock in source branch.',
      });
    }

    // Decrease stock at source (warehouse or branch)
    sourceProduct.stock = Number(sourceProduct.stock) - transferQty;
    await sourceProduct.save({ session });

    // Increase stock in destination branch if same code exists there, otherwise create one.
    let destinationProduct = await Product.findOne({
      code: sourceProduct.code,
      branch: toBranchId,
      inWarehouse: { $ne: true },
    }).session(session);

    if (destinationProduct) {
      destinationProduct.stock = Number(destinationProduct.stock) + transferQty;
      await destinationProduct.save({ session });
    } else {
      destinationProduct = await Product.create(
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
          },
        ],
        { session }
      );
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

export const getProductStats = async (req, res) => {
  try {
    const { branchId } = req.query;
    const safeBranchId = parseBranchIdFilter(branchId);
    const filter = safeBranchId ? { branch: safeBranchId } : {};

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