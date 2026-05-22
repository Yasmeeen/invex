import mongoose from 'mongoose';

const expenseTreasurySplitSchema = new mongoose.Schema(
  {
    key: { type: String, trim: true, required: true },
    label: { type: String, trim: true, default: '' },
    amount: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

/**
 * Cash-desk daily expense (amount leaves configured treasury; cash bucket hits drawer close).
 */
const dailyExpenseSchema = new mongoose.Schema(
  {
    branch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch',
      required: true,
      index: true,
    },
    /** Total = sum of expenseTreasurySplits amounts. */
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    expenseType: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    notes: {
      type: String,
      default: '',
      trim: true,
      maxlength: 2000,
    },
    recordedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    /** Summary key: cash | mixed | bank_* (legacy / reports). */
    expenseTreasuryKey: { type: String, trim: true, default: 'cash', index: true },
    expenseTreasuryLabel: { type: String, trim: true, default: '' },
    /** Which treasuries paid this expense: [{ key, label, amount }]. */
    expenseTreasurySplits: { type: [expenseTreasurySplitSchema], default: undefined },
  },
  { timestamps: true }
);

dailyExpenseSchema.index({ branch: 1, createdAt: -1 });

export default mongoose.model('DailyExpense', dailyExpenseSchema);
