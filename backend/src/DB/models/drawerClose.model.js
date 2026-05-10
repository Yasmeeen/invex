import mongoose from 'mongoose';

/**
 * End-of-day cash drawer close for a branch (one record per branch per calendar day).
 */
const drawerCloseSchema = new mongoose.Schema(
  {
    branch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch',
      required: true,
      index: true,
    },
    /** Local calendar day YYYY-MM-DD (client/server agreed; stored as string). */
    businessDate: {
      type: String,
      required: true,
      trim: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
    /** Full computed breakdown at close time (historical snapshot). */
    snapshot: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    expectedCashInDrawer: { type: Number, required: true },
    actualCashCounted: { type: Number, required: true },
    variance: { type: Number, required: true },
    shortageReason: { type: String, default: '', trim: true, maxlength: 2000 },
    closedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
  },
  { timestamps: true }
);

drawerCloseSchema.index({ branch: 1, businessDate: 1 }, { unique: true });

export default mongoose.model('DrawerClose', drawerCloseSchema);
