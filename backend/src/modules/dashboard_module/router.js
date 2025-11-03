import express from 'express';
const router = express.Router();
import {
    getOrdersStatstics,
    getInvoicesPerMonth,
    getCategoriesStatistics,
    getOrdersStatisticsByStatus,
    getUpcomingUnpaidInstallments,
    markInstallmentPaid,
    getPastUnpaidInstallments
  } from './service.js';
  

router.get('/getOrdersStatstics', getOrdersStatstics);  
router.get('/invoicesPerMonth', getInvoicesPerMonth);  // GET all with pagination/search
router.get('/categoriesStats', getCategoriesStatistics);  // GET all with pagination/search
router.get('/getOrdersStatusStats', getOrdersStatisticsByStatus);
router.get('/upcoming-unpaid', getUpcomingUnpaidInstallments);
router.get('/past-unpaid', getPastUnpaidInstallments);
router.put('/:id/pay', markInstallmentPaid);


export default router; 
