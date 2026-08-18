import express from 'express';
import {
  getSalesReport,
  getProfitReport,
  getProductsReport,
  getStockReport,
  getCustomersReport,
  getInstallmentsReport,
  getBookingsReport,
  getDeskPurchasesTreasuryReport,
  getTreasuryAccountsReport,
} from './service.js';

const router = express.Router();

router.get('/sales', getSalesReport);
router.get('/profit', getProfitReport);
router.get('/products', getProductsReport);
router.get('/stock', getStockReport);
router.get('/customers', getCustomersReport);
router.get('/installments', getInstallmentsReport);
router.get('/bookings', getBookingsReport);
router.get('/desk-purchases-treasury', getDeskPurchasesTreasuryReport);
router.get('/treasury-accounts', getTreasuryAccountsReport);

export default router;

