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
 * Cash received into the physical drawer from supplier prepaid deposits (supplier paid us).
 */
const vendorCashDrawerReceiptSchema = new mongoose.Schema(
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
      enum: ['received_deposit', 'opening_debit_payment'],
      required: true,
      default: 'received_deposit',
    },
    note: { type: String, default: '', trim: true, maxlength: 500 },
    paymentTreasurySplits: { type: [paymentTreasurySplitSchema], default: undefined },
    recordedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: false,
    },
  },
  { timestamps: true }
);

vendorCashDrawerReceiptSchema.index({ branch: 1, createdAt: -1 });

export default mongoose.model('VendorCashDrawerReceipt', vendorCashDrawerReceiptSchema);
