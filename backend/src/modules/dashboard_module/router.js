import express from 'express';
const router = express.Router();
import {
    getOrdersStatstics
  } from './service.js';
  

router.get('/getOrdersStatstics', getOrdersStatstics);              // GET all with pagination/search


export default router; 
