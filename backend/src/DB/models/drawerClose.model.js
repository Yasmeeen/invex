import mongoose from 'mongoose';

const CASH_DISPOSITIONS = ['deposit_all', 'retain_all', 'retain_partial'];

/**
 * End-of-day cash drawer close for a branch (one record per close period).
 */
const drawerCloseSchema = new mongoose.Schema(
  {
    branch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch',
      required: true,
      index: true,
    },
    /** Last calendar day included in this close (YYYY-MM-DD). */
    businessDate: {
      type: String,
      required: true,
      trim: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
    /** First calendar day included (equals businessDate for single-day closes). */
    periodStartDate: {
      type: String,
      required: true,
      trim: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
    /** Last calendar day included (equals businessDate). */
    periodEndDate: {
      type: String,
      required: true,
      trim: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
    /** Cash carried over from previous close (retained in drawer). */
    openingCashBalance: { type: Number, required: true, default: 0 },
    /** Net cash movements during the period (excludes opening balance). */
    periodNetCashMovements: { type: Number, required: true },
    /** Full computed breakdown at close time (historical snapshot). */
    snapshot: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    expectedCashInDrawer: { type: Number, required: true },
    actualCashCounted: { type: Number, required: true },
    variance: { type: Number, required: true },
    shortageReason: { type: String, default: '', trim: true, maxlength: 2000 },
    cashDisposition: {
      type: String,
      enum: CASH_DISPOSITIONS,
      required: true,
      default: 'deposit_all',
    },
    /** Amount left in physical drawer for next period. */
    retainedCash: { type: Number, required: true, default: 0 },
    /** Amount removed from drawer (to safe/treasury). */
    depositedCash: { type: Number, required: true, default: 0 },
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
drawerCloseSchema.index({ branch: 1, periodStartDate: 1, periodEndDate: 1 });

export default mongoose.model('DrawerClose', drawerCloseSchema);
