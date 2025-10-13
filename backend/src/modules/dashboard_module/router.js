import express from 'express';
const router = express.Router();
import {
    getOrdersStatstics,
    getInvoicesPerMonth,
    getCategoriesStatistics,
    getOrdersStatisticsByStatus
  } from './service.js';
  

router.get('/getOrdersStatstics', getOrdersStatstics);  
router.get('/invoicesPerMonth', getInvoicesPerMonth);  // GET all with pagination/search
router.get('/categoriesStats', getCategoriesStatistics);  // GET all with pagination/search
router.get('/getOrdersStatusStats', getOrdersStatisticsByStatus);


export default router; 
