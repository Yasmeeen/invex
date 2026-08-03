import mongoose from 'mongoose';
import AuditLog from '../../DB/models/auditLog.model.js';
import User from '../../DB/models/user.model.js';
import { enrichAuditRows } from './audit.enrich.js';

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

/** GET /api/audits?userId=...&from=...&to=...&actorUserId=...&actorName=...&action=...&module=...&entityType=...&entityId=...&q=... */
export const listAuditLogs = async (req, res) => {
  try {
    // Basic protection (since no real auth middleware exists): require caller userId & privileged role.
    const callerId = toObjectIdOrNull(req.query.userId || req.query.user_id);
    if (!callerId) return res.status(401).json({ error: 'userId is required' });
    const caller = await User.findById(callerId).select('role').lean();
    if (!caller || !isPrivilegedRole(caller.role)) return res.status(403).json({ error: 'Forbidden' });

    const now = new Date();
    const allDates =
      String(req.query.allDates || req.query.all_dates || '').trim() === '1';
    const hasFrom = String(req.query.from || '').trim() !== '';
    const hasTo = String(req.query.to || '').trim() !== '';

    // allDates / both empty → no createdAt filter (full history).
    // Never silently fall back to "current month" when dates are cleared.
    let from = null;
    let to = null;
    if (!allDates && (hasFrom || hasTo)) {
      from = hasFrom ? toDate(req.query.from, null) : null;
      to = hasTo ? toDate(req.query.to, null) : null;
      if (to) to.setHours(23, 59, 59, 999);
    }

    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50));
    const skip = (page - 1) * limit;

    const match = {};
    if (from || to) {
      match.createdAt = {};
      if (from) match.createdAt.$gte = from;
      if (to) match.createdAt.$lte = to;
      else match.createdAt.$lte = now;
    }
    const actorUserId = toObjectIdOrNull(req.query.actorUserId || req.query.actor_user_id);
    if (actorUserId) match.actorUserId = actorUserId;

    const actorName = String(req.query.actorName || req.query.actor_name || '').trim();
    if (actorName) {
      match.actorName = { $regex: actorName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    }

    if (req.query.action) match.action = String(req.query.action).trim();
    if (req.query.module) match.module = String(req.query.module).trim();
    if (req.query.entityType) match.entityType = String(req.query.entityType).trim();

    const entityId = String(req.query.entityId || req.query.entity_id || '').trim();
    const q = String(req.query.q || req.query.search || '').trim();

    if (entityId && !q) {
      // Allow filtering by Mongo id, order number, product code, or stored label
      const or = [
        { entityId },
        { entityLabel: { $regex: entityId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
        { 'metadata.orderNumber': Number.isFinite(Number(entityId)) ? Number(entityId) : entityId },
        { 'metadata.productCode': { $regex: entityId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
        { message: { $regex: entityId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
      ];
      match.$or = or;
    }

    if (q) {
      const safe = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const or = [
        { actorName: { $regex: safe, $options: 'i' } },
        { entityLabel: { $regex: safe, $options: 'i' } },
        { message: { $regex: safe, $options: 'i' } },
        { entityId: q },
        { 'metadata.productCode': { $regex: safe, $options: 'i' } },
        { 'metadata.productName': { $regex: safe, $options: 'i' } },
      ];
      if (Number.isFinite(Number(q))) {
        or.push({ 'metadata.orderNumber': Number(q) });
      }
      match.$and = [...(match.$and || []), { $or: or }];
    }

    const [rows, total] = await Promise.all([
      AuditLog.find(match).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      AuditLog.countDocuments(match),
    ]);

    const enriched = await enrichAuditRows(rows);

    res.json({
      rows: enriched,
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
