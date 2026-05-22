import mongoose from 'mongoose';

const paymentTreasurySplitSchema = new mongoose.Schema(
  {
    key: { type: String, trim: true, required: true },
    label: { type: String, trim: true, default: '' },
    amount: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

/**
 * Cash that left the physical drawer for supplier payments (deposit / deferred / installment).
 * Mirrors DailyExpense — branch + date are required for drawer-close reconciliation.
 */
const vendorCashDrawerPaymentSchema = new mongoose.Schema(
  {
    branch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch',
      required: true,
      index: true,
    },
    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Vendor',
      required: true,
      index: true,
    },
    amount: { type: Number, required: true, min: 0 },
    paymentType: {
      type: String,
      enum: ['deposit', 'purchase_deferred_paid', 'purchase_installment_paid'],
      required: true,
    },
    purchasingRequestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PurchasingRequest',
      required: false,
    },
    note: { type: String, default: '', trim: true, maxlength: 500 },
    /** Full payment breakdown when only cash portion hits drawer (audit). */
    paymentTreasurySplits: { type: [paymentTreasurySplitSchema], default: undefined },
    recordedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: false,
    },
  },
  { timestamps: true }
);

vendorCashDrawerPaymentSchema.index({ branch: 1, createdAt: -1 });

export default mongoose.model('VendorCashDrawerPayment', vendorCashDrawerPaymentSchema);
