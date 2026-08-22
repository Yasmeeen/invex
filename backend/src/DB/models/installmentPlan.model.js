import mongoose from "mongoose";

/**
 * Sale installment plans (customer financing), e.g. 6 / 12 / 24 months.
 * Separate from cashier payment methods (cash, visa, …).
 */
const installmentPlanSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    /** Number of monthly installments. */
    months: {
      type: Number,
      required: true,
      min: 1,
      max: 120,
    },
    /**
     * Interest / markup percent applied on the financed (installment) portion.
     * Example: 10 → total due = principal * (1 + 0.10).
     */
    interestPercent: {
      type: Number,
      required: true,
      min: 0,
      max: 500,
      default: 0,
    },
    enabled: {
      type: Boolean,
      default: true,
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

installmentPlanSchema.index({ enabled: 1, sortOrder: 1, months: 1 });

export default mongoose.model("InstallmentPlan", installmentPlanSchema);
