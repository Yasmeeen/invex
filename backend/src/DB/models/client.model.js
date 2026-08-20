import mongoose from "mongoose";

const clientSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    phoneNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    /** Extra phones (optional). Primary stays in phoneNumber for cashier lookup. */
    additionalPhoneNumbers: {
      type: [String],
      default: [],
    },

    address: {
      type: String,
      trim: true,
    },

    /** Extra addresses (optional). Primary stays in address. */
    additionalAddresses: {
      type: [String],
      default: [],
    },

    /** Client national ID / card image URL (optional). */
    nationalIdImageUrl: {
      type: String,
      trim: true,
      default: "",
    },

    /** Guarantor details (optional) — shown in a separate UI tab. */
    guarantor: {
      name: { type: String, trim: true, default: "" },
      phoneNumber: { type: String, trim: true, default: "" },
      nationalId: { type: String, trim: true, default: "" },
      address: { type: String, trim: true, default: "" },
      nationalIdImageUrl: { type: String, trim: true, default: "" },
      notes: { type: String, trim: true, default: "" },
    },

    /** Collector assigned to follow up installments (optional). */
    collectorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
      default: null,
    },

    branches: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Branch",
      },
    ],

    /** Prepaid balance the client holds with us (we owe them goods / credit). */
    creditBalance: { type: Number, default: 0, min: 0 },

    /**
     * Opening debit: client owes us from pre-system credit sales (بيع بالآجل قبل النظام).
     */
    openingDebitBalance: { type: Number, default: 0, min: 0 },

    /** Audit trail: deposits, opening debit, settlements. */
    ledgerEntries: [
      {
        type: {
          type: String,
          enum: ["deposit", "opening_debit", "opening_debit_payment", "settlement", "payout"],
          required: true,
        },
        amount: { type: Number, required: true, min: 0 },
        paymentMethod: { type: String, default: "", trim: true },
        note: { type: String, default: "", trim: true },
        affectsCashDrawer: { type: Boolean, default: false },
        branch: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Branch",
          required: false,
        },
        createdAt: { type: Date, default: Date.now },
        createdByUserId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: false,
        },
      },
    ],
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtuals (filled via aggregation)
clientSchema.virtual("numberOfOrders").get(function () {
  return this._doc.numberOfOrders || 0;
});

clientSchema.virtual("totalOrdersPrice").get(function () {
  return this._doc.totalOrdersPrice || 0;
});

export default mongoose.model("Client", clientSchema);
