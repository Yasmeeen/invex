import express from 'express';
const router = express.Router();

import {
  listProductPurchaseRequests,
  getProductPurchaseRequest,
  createProductPurchaseRequest,
  addProductPurchaseLine,
  addQuantityToExistingProduct,
  approveProductPurchaseRequest,
  rejectProductPurchaseRequest,
  recordProductPurchaseDeferredPayment,
  returnProductPurchaseRequest,
} from './service.js';

router.get('/', listProductPurchaseRequests);
router.get('/:id', getProductPurchaseRequest);
router.post('/', createProductPurchaseRequest);
router.post('/add-quantity', addQuantityToExistingProduct);
router.post('/:id/add-line', addProductPurchaseLine);
router.patch('/:id/approve', approveProductPurchaseRequest);
router.patch('/:id/reject', rejectProductPurchaseRequest);
router.post('/:id/deferred-payment', recordProductPurchaseDeferredPayment);
router.post('/:id/return', returnProductPurchaseRequest);

export default router;
