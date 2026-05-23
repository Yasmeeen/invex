import express from 'express';
import {
  previewDrawerClose,
  closeDrawer,
  listDrawerCloses,
  getDrawerOpeningBalance,
} from './service.js';

const router = express.Router();

router.get('/preview', previewDrawerClose);
router.get('/opening-balance', getDrawerOpeningBalance);
router.post('/', closeDrawer);
router.get('/', listDrawerCloses);

export default router;
