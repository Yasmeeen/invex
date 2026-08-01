import express from 'express';
import {
  listTreasuryAccounts,
  getTreasuryAccount,
  listAccountLedger,
  createTreasuryTransfer,
  setAccountOpeningBalance,
} from './service.js';

const router = express.Router();

router.get('/accounts', listTreasuryAccounts);
router.get('/accounts/:key', getTreasuryAccount);
router.get('/accounts/:key/ledger', listAccountLedger);
router.post('/accounts/:key/opening-balance', setAccountOpeningBalance);
router.post('/transfers', createTreasuryTransfer);

export default router;
