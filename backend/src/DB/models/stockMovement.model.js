import mongoose from 'mongoose';

const stockMovementSchema = new mongoose.Schema(
  {
    movementType: {
      type: String,
      enum: ['transfer', 'sale', 'return', 'purchase'],
      required: true,
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: false,
    },
    productName: { type: String, trim: true, default: '' },
    fromBranchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch',
      required: false,
      default: null,
    },
    toBranchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch',
      required: false,
      default: null,
    },
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch',
      required: false,
      default: null,
    },
    quantity: { type: Number, required: true, min: 0 },
    unitPrice: { type: Number, required: false, min: 0, default: 0 },
    totalValue: { type: Number, required: false, min: 0, default: 0 },
    referenceType: { type: String, trim: true, default: '' },
    referenceId: { type: mongoose.Schema.Types.ObjectId, required: false },
    notes: { type: String, trim: true, default: '' },
  },
  { timestamps: true }
);

stockMovementSchema.index({ createdAt: -1 });
stockMovementSchema.index({ movementType: 1, createdAt: -1 });
stockMovementSchema.index({ productId: 1, createdAt: -1 });
stockMovementSchema.index({ branchId: 1, createdAt: -1 });

const StockMovement = mongoose.model('StockMovement', stockMovementSchema);
export default StockMovement;

