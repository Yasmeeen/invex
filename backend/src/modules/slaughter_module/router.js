import express from 'express';
import {
  listTemplates,
  upsertTemplate,
  listTickets,
  getTicket,
  createTicket,
} from './service.js';

const router = express.Router();

router.get('/templates', listTemplates);
router.put('/templates', upsertTemplate);
router.get('/tickets', listTickets);
router.get('/tickets/:id', getTicket);
router.post('/tickets', createTicket);

export default router;
