import mongoose from 'mongoose';
import Notification from '../../DB/models/notification.model.js';

export const listNotifications = async (req, res) => {
  try {
    const { userId, page = 1, limit = 20 } = req.query;
    if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) {
      return res.status(400).json({ error: 'userId is required' });
    }
    const p = Math.max(1, Number(page) || 1);
    const lim = Math.max(1, Math.min(50, Number(limit) || 20));
    const skip = (p - 1) * lim;

    const query = { recipients: new mongoose.Types.ObjectId(String(userId)) };

    const [items, total] = await Promise.all([
      Notification.find(query).sort({ createdAt: -1 }).skip(skip).limit(lim).lean(),
      Notification.countDocuments(query),
    ]);

    return res.json({
      notifications: items,
      meta: { totalCount: total, page: p, limit: lim },
    });
  } catch (e) {
    console.error('listNotifications:', e);
    return res.status(500).json({ error: 'Failed to fetch notifications' });
  }
};

export const getUnreadCount = async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) {
      return res.status(400).json({ error: 'userId is required' });
    }
    const uid = new mongoose.Types.ObjectId(String(userId));
    const count = await Notification.countDocuments({
      recipients: uid,
      readBy: { $ne: uid },
    });
    return res.json({ unreadCount: count });
  } catch (e) {
    console.error('getUnreadCount:', e);
    return res.status(500).json({ error: 'Failed to fetch unread count' });
  }
};

export const markNotificationRead = async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.body;
    if (!mongoose.Types.ObjectId.isValid(String(id))) {
      return res.status(400).json({ error: 'Invalid notification id' });
    }
    if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) {
      return res.status(400).json({ error: 'userId is required' });
    }
    const uid = new mongoose.Types.ObjectId(String(userId));
    const n = await Notification.findOneAndUpdate(
      { _id: id, recipients: uid },
      { $addToSet: { readBy: uid } },
      { new: true }
    ).lean();
    if (!n) {
      return res.status(404).json({ error: 'Notification not found' });
    }
    return res.json({ ok: true, notification: n });
  } catch (e) {
    console.error('markNotificationRead:', e);
    return res.status(500).json({ error: 'Failed to mark notification read' });
  }
};

export const markAllRead = async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) {
      return res.status(400).json({ error: 'userId is required' });
    }
    const uid = new mongoose.Types.ObjectId(String(userId));
    const r = await Notification.updateMany(
      { recipients: uid, readBy: { $ne: uid } },
      { $addToSet: { readBy: uid } }
    );
    return res.json({ ok: true, modifiedCount: r.modifiedCount || 0 });
  } catch (e) {
    console.error('markAllRead:', e);
    return res.status(500).json({ error: 'Failed to mark all read' });
  }
};

