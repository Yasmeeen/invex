import express from 'express';
import {
  getSalesReport,
  getProfitReport,
  getProductsReport,
  getStockReport,
  getCustomersReport,
  getInstallmentsReport,
  getBookingsReport,
} from './service.js';

const router = express.Router();

router.get('/sales', getSalesReport);
router.get('/profit', getProfitReport);
router.get('/products', getProductsReport);
router.get('/stock', getStockReport);
router.get('/customers', getCustomersReport);
router.get('/installments', getInstallmentsReport);
router.get('/bookings', getBookingsReport);

export default router;

