import express from 'express';
import {
  completeStockCount,
  createStockCount,
  deleteStockCount,
  getStockCount,
  listStockCounts,
  removeStockCountScan,
  scanStockCount,
} from './service.js';

const router = express.Router();

router.get('/', listStockCounts);
router.post('/', createStockCount);
router.get('/:id', getStockCount);
router.post('/:id/scan', scanStockCount);
router.delete('/:id/scans/:scanId', removeStockCountScan);
router.post('/:id/complete', completeStockCount);
router.delete('/:id', deleteStockCount);

export default router;
