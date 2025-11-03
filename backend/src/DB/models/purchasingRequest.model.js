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
      enum: ['cash', 'Installments'],
      required: true,
    },
    installments: [installmentSchema],
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

const PurchasingRequest = mongoose.model('PurchasingRequest', purchasingRequestSchema);
export default PurchasingRequest;
