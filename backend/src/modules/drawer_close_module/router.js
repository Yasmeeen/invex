import express from 'express';
import {
  previewDrawerClose,
  closeDrawer,
  listDrawerCloses,
  getDrawerOpeningBalance,
  reopenLastDrawerClose,
} from './service.js';

const router = express.Router();

router.get('/preview', previewDrawerClose);
router.get('/opening-balance', getDrawerOpeningBalance);
router.delete('/latest', reopenLastDrawerClose);
router.post('/', closeDrawer);
router.get('/', listDrawerCloses);

export default router;
