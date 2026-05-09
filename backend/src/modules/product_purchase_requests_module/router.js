import express from 'express';
const router = express.Router();

import {
  listProductPurchaseRequests,
  getProductPurchaseRequest,
  createProductPurchaseRequest,
  approveProductPurchaseRequest,
  rejectProductPurchaseRequest,
} from './service.js';

router.get('/', listProductPurchaseRequests);
router.get('/:id', getProductPurchaseRequest);
router.post('/', createProductPurchaseRequest);
router.patch('/:id/approve', approveProductPurchaseRequest);
router.patch('/:id/reject', rejectProductPurchaseRequest);

export default router;
