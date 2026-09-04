import express from 'express';
import { listTickets, getTicket, createTicket } from './service.js';

const router = express.Router();

router.get('/tickets', listTickets);
router.get('/tickets/:id', getTicket);
router.post('/tickets', createTicket);

export default router;
