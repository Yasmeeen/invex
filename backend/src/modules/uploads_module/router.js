import express from 'express';
import { uploadProductImage } from './service.js';

const router = express.Router();

router.post('/product-image', uploadProductImage);

export default router;

