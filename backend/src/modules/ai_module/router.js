import express from 'express';
import { chat } from './service.js';

const router = express.Router();

// Basic in-memory rate limit (per userId or IP) to protect AI endpoint.
const BUCKET_MS = 60_000;
const MAX_PER_BUCKET = 30;
const buckets = new Map();

router.use((req, res, next) => {
  const userId = req.body?.userId ? String(req.body.userId) : '';
  const key = userId || req.ip || 'anon';
  const now = Date.now();
  const b = buckets.get(key) || { count: 0, resetAt: now + BUCKET_MS };
  if (now > b.resetAt) {
    b.count = 0;
    b.resetAt = now + BUCKET_MS;
  }
  b.count += 1;
  buckets.set(key, b);
  if (b.count > MAX_PER_BUCKET) {
    return res.status(429).json({ error: 'Too many requests' });
  }
  return next();
});

router.post('/chat', chat);

export default router;

