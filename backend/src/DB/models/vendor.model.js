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
            enum: ['cash', 'Installments', 'Deferred'],
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

    /**
     * Prepaid balance we paid the supplier (for purchasing FROM them).
     * Increased by vendor deposit (outflow); reduced by settlement / purchases.
     */
    creditBalance: { type: Number, default: 0, min: 0 },

    /**
     * Prepaid balance the supplier paid us (for selling TO them).
     * Increased by received deposit (inflow); reduced by settlement / sales.
     */
    buyerPrepaidBalance: { type: Number, default: 0, min: 0 },

    /**
     * Opening debit: supplier owes us from pre-system credit sales (مبيعات آجل قبل النظام).
     * Set once at onboarding; reduced by payments or balance settlement.
     */
    openingDebitBalance: { type: Number, default: 0, min: 0 },

    /** Audit trail: deposits, settlements, order payments. */
    ledgerEntries: [
      {
        type: {
          type: String,
          enum: [
            'deposit',
            'received_deposit',
            'settlement',
            'order_payment',
            'opening_debit',
            'opening_debit_payment',
            'purchase',
            'purchase_installment_paid',
            'purchase_deferred',
            'purchase_deferred_paid',
          ],
          required: true,
        },
        amount: { type: Number, required: true, min: 0 },
        orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: false },
        orderNumber: { type: Number, required: false },
        purchasingRequestId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'PurchasingRequest',
          required: false,
        },
        note: { type: String, default: '', trim: true },
        /** When true, amount left the physical cash drawer (see vendor-cash-drawer utils). */
        affectsCashDrawer: { type: Boolean, default: false },
        branch: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Branch',
          required: false,
        },
        createdAt: { type: Date, default: Date.now },
        createdByUserId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
          required: false,
        },
      },
    ],
  },
  {
    timestamps: true,
  }
);

vendorSchema.index({ 'ledgerEntries.branch': 1, 'ledgerEntries.createdAt': -1 });

// ✅ Auto-clear installments if paymentTerms = "cash"
vendorSchema.pre('save', function (next) {
  if (this.paymentTerms !== 'Installments') {
    this.installments = [];
  }
  next();
});

const Vendor = mongoose.model('Vendor', vendorSchema);
export default Vendor;
