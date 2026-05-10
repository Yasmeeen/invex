import express from 'express';
import { previewDrawerClose, closeDrawer, listDrawerCloses } from './service.js';

const router = express.Router();

router.get('/preview', previewDrawerClose);
router.post('/', closeDrawer);
router.get('/', listDrawerCloses);

export default router;
