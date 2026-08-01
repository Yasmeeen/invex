import mongoose from 'mongoose';

const purchaseTreasurySplitSchema = new mongoose.Schema(
  {
    key: { type: String, trim: true, required: true },
    label: { type: String, trim: true, default: '' },
    amount: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const productPurchaseRequestSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'partially_returned', 'returned'],
      default: 'pending',
      index: true,
      trim: true,
    },

    /** Units returned to the source party (approved purchases only). */
    returnedQuantity: { type: Number, default: 0, min: 0 },

    /** When fully returned — used for drawer reconciliation timing. */
    returnedAt: { type: Date, required: false, index: true },

    returns: [
      {
        returnedAt: { type: Date, required: true },
        returnedByUserId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
          required: false,
        },
        quantity: { type: Number, required: true, min: 1 },
        unitRefundPrice: { type: Number, required: true, min: 0 },
        refundTotal: { type: Number, required: true, min: 0 },
        /** How the store receives/pays the refund (mirrors original purchase treasuries). */
        refundTreasurySplits: { type: [purchaseTreasurySplitSchema], default: undefined },
        /** drawer = physical cash in drawer; treasury = non-cash purchase treasury for cash portion. */
        cashRefundVia: {
          type: String,
          enum: ['drawer', 'treasury'],
          default: 'drawer',
          trim: true,
        },
        /** Deferred portion reversed on vendor/client ledger. */
        deferredAdjustmentAmount: { type: Number, default: 0, min: 0 },
        /** Product ids removed from stock (multi-code purchases). */
        returnedProductIds: {
          type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
          default: undefined,
        },
        note: { type: String, default: '', trim: true },
      },
    ],

    branch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch',
      required: true,
      index: true,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    createdAtUserLocal: { type: Date, required: false },

    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false },
    resolvedAt: { type: Date, required: false },
    resolutionNote: { type: String, trim: true, default: '' },

    /** Product data to create on approval (matches products_module/createProduct expectations). */
    productPayload: {
      name: { type: String, required: true, trim: true },
      code: { type: String, required: true, trim: true },
      /** When category.multiCodePerPiece and quantity > 1: one code per unit (same length as quantity). */
      unitCodes: { type: [String], default: undefined },
      /**
       * When multi-code units do not share the same sale/purchase/discount/attributes:
       * one entry per unit (same length as quantity). Overrides product-level fields per code.
       */
      unitDetails: {
        type: [
          {
            code: { type: String, required: true, trim: true },
            price: { type: Number, required: true, min: 0 },
            netPrice: { type: Number, required: true, min: 0 },
            discount: { type: Number, required: false, default: 0, min: 0 },
            attributes: { type: Object, default: {} },
          },
        ],
        default: undefined,
      },
      category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
      price: { type: Number, required: true, min: 0 },
      /** Stored as product.netPrice. */
      netPrice: { type: Number, required: true, min: 0 },
      discount: { type: Number, required: false, default: 0, min: 0 },
      attributes: { type: Object, default: {} },
      imageUrl: { type: String, trim: true, default: '' },
      notes: { type: String, trim: true, default: '' },
      addedBy: { type: String, trim: true, default: '' },
      acquiredFrom: {
        partyType: { type: String, enum: ['client', 'supplier'], required: false },
        clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: false },
        vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', required: false },
        displayName: { type: String, trim: true, default: '' },
        phone: { type: String, trim: true, default: '' },
        name: { type: String, trim: true, default: '' },
        address: { type: String, trim: true, default: '' },
      },
    },

    quantity: { type: Number, required: true, min: 1, default: 1 },

    /**
     * Multi-device purchase invoice lines (exchange / multi trade-in).
     * When set, totals use all lines; productPayload+quantity mirror the first line for legacy readers.
     */
    lines: {
      type: [
        {
          productPayload: {
            name: { type: String, required: true, trim: true },
            code: { type: String, required: true, trim: true },
            unitCodes: { type: [String], default: undefined },
            unitDetails: {
              type: [
                {
                  code: { type: String, required: true, trim: true },
                  price: { type: Number, required: true, min: 0 },
                  netPrice: { type: Number, required: true, min: 0 },
                  discount: { type: Number, required: false, default: 0, min: 0 },
                  attributes: { type: Object, default: {} },
                },
              ],
              default: undefined,
            },
            category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
            price: { type: Number, required: true, min: 0 },
            netPrice: { type: Number, required: true, min: 0 },
            discount: { type: Number, required: false, default: 0, min: 0 },
            attributes: { type: Object, default: {} },
            imageUrl: { type: String, trim: true, default: '' },
            notes: { type: String, trim: true, default: '' },
            addedBy: { type: String, trim: true, default: '' },
            acquiredFrom: {
              partyType: { type: String, enum: ['client', 'supplier'], required: false },
              clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: false },
              vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', required: false },
              displayName: { type: String, trim: true, default: '' },
              phone: { type: String, trim: true, default: '' },
              name: { type: String, trim: true, default: '' },
              address: { type: String, trim: true, default: '' },
            },
          },
          quantity: { type: Number, required: true, min: 1, default: 1 },
          createdProductId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: false },
          createdProductIds: {
            type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
            default: undefined,
          },
        },
      ],
      default: undefined,
    },

    /** Store Settings purchase treasury key (`cash` = paid from physical drawer). Legacy / summary. */
    purchaseTreasuryKey: { type: String, trim: true, default: 'cash', index: true },
    /** Snapshot label at creation time (for receipts/history if settings change). */
    purchaseTreasuryLabel: { type: String, trim: true, default: '' },
    /** Split payment across treasuries: [{ key, label, amount }]. Sum equals netPrice × quantity. */
    purchaseTreasurySplits: { type: [purchaseTreasurySplitSchema], default: undefined },

    /** When purchaseTreasuryKey is `deferred` and source is supplier — links vendor payable. */
    linkedPurchasingRequestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PurchasingRequest',
      required: false,
      index: true,
    },
    /** Amount paid to client on deferred desk purchase (supplier uses PurchasingRequest). */
    amountPaid: { type: Number, default: 0, min: 0 },

    /** Cashier exchange: intake without upfront treasury; settlement recorded at checkout. */
    isExchangeTradeIn: { type: Boolean, default: false, index: true },
    /** Store pays party the difference (trade-in credit > sale); affects drawer when cash. */
    exchangeSettlementSplits: { type: [purchaseTreasurySplitSchema], default: undefined },
    linkedExchangeOrderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      required: false,
      index: true,
    },

    createdProductId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: false },
    /** When multi-code purchase creates several products. */
    createdProductIds: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }], default: undefined },
  },
  { timestamps: true }
);

productPurchaseRequestSchema.index({ status: 1, branch: 1, createdAt: -1 });

/** Keeps existing collection name for deployments already using this feature. */
export default mongoose.model('ProductPurchaseRequest', productPurchaseRequestSchema, 'usedphonepurchases');
