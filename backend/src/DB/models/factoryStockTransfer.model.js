import mongoose from 'mongoose';

/**
 * Immediate stock moves involving a factory:
 * - branch|warehouse → factory (intake)
 * - factory → branch (distribution)
 */
const factoryStockTransferSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      index: true,
    },
    productNameSnapshot: { type: String, default: '', trim: true },
    productCodeSnapshot: { type: String, default: '', trim: true },
    destinationProduct: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      default: null,
    },
    /** Source: exactly one of fromBranch / fromWarehouse / fromFactory */
    fromBranch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch',
      default: null,
    },
    fromWarehouse: { type: Boolean, default: false },
    fromFactory: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Factory',
      default: null,
    },
    /** Destination: exactly one of toBranch / toFactory */
    toBranch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch',
      default: null,
    },
    toFactory: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Factory',
      default: null,
    },
    quantity: { type: Number, required: true, min: 0 },
    unitCost: { type: Number, default: 0, min: 0 },
    notes: { type: String, default: '', trim: true },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true }
);

factoryStockTransferSchema.index({ fromFactory: 1, createdAt: -1 });
factoryStockTransferSchema.index({ toFactory: 1, createdAt: -1 });
factoryStockTransferSchema.index({ createdAt: -1 });

const FactoryStockTransfer = mongoose.model('FactoryStockTransfer', factoryStockTransferSchema);
export default FactoryStockTransfer;
