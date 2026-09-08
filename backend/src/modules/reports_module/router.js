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
  getAccountingSummaryReport,
} from './service.js';
import { allowRoles, requireAuth } from '../../middleware/auth.js';

const router = express.Router();
const REPORT_ROLES = ['Super Admin', 'Co Admin', 'Branch Manager'];

router.use(requireAuth, allowRoles(...REPORT_ROLES));
router.get('/sales', getSalesReport);
router.get('/profit', allowRoles('Super Admin'), getProfitReport);
router.get('/accounting-summary', allowRoles('Super Admin'), getAccountingSummaryReport);
router.get('/products', getProductsReport);
router.get('/stock', getStockReport);
router.get('/customers', getCustomersReport);
router.get('/installments', getInstallmentsReport);
router.get('/bookings', getBookingsReport);
router.get('/desk-purchases-treasury', getDeskPurchasesTreasuryReport);
router.get('/treasury-accounts', getTreasuryAccountsReport);

export default router;

