import express from 'express';
import { getStoreSettings, updateStoreSettings } from './service.js';

const router = express.Router();

router.get('/store', getStoreSettings);
router.put('/store', updateStoreSettings);

export default router;
