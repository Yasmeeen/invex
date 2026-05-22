// DB/models/purchasingRequest.model.js
import mongoose from 'mongoose';

// 🔹 Sub-schema for installments
const installmentSchema = new mongoose.Schema(
  {
    dueDate: { type: Date, required: true },
    amount: { type: Number, required: true },
    paid: { type: Boolean, default: false },
  }
);

const paymentTreasurySplitSchema = new mongoose.Schema(
  {
    key: { type: String, trim: true, required: true },
    label: { type: String, trim: true, default: '' },
    amount: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const deferredPaymentRecordSchema = new mongoose.Schema(
  {
    amount: { type: Number, required: true, min: 0 },
    paidAt: { type: Date, default: Date.now },
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false },
    paymentTreasuryKey: { type: String, trim: true, default: 'cash' },
    paymentTreasuryLabel: { type: String, trim: true, default: '' },
    paymentTreasurySplits: { type: [paymentTreasurySplitSchema], default: undefined },
    note: { type: String, trim: true, default: '' },
  },
  { _id: true }
);

const purchasingRequestSchema = new mongoose.Schema(
  {
    supplier: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Vendor',
      required: true,
    },
    requestDate: {
      type: Date,
      required: true,
      default: Date.now,
    },
    requestedBy: {
      type: String,
      required: false,
      trim: true,
    },
    status: {
      type: String,
      enum: ['Received', 'Pending', 'Ordered'],
      required: true,
    },
    paymentStatus: {
      type: String,
      enum: ['cash', 'Installments', 'Deferred'],
      required: true,
    },
    installments: [installmentSchema],
    /** For Deferred: amount we have paid the supplier so far. */
    amountPaid: { type: Number, default: 0, min: 0 },
    /** Payment installments on deferred balance (treasury splits per payment). */
    deferredPayments: { type: [deferredPaymentRecordSchema], default: undefined },
    totalAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    notes: {
      type: String,
      trim: true,
      required: false,
    },
    products: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
      },
    ],
  },
  {
    timestamps: true,
  }
);

purchasingRequestSchema.pre('save', function (next) {
  if (this.paymentStatus !== 'Installments') {
    this.installments = [];
  }
  next();
});

const PurchasingRequest = mongoose.model('PurchasingRequest', purchasingRequestSchema);
export default PurchasingRequest;
