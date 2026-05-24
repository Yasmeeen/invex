

import PurchasingRequest from "../../DB/models/purchasingRequest.model.js";
import StockMovement from "../../DB/models/stockMovement.model.js";
import {
  removeVendorPurchaseLedger,
  syncVendorPurchaseLedger,
} from "../../utils/vendor-purchase-ledger.js";

// ✅ Get all Purchasing Requests (with pagination & optional search)
export const getPurchasingRequests = async (req, res) => {
  
    
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
      .populate('supplier', 'nameOfcompany name paymentTerms' )
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

    try {
      await syncVendorPurchaseLedger(newPurchasingRequest, {
        userId: req.body?.userId || req.body?.createdByUserId,
      });
    } catch (ledgerErr) {
      console.error('⚠️ Failed to sync vendor purchase ledger:', ledgerErr.message);
    }

    // Purchase movement log (request-level; current model has no per-product quantities).
    try {
      await StockMovement.create({
        movementType: 'purchase',
        productId: null,
        productName: 'Purchasing request',
        quantity: 1,
        unitPrice: Number(newPurchasingRequest.totalAmount || 0),
        totalValue: Number(newPurchasingRequest.totalAmount || 0),
        referenceType: 'purchasingRequest',
        referenceId: newPurchasingRequest._id,
        notes: newPurchasingRequest.notes || '',
      });
    } catch (movementError) {
      console.error('⚠️ Failed to log purchase movement:', movementError.message);
    }

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

    try {
      await syncVendorPurchaseLedger(updatedPurchasingRequest, {
        userId: req.body?.userId || req.body?.createdByUserId,
      });
    } catch (ledgerErr) {
      console.error('⚠️ Failed to sync vendor purchase ledger:', ledgerErr.message);
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

    try {
      await removeVendorPurchaseLedger(
        deletedPurchasingRequest._id,
        deletedPurchasingRequest.supplier
      );
    } catch (ledgerErr) {
      console.error('⚠️ Failed to remove vendor purchase ledger:', ledgerErr.message);
    }

    res.status(200).json({ message: 'Purchasing request deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting purchasing request', error: error.message });
  }
};
