import Branch from '../../DB/models/branch.model.js';

const normalizeSalespeople = (raw) => {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (typeof item === 'string') {
        const name = item.trim();
        return name ? { name, active: true } : null;
      }
      const name = String(item?.name || '').trim();
      if (!name) return null;
      return { name, active: item?.active !== false };
    })
    .filter(Boolean);
};

const parseOpeningDate = (value) => {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? null
      : new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  const raw = String(value).trim();
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (dateOnly) {
    const y = Number(dateOnly[1]);
    const m = Number(dateOnly[2]) - 1;
    const day = Number(dateOnly[3]);
    const local = new Date(y, m, day);
    return Number.isNaN(local.getTime()) ? null : local;
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
};

export const getBranches = async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '' } = req.query;
    const skip = (page - 1) * limit;
    const searchRegex = new RegExp(search, 'i'); // case-insensitive

    const query = { name: { $regex: searchRegex } };

    const branches = await Branch.find(query)
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Branch.countDocuments(query);

    res.json({
      branches,
      meta: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    console.error('❌ Error fetching branches:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

export const getBranchById = async (req, res) => {
  try {
    const branch = await Branch.findById(req.params.id);

    if (!branch) {
      return res.status(404).json({ error: 'Branch not found' });
    }

    res.json(branch);
  } catch (err) {
    console.error('❌ Error fetching branch:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

export const createBranch = async (req, res) => {
  try {
    const {
      name,
      storeAddress,
      rent,
      employeesSalary,
      branchInvoices,
      expenses,
      openingDate,
      salespeople,
    } = req.body;

    // ✅ Required validation
    if (!name || !storeAddress) {
      return res.status(400).json({
        error: 'Name and storeAddress are required',
      });
    }

    // ✅ Default values if not provided
    const newBranchData = {
      name,
      storeAddress,
      rent: Number(rent) || 0,
      employeesSalary: Number(employeesSalary) || 0,
      branchInvoices: Number(branchInvoices) || 0,
      expenses: Number(expenses) || 0,
      openingDate: parseOpeningDate(openingDate) ?? null,
      salespeople: normalizeSalespeople(salespeople),
    };

    const newBranch = await Branch.create(newBranchData);

    res.status(201).json({
      message: '✅ Branch created',
      branch: newBranch,
    });
  } catch (err) {
    console.error('❌ Error creating branch:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
};


export const updateBranch = async (req, res) => {
  try {
    const { name,
      storeAddress,
      rent,
      employeesSalary,
      branchInvoices,
      expenses,
      openingDate,
      salespeople, } = req.body;

    const update = {
      name,
      storeAddress,
      rent: Number(rent) || 0,
      employeesSalary: Number(employeesSalary) || 0,
      branchInvoices: Number(branchInvoices) || 0,
      expenses: Number(expenses) || 0,
      salespeople: normalizeSalespeople(salespeople),
    };
    const parsedOpening = parseOpeningDate(openingDate);
    if (parsedOpening !== undefined) {
      update.openingDate = parsedOpening;
    }

    const updatedBranch = await Branch.findByIdAndUpdate(
      req.params.id,
      update,
      { new: true }
    );


    if (!updatedBranch) {
      return res.status(404).json({ error: 'Branch not found' });
    }

    res.json({ message: '✅ Branch updated', branch: updatedBranch });
  } catch (err) {
    console.error('❌ Error updating branch:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

export const deleteBranch = async (req, res) => {
  try {
    const deletedBranch = await Branch.findByIdAndDelete(req.params.id);

    if (!deletedBranch) {
      return res.status(404).json({ error: 'Branch not found' });
    }

    res.json({ message: '✅ Branch deleted' });
  } catch (err) {
    console.error('❌ Error deleting branch:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
};
