import express from 'express';
import {
  listNotifications,
  getUnreadCount,
  markNotificationRead,
  markAllRead,
} from './service.js';

const router = express.Router();

router.get('/', listNotifications);
router.get('/unread-count', getUnreadCount);
router.patch('/:id/read', markNotificationRead);
router.patch('/read-all', markAllRead);

export default router;

