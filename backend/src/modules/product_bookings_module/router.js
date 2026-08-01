import express from 'express';
import {
  createProductBooking,
  cancelProductBooking,
  confirmProductBooking,
  getBookingByProductId,
  getBookingsReport,
  listProductBookings,
  getActiveBookingsForCheckout,
  getActiveReservationsForProduct,
} from './service.js';

const router = express.Router();

router.get('/report', getBookingsReport);
router.get('/active-for-checkout', getActiveBookingsForCheckout);
router.get('/active-reservations/:productId', getActiveReservationsForProduct);
router.get('/', listProductBookings);
router.get('/product/:productId', getBookingByProductId);
router.post('/', createProductBooking);
router.patch('/:id/cancel', cancelProductBooking);
router.patch('/:id/confirm', confirmProductBooking);

export default router;
