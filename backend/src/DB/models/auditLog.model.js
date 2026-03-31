import mongoose from 'mongoose';

const auditLogSchema = new mongoose.Schema(
  {
    // Who
    actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false, index: true },
    actorName: { type: String, required: false, trim: true },
    actorRole: { type: String, required: false, trim: true },
    actorBranchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: false, index: true },

    // What
    action: {
      type: String,
      required: true,
      trim: true,
      index: true,
      // examples: create/update/delete/status_change/login/logout/confirm/cancel/transfer_stock
    },
    module: { type: String, required: false, trim: true, index: true }, // e.g. products, orders, users, bookings
    entityType: { type: String, required: false, trim: true, index: true }, // e.g. Product, Order
    entityId: { type: String, required: false, trim: true, index: true }, // store as string for flexibility

    // Request context
    method: { type: String, required: false, trim: true },
    path: { type: String, required: false, trim: true },
    statusCode: { type: Number, required: false },
    ip: { type: String, required: false, trim: true },
    userAgent: { type: String, required: false, trim: true },

    // Extra details
    message: { type: String, required: false, trim: true },
    metadata: { type: mongoose.Schema.Types.Mixed, required: false },

    // Change tracking (optional; keep small)
    before: { type: mongoose.Schema.Types.Mixed, required: false },
    after: { type: mongoose.Schema.Types.Mixed, required: false },
  },
  { timestamps: true }
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ actorUserId: 1, createdAt: -1 });
auditLogSchema.index({ module: 1, createdAt: -1 });
auditLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });

const AuditLog = mongoose.model('AuditLog', auditLogSchema);
export default AuditLog;

