import mongoose from 'mongoose';

const productPurchaseRequestSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
      index: true,
      trim: true,
    },

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
      category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
      price: { type: Number, required: true, min: 0 },
      /** Stored as product.netPrice. */
      netPrice: { type: Number, required: true, min: 0 },
      discount: { type: Number, required: false, default: 0, min: 0 },
      attributes: { type: Object, default: {} },
      imageUrl: { type: String, trim: true, default: '' },
      notes: { type: String, trim: true, default: '' },
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

    /** Store Settings purchase treasury key (`cash` = paid from physical drawer). */
    purchaseTreasuryKey: { type: String, trim: true, default: 'cash', index: true },
    /** Snapshot label at creation time (for receipts/history if settings change). */
    purchaseTreasuryLabel: { type: String, trim: true, default: '' },

    /** When purchaseTreasuryKey is `deferred` and source is supplier — links vendor payable. */
    linkedPurchasingRequestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PurchasingRequest',
      required: false,
      index: true,
    },
    /** Amount paid to client on deferred desk purchase (supplier uses PurchasingRequest). */
    amountPaid: { type: Number, default: 0, min: 0 },

    createdProductId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: false },
    /** When multi-code purchase creates several products. */
    createdProductIds: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }], default: undefined },
  },
  { timestamps: true }
);

productPurchaseRequestSchema.index({ status: 1, branch: 1, createdAt: -1 });

/** Keeps existing collection name for deployments already using this feature. */
export default mongoose.model('ProductPurchaseRequest', productPurchaseRequestSchema, 'usedphonepurchases');
