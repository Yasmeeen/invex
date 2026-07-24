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
 * Cash received into the physical drawer from client prepaid deposits.
 */
const clientCashDrawerReceiptSchema = new mongoose.Schema(
  {
    branch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch',
      required: true,
      index: true,
    },
    client: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Client',
      required: true,
      index: true,
    },
    amount: { type: Number, required: true, min: 0 },
    paymentType: {
      type: String,
      enum: ['deposit', 'booking_deposit'],
      required: true,
      default: 'deposit',
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

clientCashDrawerReceiptSchema.index({ branch: 1, createdAt: -1 });

export default mongoose.model('ClientCashDrawerReceipt', clientCashDrawerReceiptSchema);
