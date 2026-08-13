import express from 'express';
import {
  listTreasuryAccounts,
  getTreasuryAccount,
  listRecentLedger,
  listAccountLedger,
  createTreasuryTransfer,
  setAccountOpeningBalance,
  settleSettlementAccount,
} from './service.js';

const router = express.Router();

router.get('/accounts', listTreasuryAccounts);
router.get('/recent', listRecentLedger);
router.get('/accounts/:key', getTreasuryAccount);
router.get('/accounts/:key/ledger', listAccountLedger);
router.post('/accounts/:key/opening-balance', setAccountOpeningBalance);
router.post('/accounts/:key/settle', settleSettlementAccount);
router.post('/transfers', createTreasuryTransfer);

export default router;
