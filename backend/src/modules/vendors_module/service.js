

import Vendor from "../../DB/models/vendor.model.js";

// 📌 Create Vendor
export const createVendor = async (req, res) => {
  try {
    const {
      nameOfcompany,
      name,
      email,
      address,
      phone,
      transactionCurrency,
      paymentTerms,
      categories
    } = req.body;

    console.log("req.body",req.body);
    
    if  (
        !nameOfcompany ||
        !name ||
        !phone ||
        !paymentTerms ||
        paymentTerms.length === 0 ||
        !categories ||
        categories.length === 0
      ) {
      return res.status(400).json({ message: 'Please fill all required fields' });
    }

    const vendor = new Vendor({
      nameOfcompany,
      name,
      email,
      address,
      phone,
      transactionCurrency,
      paymentTerms,
      categories
    });

    const savedVendor = await vendor.save();
    res.status(201).json(savedVendor);
  } catch (error) {
    console.error('Error creating vendor:', error);
    res.status(500).json({ message: 'Server error while creating vendor' });
  }
};

// 📌 Get Vendors (with pagination + search)
export const getVendors = async (req, res) => {
    try {
      const { page = 1, limit = 10, search = '' } = req.query;
  
      const query = search
        ? {
            $or: [
              { nameOfcompany: { $regex: search, $options: 'i' } },
              { name: { $regex: search, $options: 'i' } },
              { phone: { $regex: search, $options: 'i' } },
            ],
          }
        : {};
  
      const totalCount = await Vendor.countDocuments(query);
      const totalPages = Math.ceil(totalCount / limit);
      const currentPage = parseInt(page);
      const nextPage = currentPage < totalPages ? currentPage + 1 : null;
      const prevPage = currentPage > 1 ? currentPage - 1 : null;
  
      const vendors = await Vendor.find(query)
        .populate('categories', 'name')
        .skip((currentPage - 1) * limit)
        .limit(parseInt(limit))
        .sort({ createdAt: -1 });
  
      res.json({
        vendors,
        meta: {
          currentPage,
          nextPage,
          prevPage,
          totalCount,
          totalPages,
        },
      });
    } catch (error) {
      console.error('Error fetching vendors:', error);
      res.status(500).json({ message: 'Server error while fetching vendors' });
    }
  };
  

// 📌 Get Vendor by ID
export const getVendorById = async (req, res) => {
  try {
    const vendor = await Vendor.findById(req.params.id).populate('categories', 'name');

    if (!vendor) {
      return res.status(404).json({ message: 'Vendor not found' });
    }

    res.json(vendor);
  } catch (error) {
    console.error('Error fetching vendor:', error);
    res.status(500).json({ message: 'Server error while fetching vendor' });
  }
};

// 📌 Update Vendor
export const updateVendor = async (req, res) => {
  try {
    const {
      nameOfcompany,
      name,
      email,
      phone,
      address,
      transactionCurrency,
      paymentTerms,
      categories,
    } = req.body;

    const vendor = await Vendor.findById(req.params.id);
    if (!vendor) {
      return res.status(404).json({ message: 'Vendor not found' });
    }

    vendor.nameOfcompany = nameOfcompany || vendor.nameOfcompany;
    vendor.name = name || vendor.name;
    vendor.email = email || vendor.email;
    vendor.transactionCurrency = transactionCurrency || vendor.transactionCurrency;
    vendor.paymentTerms = paymentTerms || vendor.paymentTerms;
    vendor.categories = categories || vendor.categories;
    vendor.phone = phone || vendor.phone;
    vendor.address = address || vendor.address


    const updatedVendor = await vendor.save();
    res.json(updatedVendor);
  } catch (error) {
    console.error('Error updating vendor:', error);
    res.status(500).json({ message: 'Server error while updating vendor' });
  }
};

// 📌 Delete Vendor
export const deleteVendor = async (req, res) => {
  try {
    const vendor = await Vendor.findById(req.params.id);

    if (!vendor) {
      return res.status(404).json({ message: 'Vendor not found' });
    }

    await vendor.deleteOne();
    res.json({ message: 'Vendor deleted successfully' });
  } catch (error) {
    console.error('Error deleting vendor:', error);
    res.status(500).json({ message: 'Server error while deleting vendor' });
  }
};


