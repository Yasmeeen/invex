import express from 'express';
const router = express.Router();
import {
    getOrders,
    getOrderById,
    createOrder,
    updateOrder,
    deleteOrder,
    restoreOrder
  } from './service.js';

router.get('/', getOrders);              // GET all with pagination/search
router.get('/:id', getOrderById);        // GET one by ID
router.post('/createOrder', createOrder);           // POST create
router.put('/:id', updateOrder);         // PUT update
router.delete('/deleteOrder/:id', deleteOrder);      // DELETE product
router.put('/:orderId/restore', restoreOrder);

export default router; 
