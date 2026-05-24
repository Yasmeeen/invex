import express from 'express';
const router = express.Router();
import {
  getVendors,
  getVendorById,
  getVendorByPhone,
  getVendorHistory,
  settleVendorBalances,
  addVendorDeposit,
  setVendorOpeningDebitBalance,
  payVendorOpeningDebitBalance,
  recordVendorDeferredPurchasePayment,
  createVendor,
  updateVendor,
  deleteVendor,
} from './service.js';

router.get('/', getVendors);
router.get('/by-phone/:phone', getVendorByPhone);
router.get('/:id/history', getVendorHistory);
router.post('/:id/settle', settleVendorBalances);
router.post('/:id/deposit', addVendorDeposit);
router.post('/:id/opening-debit-balance', setVendorOpeningDebitBalance);
router.post('/:id/opening-debit-payment', payVendorOpeningDebitBalance);
router.post('/:id/deferred-payment', recordVendorDeferredPurchasePayment);
router.get('/:id', getVendorById);
router.post('/createVendor', createVendor);
router.put('/updateVendor/:id', updateVendor);
router.delete('/deleteVendor/:id', deleteVendor);

export default router;
