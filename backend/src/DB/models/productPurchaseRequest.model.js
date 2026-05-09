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
      category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
      price: { type: Number, required: true, min: 0 },
      /** Stored as product.netPrice. */
      netPrice: { type: Number, required: true, min: 0 },
      discount: { type: Number, required: false, default: 0, min: 0 },
      attributes: { type: Object, default: {} },
      imageUrl: { type: String, trim: true, default: '' },
      notes: { type: String, trim: true, default: '' },
    },

    quantity: { type: Number, required: true, min: 1, default: 1 },
    createdProductId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: false },
  },
  { timestamps: true }
);

productPurchaseRequestSchema.index({ status: 1, branch: 1, createdAt: -1 });

/** Keeps existing collection name for deployments already using this feature. */
export default mongoose.model('ProductPurchaseRequest', productPurchaseRequestSchema, 'usedphonepurchases');
