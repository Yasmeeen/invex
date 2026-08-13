import mongoose from 'mongoose';

/**
 * Opening balance per branch + account (set once at feature activation / reset).
 * Expected balance = opening.amount + Σ ledger in − Σ ledger out (after opening.asOfDate exclusive,
 * or all ledger rows if asOfDate is null — v1 uses all ledger rows after opening.createdAt conceptually;
 * we treat opening as the baseline and sum ALL ledger entries for the account/branch).
 */
const treasuryAccountOpeningSchema = new mongoose.Schema(
  {
    branch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch',
      required: true,
      index: true,
    },
    accountKey: {
      type: String,
      required: true,
      trim: true,
      maxlength: 40,
    },
    amount: {
      type: Number,
      required: true,
      default: 0,
    },
    /** Optional note from admin when setting opening. */
    note: {
      type: String,
      default: '',
      trim: true,
      maxlength: 500,
    },
    setBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true, collection: 'treasuryaccountopenings' }
);

treasuryAccountOpeningSchema.index({ branch: 1, accountKey: 1 }, { unique: true });

export default mongoose.model('TreasuryAccountOpening', treasuryAccountOpeningSchema);
