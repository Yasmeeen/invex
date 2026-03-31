import express from 'express';
import { listAuditLogs } from './service.js';

const router = express.Router();

router.get('/', listAuditLogs);

export default router;

