

import PurchasingRequest from "../../DB/models/purchasingRequest.model.js";

// ✅ Get all Purchasing Requests (with pagination & optional search)
export const getPurchasingRequests = async (req, res) => {
    console.log("req.query",req.query);
    
  try {
    const { page = 1, limit = 10, search = '' } = req.query;

    const query = search
      ? {
          $or: [
            { purchasingDetails: { $regex: search, $options: 'i' } },
            { status: { $regex: search, $options: 'i' } },
          ],
        }
      : {};

    const totalCount = await PurchasingRequest.countDocuments(query);
    const totalPages = Math.ceil(totalCount / limit);

    const purchasingRequests = await PurchasingRequest.find(query)
      .populate('supplier', 'nameOfcompany name')
      .populate('products', 'name code price')
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .sort({ createdAt: -1 });

    res.status(200).json({
      requests: purchasingRequests,
      meta: {
        currentPage: Number(page),
        totalPages,
        totalCount,
        nextPage: page < totalPages ? Number(page) + 1 : null,
        prevPage: page > 1 ? Number(page) - 1 : null,
      },
    });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching purchasing requests', error: error.message });
  }
};

// ✅ Get one Purchasing Request by ID
export const getPurchasingRequestById = async (req, res) => {
  try {
    const purchasingRequest = await PurchasingRequest.findById(req.params.id)
      .populate('supplier', 'nameOfcompany name')
      .populate('products', 'name code price');

    if (!purchasingRequest) {
      return res.status(404).json({ message: 'Purchasing request not found' });
    }

    res.status(200).json(purchasingRequest);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching purchasing request', error: error.message });
  }
};

// ✅ Create new Purchasing Request
export const createPurchasingRequest = async (req, res) => {
  try {
    const newPurchasingRequest = new PurchasingRequest(req.body);
    await newPurchasingRequest.save();
    res.status(201).json({ message: 'Purchasing request created successfully', data: newPurchasingRequest });
  } catch (error) {
    res.status(400).json({ message: 'Error creating purchasing request', error: error.message });
  }
};

// ✅ Update Purchasing Request
export const updatePurchasingRequest = async (req, res) => {
  try {
    const updatedPurchasingRequest = await PurchasingRequest.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });
    if (!updatedPurchasingRequest) {
      return res.status(404).json({ message: 'Purchasing request not found' });
    }
    res.status(200).json({ message: 'Purchasing request updated successfully', data: updatedPurchasingRequest });
  } catch (error) {
    res.status(400).json({ message: 'Error updating purchasing request', error: error.message });
  }
};

// ✅ Delete Purchasing Request
export const deletePurchasingRequest = async (req, res) => {
  try {
    const deletedPurchasingRequest = await PurchasingRequest.findByIdAndDelete(req.params.id);
    if (!deletedPurchasingRequest) {
      return res.status(404).json({ message: 'Purchasing request not found' });
    }
    res.status(200).json({ message: 'Purchasing request deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting purchasing request', error: error.message });
  }
};
