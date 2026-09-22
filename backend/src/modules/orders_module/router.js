import express from 'express';
const router = express.Router();
import {
    getOrders,
    getOrderById,
    getNextInstallmentSaleNumber,
    createOrder,
    addOrderPayment,
    setInstallmentPromise,
    updateOrder,
    deleteOrder,
    restoreOrder,
    adminDeleteInstallmentSale,
    adminUpdateInstallmentSaleNumber,
    adminUpdateInstallmentRow,
  } from './service.js';

router.get('/', getOrders);              // GET all with pagination/search
router.get('/next-installment-sale-number', getNextInstallmentSaleNumber);
router.get('/:id', getOrderById);        // GET one by ID
router.post('/createOrder', createOrder);           // POST create
router.post('/:orderId/payments', addOrderPayment);
router.post('/:orderId/installments/:installmentId/promise', setInstallmentPromise);
router.post('/:orderId/admin-delete', adminDeleteInstallmentSale);
router.patch('/:orderId/admin-sale-number', adminUpdateInstallmentSaleNumber);
router.patch('/:orderId/installments/:installmentId/admin', adminUpdateInstallmentRow);
router.put('/:id', updateOrder);         // PUT update
router.delete('/deleteOrder/:id', deleteOrder);      // DELETE product
router.put('/:orderId/restore', restoreOrder);

export default router;
