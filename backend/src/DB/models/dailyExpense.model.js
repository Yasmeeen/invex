import mongoose from 'mongoose';

/**
 * Cash-desk daily expense (amount leaves drawer — future inventory «جرد» may reconcile against this).
 */
const dailyExpenseSchema = new mongoose.Schema(
  {
    branch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch',
      required: true,
      index: true,
    },
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
  },
  { timestamps: true }
);

dailyExpenseSchema.index({ branch: 1, createdAt: -1 });

export default mongoose.model('DailyExpense', dailyExpenseSchema);
