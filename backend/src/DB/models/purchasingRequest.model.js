import mongoose from 'mongoose';

// 🔹 Sub-schema for installments
const installmentSchema = new mongoose.Schema(
  {
    dueDate: { type: Date, required: true },
    amount: { type: Number, required: true },
    paid: { type: Boolean, default: false },
  },
  { _id: false }
);

const purchasingRequestSchema = new mongoose.Schema(
  {
    supplier: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Vendor',
      required: true,
    },
    purchasingDate: {
      type: Date,
      required: true,
      default: Date.now,
    },
    status: {
        type: String,
        enum: ['Received', 'Pending', 'Ordered'],
        required: true,
      },
    paymentTerms: [
      {
        type: String,
        enum: ['cash', 'Installments'],
        required: true,
      },
    ],
    installments: [installmentSchema],
    purchasingDetails: {
      type: String,
      trim: true,
    },
    paymentStatus: {
        type: String,
        enum: ['Paid', 'Due'],
        default: 'Due',
      },
    totalAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    products: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
        required: false,
      },
    ],
  },
  {
    timestamps: true,
  }
);

const PurchasingRequest = mongoose.model('PurchasingRequest', purchasingRequestSchema);
export default PurchasingRequest;
