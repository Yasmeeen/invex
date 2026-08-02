import mongoose from 'mongoose';
import AuditLog from '../../DB/models/auditLog.model.js';
import User from '../../DB/models/user.model.js';
import { buildEntityLabelFromDoc } from './audit.enrich.js';

const toObjectIdOrNull = (v) => {
  const s = String(v || '').trim();
  if (!s) return null;
  return mongoose.Types.ObjectId.isValid(s) ? new mongoose.Types.ObjectId(s) : null;
};

const pickActorUserId = (req) => {
  const body = req?.body || {};
  const query = req?.query || {};
  const headers = req?.headers || {};
  // Support existing patterns across modules (cashier, bookings, purchases, products).
  return (
    body.userId ||
    body.user_id ||
    body.cashierId ||
    body.cashier_id ||
    body.actorUserId ||
    body.actor_user_id ||
    query.userId ||
    query.user_id ||
    query.actorUserId ||
    query.actor_user_id ||
    headers['x-user-id'] ||
    null
  );
};

const safeUserAgent = (req) => String(req?.headers?.['user-agent'] || '').slice(0, 240);

const safeIp = (req) => {
  const xf = req?.headers?.['x-forwarded-for'];
  const ip = Array.isArray(xf) ? xf[0] : String(xf || '').split(',')[0].trim();
  return (ip || req?.ip || req?.connection?.remoteAddress || '').toString().slice(0, 80);
};

const pickStr = (...vals) => {
  for (const v of vals) {
    if (v == null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return '';
};

export async function auditLog(req, payload) {
  try {
    const explicitActorId = toObjectIdOrNull(
      payload?.actorUserId ?? payload?.actor_user_id
    );
    const fromReqId = toObjectIdOrNull(pickActorUserId(req));
    const actorUserId = explicitActorId || fromReqId;

    let actorName = pickStr(payload?.actorName, payload?.actor_name) || undefined;
    let actorRole = pickStr(payload?.actorRole, payload?.actor_role) || undefined;
    let actorBranchId = toObjectIdOrNull(payload?.actorBranchId ?? payload?.actor_branch_id);

    if (actorUserId && (!actorName || !actorRole)) {
      const u = await User.findById(actorUserId).select('name role branch').lean();
      if (u) {
        actorName = actorName || pickStr(u.name) || undefined;
        actorRole = actorRole || pickStr(u.role) || undefined;
        if (!actorBranchId) {
          actorBranchId = toObjectIdOrNull(u.branch?._id || u.branch);
        }
      }
    }

    const entityType = payload?.entityType ? String(payload.entityType) : undefined;
    const entityId = payload?.entityId != null ? String(payload.entityId) : undefined;
    const module = payload?.module ? String(payload.module) : undefined;
    const metadata = payload?.metadata;
    const before = payload?.before;
    const after = payload?.after;
    const message = payload?.message ? String(payload.message) : undefined;

    let entityLabel = pickStr(payload?.entityLabel, payload?.entity_label) || undefined;
    if (!entityLabel) {
      entityLabel =
        buildEntityLabelFromDoc({
          entityType,
          entityId,
          module,
          metadata,
          before,
          after,
          message,
          actorName,
        }) || undefined;
    }

    const doc = {
      actorUserId: actorUserId || undefined,
      actorName,
      actorRole,
      actorBranchId,
      action: String(payload?.action || '').trim() || 'unknown',
      module,
      entityType,
      entityId,
      entityLabel,
      method: req?.method,
      path: req?.originalUrl || req?.url,
      statusCode: payload?.statusCode ?? req?.res?.statusCode,
      ip: safeIp(req),
      userAgent: safeUserAgent(req),
      message,
      metadata,
      before,
      after,
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
