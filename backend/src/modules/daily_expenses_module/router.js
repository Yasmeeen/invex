import express from 'express';
import { createDailyExpense, listDailyExpenses } from './service.js';

const router = express.Router();

router.post('/', createDailyExpense);
router.get('/', listDailyExpenses);

export default router;
