import mongoose from 'mongoose';

// 🔹 Sub-schema for installments (embedded inside Vendor)
const installmentSchema = new mongoose.Schema(
  {
    dueDate: { type: Date, required: true },
    amount: { type: Number, required: true },
    paid: { type: Boolean, default: false },
  },
  { _id: false }
);

const vendorSchema = new mongoose.Schema(
  {
    nameOfcompany: {
      type: String,
      required: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    address: {
        type: String,
        required: false,
        trim: true,
      },
      phone: {
        type: String,
        required: true,
        trim: true,
      },
    email: {
      type: String,
      required: false,
      trim: true,
    },
    transactionCurrency: {
      type: String,
      default: 'EGP',
      required: false,
      trim: true,
    },
    paymentTerms: [
        {
            type: String,
            enum: ['cash', 'Installments'], // ✅ Adjusted to lowercase "cash"
            required: true,
          }
    ] ,

    // 🔹 Allow multiple categories instead of one
    categories: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Category',
        required: true,
      },
    ],
  },
  {
    timestamps: true,
  }
);

// ✅ Auto-clear installments if paymentTerms = "cash"
vendorSchema.pre('save', function (next) {
  if (this.paymentTerms !== 'Installments') {
    this.installments = [];
  }
  next();
});

const Vendor = mongoose.model('Vendor', vendorSchema);
export default Vendor;
