import Product from '../../DB/models/product.model.js';

// Get all products (with pagination and optional search)
// Get all products (with pagination, optional search, optional branch filter)
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

    // Optional branch filter
    if (branchId) {
      query.branch = branchId; // only filter if branchId is provided
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
    const { name, code, price,netPrice, category, branch,stock,discount } = req.body;

    if (!name || !code || !price || !netPrice || !category._id || !branch._id || !stock) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    const isProductCodeExist = await Product.findOne({ code });
    if (isProductCodeExist) {
      return res.status(409).json({ error: 'product code already exist' });
    }
    const createdProduct = await Product.create({
      name,
      code,
      price,
      netPrice,
      stock,
      discount,
      category: category._id,
      branch: branch._id
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
    const { name, code, price, netPrice, category, branch,stock,discount } = req.body;

    if (!name || !code || !price || !netPrice, !category || !branch || !stock || !discount) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const product = await Product.findByIdAndUpdate(
      req.params.id,
      { name, code, price, netPrice, category, branch, stock, discount },
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
    // Filter only if branchId is provided
    const filter = branchId ? { branch: branchId } : {};

    // Count stats
    const totalProducts = await Product.countDocuments(filter);
    const inStock = await Product.countDocuments({ ...filter, stock: { $gt: 0 } });
    const outOfStock = await Product.countDocuments({ ...filter, stock: { $lte: 0 } });

    res.status(200).json({
      totalProducts,
      inStock,
      outOfStock,
      branch: branchId || 'All Branches',
    });
  } catch (error) {
    console.error('Error fetching product stats:', error);
    res.status(500).json({ message: 'Server error' });
  }
};