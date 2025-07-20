import Category from '../../DB/models/category.model.js';

// Get all categories with pagination and search
export const getCategories = async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '' } = req.query;
    const skip = (page - 1) * limit;
    const searchRegex = new RegExp(search, 'i'); // case-insensitive

    const query = { name: { $regex: searchRegex } };

    const categories = await Category.find(query)
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Category.countDocuments(query); // Fixed variable name (category → Category)

    res.json({
      categories,
      meta: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / limit),
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

    res.json(category);
  } catch (err) {
    console.error('❌ Error fetching category:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

// Create category
export const createCategory = async (req, res) => {
  try {
    const { name } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const newCategory = await Category.create({ name });

    res.status(201).json({ 
      message: '✅ Category created', 
      category: newCategory 
    });
  } catch (err) {
    console.error('❌ Error creating category:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

// Update category
export const updateCategory = async (req, res) => {
  try {
    const { name } = req.body;

    const updatedCategory = await Category.findByIdAndUpdate(
      req.params.id,
      { name },
      { new: true }
    );

    if (!updatedCategory) {
      return res.status(404).json({ error: 'Category not found' });
    }

    res.json({ 
      message: '✅ Category updated', 
      category: updatedCategory 
    });
  } catch (err) {
    console.error('❌ Error updating category:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

// Delete category
export const deleteCategory = async (req, res) => {
  try {
    const deletedCategory = await Category.findByIdAndDelete(req.params.id);

    if (!deletedCategory) {
      return res.status(404).json({ error: 'Category not found' });
    }

    res.json({ message: '✅ Category deleted' });
  } catch (err) {
    console.error('❌ Error deleting category:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
};