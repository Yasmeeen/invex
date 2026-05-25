import express from 'express';
const router = express.Router();
import {
  getVendors,
  getVendorById,
  getVendorByPhone,
  getVendorHistory,
  settleVendorBalances,
  addVendorDeposit,
  addVendorReceivedDeposit,
  setVendorOpeningDebitBalance,
  payVendorOpeningDebitBalance,
  recordVendorDeferredPurchasePayment,
  recordVendorInstallmentPurchasePayment,
  payVendorSupplier,
  createVendor,
  updateVendor,
  deleteVendor,
} from './service.js';

router.get('/', getVendors);
router.get('/by-phone/:phone', getVendorByPhone);
router.get('/:id/history', getVendorHistory);
router.post('/:id/settle', settleVendorBalances);
router.post('/:id/deposit', addVendorDeposit);
router.post('/:id/received-deposit', addVendorReceivedDeposit);
router.post('/:id/opening-debit-balance', setVendorOpeningDebitBalance);
router.post('/:id/opening-debit-payment', payVendorOpeningDebitBalance);
router.post('/:id/deferred-payment', recordVendorDeferredPurchasePayment);
router.post('/:id/installment-payment', recordVendorInstallmentPurchasePayment);
router.post('/:id/pay-supplier', payVendorSupplier);
router.get('/:id', getVendorById);
router.post('/createVendor', createVendor);
router.put('/updateVendor/:id', updateVendor);
router.delete('/deleteVendor/:id', deleteVendor);

export default router;
