import mongoose from 'mongoose';
import AuditLog from '../../DB/models/auditLog.model.js';
import User from '../../DB/models/user.model.js';

const toDate = (value, fallback) => {
  const d = value ? new Date(value) : fallback;
  if (!d || Number.isNaN(d.getTime())) return fallback;
  return d;
};

const toObjectIdOrNull = (v) => {
  const s = String(v || '').trim();
  if (!s) return null;
  return mongoose.Types.ObjectId.isValid(s) ? new mongoose.Types.ObjectId(s) : null;
};

/** Match DB roles used in the app (sidebar / guards use Super Admin, not Admin). */
const isPrivilegedRole = (role) => {
  const r = String(role || '').trim();
  return r === 'Super Admin' || r === 'Co Admin' || r === 'Admin';
};

/** GET /api/audits?userId=...&from=...&to=...&actorUserId=...&action=...&module=...&entityType=...&entityId=... */
export const listAuditLogs = async (req, res) => {
  try {
    // Basic protection (since no real auth middleware exists): require caller userId & privileged role.
    const callerId = toObjectIdOrNull(req.query.userId || req.query.user_id);
    if (!callerId) return res.status(401).json({ error: 'userId is required' });
    const caller = await User.findById(callerId).select('role').lean();
    if (!caller || !isPrivilegedRole(caller.role)) return res.status(403).json({ error: 'Forbidden' });

    const now = new Date();
    const from = toDate(req.query.from, new Date(now.getFullYear(), now.getMonth(), 1));
    const to = toDate(req.query.to, now);
    to.setHours(23, 59, 59, 999);

    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50));
    const skip = (page - 1) * limit;

    const match = { createdAt: { $gte: from, $lte: to } };
    const actorUserId = toObjectIdOrNull(req.query.actorUserId || req.query.actor_user_id);
    if (actorUserId) match.actorUserId = actorUserId;
    if (req.query.action) match.action = String(req.query.action).trim();
    if (req.query.module) match.module = String(req.query.module).trim();
    if (req.query.entityType) match.entityType = String(req.query.entityType).trim();
    if (req.query.entityId) match.entityId = String(req.query.entityId).trim();

    const [rows, total] = await Promise.all([
      AuditLog.find(match).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      AuditLog.countDocuments(match),
    ]);

    res.json({
      rows,
      meta: {
        page,
        limit,
        totalCount: total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (error) {
    console.error('listAuditLogs:', error);
    res.status(500).json({ error: 'Failed to list audit logs' });
  }
};

