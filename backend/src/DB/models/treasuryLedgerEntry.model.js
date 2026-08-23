import mongoose from 'mongoose';

const SOURCE_TYPES = [
  'order_payment',
  'order_refund',
  'client_deposit',
  'client_payout',
  'booking_deposit',
  'vendor_payment',
  'vendor_receipt',
  'desk_purchase',
  'purchase_return',
  'daily_expense',
  'transfer',
  'settlement',
  'deposit',
  'drawer_close',
  'drawer_variance',
  'opening',
  'other',
];

/**
 * Single-sided money-account ledger line.
 * Transfers write two rows (out + in) sharing the same transferGroupId.
 */
const treasuryLedgerEntrySchema = new mongoose.Schema(
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
      index: true,
    },
    direction: {
      type: String,
      enum: ['in', 'out'],
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    occurredAt: {
      type: Date,
      required: true,
      default: Date.now,
      index: true,
    },
    /** Business calendar day Africa/Cairo YYYY-MM-DD */
    businessDate: {
      type: String,
      required: true,
      trim: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
    sourceType: {
      type: String,
      enum: SOURCE_TYPES,
      required: true,
      default: 'other',
    },
    sourceId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    /** Opposite account for transfers / settlements. */
    counterAccountKey: {
      type: String,
      trim: true,
      maxlength: 40,
      default: '',
    },
    /** Links the two sides of a transfer. */
    transferGroupId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true,
    },
    note: {
      type: String,
      default: '',
      trim: true,
      maxlength: 2000,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true, collection: 'treasuryledgerentries' }
);

treasuryLedgerEntrySchema.index({ branch: 1, accountKey: 1, occurredAt: -1 });
treasuryLedgerEntrySchema.index({ accountKey: 1, occurredAt: -1 });
treasuryLedgerEntrySchema.index({ sourceType: 1, sourceId: 1 });
treasuryLedgerEntrySchema.index({ branch: 1, businessDate: 1, accountKey: 1 });

export const TREASURY_LEDGER_SOURCE_TYPES = SOURCE_TYPES;

export default mongoose.model('TreasuryLedgerEntry', treasuryLedgerEntrySchema);
