import express from 'express';
import { createDailyExpense, deleteDailyExpense, listDailyExpenses } from './service.js';

const router = express.Router();

router.post('/', createDailyExpense);
router.get('/', listDailyExpenses);
router.delete('/:id', deleteDailyExpense);

export default router;
