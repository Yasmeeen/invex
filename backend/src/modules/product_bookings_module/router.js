import express from 'express';
import {
  createProductBooking,
  cancelProductBooking,
  getBookingByProductId,
  listProductBookings,
} from './service.js';

const router = express.Router();

router.get('/', listProductBookings);
router.get('/product/:productId', getBookingByProductId);
router.post('/', createProductBooking);
router.patch('/:id/cancel', cancelProductBooking);

export default router;
