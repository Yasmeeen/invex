import express from 'express';
import {
  listMoneyAccounts,
  createMoneyAccount,
  updateMoneyAccount,
  deleteMoneyAccount,
} from './service.js';

const router = express.Router();

router.get('/', listMoneyAccounts);
router.post('/', createMoneyAccount);
router.put('/:key', updateMoneyAccount);
router.delete('/:key', deleteMoneyAccount);

export default router;
