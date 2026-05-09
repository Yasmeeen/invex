import mongoose from "mongoose";

const orderSchema = new mongoose.Schema(
  {
    clientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Client",
    },

    clientName: { type: String, required: false, trim: true },
    clientPhoneNumber: { type: String, required: true, trim: true },
    clientAddress: { type: String, required: false, trim: true },

    sellerName: { type: String, trim: true },
    paymentMethod: { type: String, required: false, trim: true ,  default: "cash"},

    branch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
    },

    numberOfProducts: { type: Number, min: 0 },
    /** Sum of line totals (after per-item product discounts), before invoice-level extra discount. */
    subtotalPrice: { type: Number, min: 0 },
    /**
     * Invoice-level adjustment at cashier (same currency as total).
     * Positive = extra discount; negative = surcharge (final total above subtotal).
     */
    invoiceDiscountAmount: { type: Number, default: 0 },
    /** Amount due after all discounts (unchanged meaning for reports). */
    totalPrice: { type: Number, min: 0 },

    /**
     * Cashier exchange / trade-in: purchase credit applied toward this sale (EGP).
     * Payment validation uses (totalPrice − appliedCredit); totalPrice stays gross sale.
     */
    exchangeTradeInCreditAmount: { type: Number, default: 0, min: 0 },
    exchangeProductPurchaseRequestId: {
      type: mongoose.Schema.Types.ObjectId,
      required: false,
      ref: 'ProductPurchaseRequest',
    },

    /** Credit (بيع بالآجل): track partial payments until fully settled. */
    amountPaid: { type: Number, min: 0, default: 0 },
    paymentStatus: {
      type: String,
      enum: ['unpaid', 'partial', 'paid'],
      default: 'paid',
      trim: true,
    },
    payments: [
      {
        amount: { type: Number, required: true, min: 0 },
        paidAt: { type: Date, required: true },
        paidByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false },
        /** cash, visa, aman, … (split checkout / follow-up payments). */
        method: { type: String, required: false, trim: true },
        note: { type: String, default: '', trim: true },
      },
    ],

    products: [
      {
        productId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Product",
          required: true,
        },
        name: { type: String, required: true },
        code: { type: String, required: true },
        quantity: { type: Number, required: true },
        price: { type: Number, required: true },
        /** Snapshot item cost at time of sale (for profit reports). */
        cost: { type: Number, required: false, default: 0, min: 0 },
        isApplyDiscount: { type: Boolean, default: false },
        /** Snapshot: category attributes flagged showOnInvoice (label + value). */
        invoiceAttributes: {
          type: [
            {
              label: { type: String, trim: true },
              value: { type: String, trim: true },
            },
          ],
          default: undefined,
        },
      },
    ],

    status: {
      type: String,
      enum: ["completed", "restored"],
      default: "completed",
    },

    orderNumber: { type: Number, unique: true, required: true },
  },
  { timestamps: true }
);

const Order = mongoose.model("Order", orderSchema);
export default Order;
