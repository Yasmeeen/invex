import mongoose from "mongoose";

const orderSchema = new mongoose.Schema(
  {
    /** Sale counterparty: retail client (default) or supplier buying from the store. */
    partyType: {
      type: String,
      enum: ["client", "supplier"],
      default: "client",
      trim: true,
    },

    clientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Client",
    },

    /**
     * Collector assigned to this installment invoice (optional).
     * Overrides Client.collectorId when set; used for per-invoice distribution.
     */
    collectorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
      default: null,
    },

    vendorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vendor",
      required: false,
    },

    clientName: { type: String, required: false, trim: true },
    clientPhoneNumber: { type: String, required: true, trim: true },
    clientAddress: { type: String, required: false, trim: true },

    sellerName: { type: String, trim: true },

    /** Cashier delivery invoice (optional delivery person). */
    isDelivery: { type: Boolean, default: false },
    deliveryPersonName: { type: String, trim: true },

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

    /** بيع بالآجل: % added onto the credit (unpaid) portion at checkout. */
    creditFeePercent: { type: Number, default: 0, min: 0 },
    /** Snapshot of that markup in EGP (already included in line prices / totalPrice). */
    creditFeeAmount: { type: Number, default: 0, min: 0 },

    /**
     * Cashier exchange / trade-in: purchase credit applied toward this sale (EGP).
     * Payment validation uses (totalPrice − appliedCredit); totalPrice stays gross sale.
     */
    exchangeTradeInCreditAmount: { type: Number, default: 0, min: 0 },
    /** @deprecated Prefer exchangeProductPurchaseRequestIds; kept as first trade-in for older clients. */
    exchangeProductPurchaseRequestId: {
      type: mongoose.Schema.Types.ObjectId,
      required: false,
      ref: 'ProductPurchaseRequest',
    },
    /** Cashier exchange: one or more trade-in purchase intakes linked to this sale. */
    exchangeProductPurchaseRequestIds: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'ProductPurchaseRequest' }],
      default: undefined,
    },

    /**
     * Booking deposit prepaid credit applied toward this sale (EGP).
     * Payment validation uses (totalPrice − exchangeCredit − bookingDepositCredit).
     */
    bookingDepositCreditAmount: { type: Number, default: 0, min: 0 },
    appliedBookingIds: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'ProductBooking' }],
      default: undefined,
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
        /** Branch drawer that received this payment (follow-up installments); falls back to order.branch. */
        branch: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Branch',
          required: false,
        },
        /** cash, visa, aman, … (split checkout / follow-up payments). */
        method: { type: String, required: false, trim: true },
        /** When false, line is a payment-app fee (does not increase amountPaid). */
        countsTowardInvoice: { type: Boolean, default: true },
        /** Method that generated this fee line (e.g. aman). */
        feeForMethod: { type: String, required: false, trim: true },
        /** Original fee on `feeForMethod` (before any gross-up on paidVia). */
        feeNet: { type: Number, required: false, min: 0 },
        /** Amount collected on paidVia, including that method's own % if any. */
        feeGrossOnPaidVia: { type: Number, required: false, min: 0 },
        feePercentSnapshot: { type: Number, required: false, min: 0 },
        /**
         * Installment trading profit recognized by this payment (cash-basis).
         * Down payment at checkout is 0; follow-up collections get a proportional share.
         */
        installmentProfit: { type: Number, required: false, min: 0, default: 0 },
        /** Purchase treasuries when recording pay-later settlement (same keys as desk purchase). */
        paymentTreasurySplits: {
          type: [
            {
              key: { type: String, trim: true, required: true },
              label: { type: String, trim: true, default: '' },
              amount: { type: Number, required: true, min: 0 },
            },
          ],
          default: undefined,
        },
        note: { type: String, default: '', trim: true },
      },
    ],

    /**
     * Customer sale installment schedule (separate from vendor purchase installments).
     * Financed portion may be partial: pay some via cash/visa now, rest as installments.
     */
    installmentPlanId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "InstallmentPlan",
      required: false,
    },
    installmentPlanSnapshot: {
      name: { type: String, trim: true, default: "" },
      months: { type: Number, min: 1 },
      interestPercent: { type: Number, min: 0, default: 0 },
    },
    /** First installment due date (chosen at checkout). */
    installmentStartDate: { type: Date, required: false },
    /** Principal amount put on the installment plan (before interest). */
    installmentPrincipal: { type: Number, min: 0, default: 0 },
    /** Interest/markup amount included in schedule totals. */
    installmentInterestAmount: { type: Number, min: 0, default: 0 },
    /** Discount applied to installment total (cashier override below plan amount). */
    installmentDiscountAmount: { type: Number, min: 0, default: 0 },
    /** Surcharge added via higher installment amount (distributed onto line prices). */
    installmentSurchargeAmount: { type: Number, min: 0, default: 0 },
    /**
     * Full trading profit deferred onto installments (Σ price×qty − Σ cost×qty after interest).
     * Recognized over time as installments are collected.
     */
    installmentTotalProfit: { type: Number, min: 0, default: 0 },
    installments: [
      {
        sequence: { type: Number, required: true, min: 1 },
        dueDate: { type: Date, required: true },
        amount: { type: Number, required: true, min: 0 },
        paid: { type: Boolean, default: false },
        paidAt: { type: Date, required: false },
        paidAmount: { type: Number, min: 0, default: 0 },
        /** This row's share of installmentTotalProfit (equal split; last row absorbs rounding). */
        profitShare: { type: Number, min: 0, default: 0 },
        /** Cumulative profit recognized from payments applied to this row. */
        recognizedProfit: { type: Number, min: 0, default: 0 },
        paymentMethod: { type: String, trim: true, default: "" },
        paidByUserId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: false,
        },
        /** Customer promise to pay at this datetime (collections). */
        promiseToPayAt: { type: Date, required: false },
        /** When the current promiseToPayAt was set. */
        promiseToPayRecordedAt: { type: Date, required: false },
        /** Past promise-to-pay entries (kept when a new promise is set or installment is paid). */
        promiseToPayHistory: [
          {
            promiseToPayAt: { type: Date, required: true },
            recordedAt: { type: Date, required: true },
            recordedByUserId: {
              type: mongoose.Schema.Types.ObjectId,
              ref: "User",
              required: false,
            },
            /**
             * true = paid on promised calendar day (Africa/Cairo),
             * false = day passed without payment that day,
             * null/undefined = still pending.
             */
            paidOnPromisedDay: { type: Boolean, required: false, default: null },
          },
        ],
        note: { type: String, trim: true, default: "" },
      },
    ],

    /** Partial / full invoice returns (refunds, drawer, credit adjustments). */
    returns: [
      {
        returnedAt: { type: Date, required: true },
        returnedByUserId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: false,
        },
        returnAll: { type: Boolean, default: false },
        items: [
          {
            productId: {
              type: mongoose.Schema.Types.ObjectId,
              ref: "Product",
              required: true,
            },
            quantity: { type: Number, required: true, min: 1 },
            unitRefundPrice: { type: Number, required: true, min: 0 },
            lineTotal: { type: Number, required: true, min: 0 },
          },
        ],
        refundTotal: { type: Number, required: true, min: 0 },
        /** Customer payment methods used to refund (mirrors original checkout). */
        refundPaymentSplits: {
          type: [
            {
              method: { type: String, trim: true, required: true },
              amount: { type: Number, required: true, min: 0 },
            },
          ],
          default: undefined,
        },
        /** When cash portion is refunded via purchase treasury instead of drawer. */
        refundTreasurySplits: {
          type: [
            {
              key: { type: String, trim: true, required: true },
              label: { type: String, trim: true, default: '' },
              amount: { type: Number, required: true, min: 0 },
            },
          ],
          default: undefined,
        },
        /** drawer = physical cash; treasury = purchase treasury for cash portion. */
        cashRefundVia: {
          type: String,
          enum: ['drawer', 'treasury'],
          default: 'drawer',
          trim: true,
        },
        /** Amount applied to reduce credit balance (بيع بالآجل) instead of cash refund. */
        creditAdjustmentAmount: { type: Number, default: 0, min: 0 },
        note: { type: String, default: "", trim: true },
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
        /** piece = integer count; weight = kg/g amount in quantity. */
        saleUnit: { type: String, enum: ['piece', 'weight'], default: 'piece' },
        /** Snapshot when saleUnit is weight. */
        weightUnit: { type: String, enum: ['kg', 'g'], required: false },
        /** Units already returned on this line. */
        returnedQuantity: { type: Number, default: 0, min: 0 },
        price: { type: Number, required: true },
        /** Snapshot item cost at time of sale (for profit reports). */
        cost: { type: Number, required: false, default: 0, min: 0 },
        isApplyDiscount: { type: Boolean, default: false },
        /**
         * Snapshot: category.showProductCodeOnInvoice at sale time.
         * When true, product code is printed under the name on the customer receipt.
         */
        showProductCodeOnInvoice: { type: Boolean, required: false },
        /**
         * Snapshot: fridge/carcass product deducted for this cut line (cut-from-source sales).
         * Returns restore this product, not the cut SKU.
         */
        sourceProductId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Product",
          required: false,
          default: undefined,
        },
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
      enum: ["completed", "partially_restored", "restored"],
      default: "completed",
    },

    /** When the invoice was voided / returned — used for drawer reconciliation (refund timing). */
    restoredAt: { type: Date, required: false, index: true },

    orderNumber: { type: Number, unique: true, required: true },

    /** pos = cashier; ecommerce = confirmed online store order (invoice source). */
    source: {
      type: String,
      enum: ['pos', 'ecommerce'],
      default: 'pos',
      trim: true,
      index: true,
    },
    ecommerceOrderId: { type: String, default: '', trim: true, index: true },
    ecommerceOrderNumber: { type: String, default: '', trim: true },
  },
  { timestamps: true }
);

orderSchema.index({ clientId: 1, createdAt: -1 });
orderSchema.index({ paymentMethod: 1, status: 1 });

const Order = mongoose.model("Order", orderSchema);
export default Order;
