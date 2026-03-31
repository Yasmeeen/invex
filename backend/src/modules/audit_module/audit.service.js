import mongoose from 'mongoose';
import AuditLog from '../../DB/models/auditLog.model.js';
import User from '../../DB/models/user.model.js';

const toObjectIdOrNull = (v) => {
  const s = String(v || '').trim();
  if (!s) return null;
  return mongoose.Types.ObjectId.isValid(s) ? new mongoose.Types.ObjectId(s) : null;
};

const pickActorUserId = (req) => {
  const body = req?.body || {};
  const query = req?.query || {};
  const headers = req?.headers || {};
  // Support existing patterns: many calls send { userId } in body.
  return body.userId || body.user_id || query.userId || query.user_id || headers['x-user-id'] || null;
};

const safeUserAgent = (req) => String(req?.headers?.['user-agent'] || '').slice(0, 240);

const safeIp = (req) => {
  const xf = req?.headers?.['x-forwarded-for'];
  const ip = Array.isArray(xf) ? xf[0] : String(xf || '').split(',')[0].trim();
  return (ip || req?.ip || req?.connection?.remoteAddress || '').toString().slice(0, 80);
};

export async function auditLog(req, payload) {
  try {
    const explicitActorId = toObjectIdOrNull(
      payload?.actorUserId ?? payload?.actor_user_id
    );
    const fromReqId = toObjectIdOrNull(pickActorUserId(req));
    const actorUserId = explicitActorId || fromReqId;

    let actorName = payload?.actorName ?? payload?.actor_name;
    let actorRole = payload?.actorRole ?? payload?.actor_role;
    let actorBranchId = toObjectIdOrNull(payload?.actorBranchId ?? payload?.actor_branch_id);

    if (actorUserId && (!actorName || !actorRole)) {
      const u = await User.findById(actorUserId).select('name role branch').lean();
      if (u) {
        actorName = actorName || u.name;
        actorRole = actorRole || u.role;
        if (!actorBranchId) {
          actorBranchId = toObjectIdOrNull(u.branch?._id || u.branch);
        }
      }
    }

    const doc = {
      actorUserId: actorUserId || undefined,
      actorName,
      actorRole,
      actorBranchId,
      action: String(payload?.action || '').trim() || 'unknown',
      module: payload?.module ? String(payload.module) : undefined,
      entityType: payload?.entityType ? String(payload.entityType) : undefined,
      entityId: payload?.entityId != null ? String(payload.entityId) : undefined,
      method: req?.method,
      path: req?.originalUrl || req?.url,
      statusCode: payload?.statusCode ?? req?.res?.statusCode,
      ip: safeIp(req),
      userAgent: safeUserAgent(req),
      message: payload?.message ? String(payload.message) : undefined,
      metadata: payload?.metadata,
      before: payload?.before,
      after: payload?.after,
    };

    await AuditLog.create(doc);
  } catch (e) {
    // Never block business flow on audit failure.
    console.error('auditLog:', e?.message || e);
  }
}

export function auditAction(action, module) {
  return (req, _res, next) => {
    req.audit = req.audit || {};
    req.audit.action = action;
    req.audit.module = module;
    next();
  };
}

