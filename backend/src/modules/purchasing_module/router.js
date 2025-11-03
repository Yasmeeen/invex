import express from 'express';
const router = express.Router();
import {
  getPurchasingRequests,
  getPurchasingRequestById,
  createPurchasingRequest,
  updatePurchasingRequest,
  deletePurchasingRequest,
} from './service.js';

// GET all with pagination/search
router.get('/', getPurchasingRequests);

// GET one by ID
router.get('/:id', getPurchasingRequestById);

// POST create
router.post('/createPurchasingRequest', createPurchasingRequest);

// PUT update
router.put('/update/:id', updatePurchasingRequest);

// DELETE
router.delete('/delete/:id', deletePurchasingRequest);

export default router;
