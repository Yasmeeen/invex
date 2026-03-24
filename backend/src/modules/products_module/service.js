import mongoose from 'mongoose';
import Product from '../../DB/models/product.model.js';

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

// توليد كود تلقائي
export const generateBarcode = async (req, res) => {
  try {
    const uniqueCode = `PRD-${Date.now()}`; // فورمات فريد
    res.json({ code: uniqueCode });
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
    const { page = 1, limit = 10, search = '', branchId } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    // Build query
    const query = {};

    // Optional search
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { code: { $regex: search, $options: 'i' } },
      ];
    }

    const safeBranchId = parseBranchIdFilter(branchId);
    if (safeBranchId) {
      query.branch = safeBranchId;
    }

    const [products, total] = await Promise.all([
      Product.find(query)
        .populate('category', 'name')
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
      .populate('category', 'name')
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
    const { name, code, price, netPrice, category, branch, stock, discount } = req.body;

    if (!name || !code || !price || !netPrice || !category._id || !branch._id || !stock) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    // ✅ Check if a product with the same code exists in the same branch
    const existingProduct = await Product.findOne({ code, branch: branch._id });
    if (existingProduct) {
      return res.status(409).json({ error: 'Product code already exists in this branch' });
    }

    const createdProduct = await Product.create({
      name,
      code,
      price,
      netPrice,
      stock,
      discount,
      category: category._id,
      branch: branch._id,
    });

    res.status(201).json({ message: '✅ Product created', createdProduct });
  } catch (error) {
    console.error('❌ Error creating product:', error.message);
    res.status(500).json({ error: 'Failed to create product' });
  }
};


// Update product
export const updateProduct = async (req, res) => {
  try {
    const { name, code, price, netPrice, category, branch, stock, discount } = req.body;

    // ✅ Fix validation (used || instead of comma)
    if (!name || !code || !price || !netPrice || !category?._id || !branch?._id || !stock) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    // ✅ Prevent duplicate product code in the same branch (excluding itself)
    const existingProduct = await Product.findOne({
      code,
      branch: branch._id,
      _id: { $ne: req.params.id },
    });

    if (existingProduct) {
      return res.status(409).json({ error: 'Product code already exists in this branch' });
    }

    const product = await Product.findByIdAndUpdate(
      req.params.id,
      {
        name,
        code,
        price,
        netPrice,
        category: category._id,
        branch: branch._id,
        stock,
        discount,
      },
      { new: true }
    );

    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    res.json({ message: '✅ Product updated', product });
  } catch (error) {
    console.error('❌ Error updating product:', error.message);
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

    res.json({ message: '✅ Product deleted' });
  } catch (error) {
    console.error('❌ Error deleting product:', error.message);
    res.status(500).json({ error: 'Failed to delete product' });
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