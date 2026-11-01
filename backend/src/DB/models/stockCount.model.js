import mongoose from 'mongoose';

const categorySnapSchema = new mongoose.Schema(
  {
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
    name: { type: String, default: '', trim: true },
  },
  { _id: false }
);

const expectedItemSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    name: { type: String, default: '', trim: true },
    code: { type: String, default: '', trim: true },
    categoryName: { type: String, default: '', trim: true },
    expectedQty: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const scanSchema = new mongoose.Schema(
  {
    rawCode: { type: String, default: '', trim: true },
    normalizedCode: { type: String, default: '', trim: true },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
    productName: { type: String, default: '', trim: true },
    productCode: { type: String, default: '', trim: true },
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
    categoryName: { type: String, default: '', trim: true },
    kind: { type: String, enum: ['matched', 'surplus'], required: true },
    surplusReason: { type: String, default: '', trim: true },
    scannedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const summarySchema = new mongoose.Schema(
  {
    expectedUnits: { type: Number, default: 0, min: 0 },
    countedUnits: { type: Number, default: 0, min: 0 },
    shortageUnits: { type: Number, default: 0, min: 0 },
    surplusUnits: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

/**
 * Physical stock count: scan device serials and compare with the system
 * snapshot taken when the count started.
 */
const stockCountSchema = new mongoose.Schema(
  {
    locationType: {
      type: String,
      enum: ['branch', 'warehouse'],
      required: true,
    },
    branch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch',
      default: null,
      index: true,
    },
    branchName: { type: String, default: '', trim: true },
    categories: { type: [categorySnapSchema], default: [] },
    /** In-stock units in the chosen categories at start. Shortage is measured against this. */
    expectedItems: { type: [expectedItemSchema], default: [] },
    status: {
      type: String,
      enum: ['open', 'completed'],
      default: 'open',
      index: true,
    },
    note: { type: String, default: '', trim: true, maxlength: 500 },
    startedAt: { type: Date, default: Date.now, index: true },
    completedAt: { type: Date, default: null },
    createdBy: {
      userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      name: { type: String, default: '', trim: true },
    },
    scans: { type: [scanSchema], default: [] },
    summary: { type: summarySchema, default: () => ({}) },
    /** Frozen shortage / surplus rows written when the count is closed. */
    result: {
      shortages: { type: Array, default: [] },
      surpluses: { type: Array, default: [] },
    },
  },
  { timestamps: true }
);

stockCountSchema.index({ branch: 1, startedAt: -1 });
stockCountSchema.index({ status: 1, startedAt: -1 });

const StockCount = mongoose.model('StockCount', stockCountSchema);
export default StockCount;
