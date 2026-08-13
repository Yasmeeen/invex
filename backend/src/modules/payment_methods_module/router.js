import express from 'express';
import {
  listPaymentMethods,
  createPaymentMethod,
  updatePaymentMethod,
  deletePaymentMethod,
} from './service.js';

const router = express.Router();

router.get('/', listPaymentMethods);
router.post('/', createPaymentMethod);
router.put('/:key', updatePaymentMethod);
router.delete('/:key', deletePaymentMethod);

export default router;
