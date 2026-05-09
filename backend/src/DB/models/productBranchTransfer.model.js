import mongoose from 'mongoose';

const productBranchTransferSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      index: true,
    },
    fromBranch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch',
      required: true,
    },
    toBranch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch',
      required: true,
    },
    quantity: { type: Number, required: true, min: 1 },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
      index: true,
    },
    initiatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    resolvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    resolvedAt: { type: Date, default: null },
    rejectReason: { type: String, default: '', trim: true },
  },
  { timestamps: true }
);

productBranchTransferSchema.index({ toBranch: 1, status: 1 });
productBranchTransferSchema.index({ fromBranch: 1, status: 1 });

const ProductBranchTransfer = mongoose.model('ProductBranchTransfer', productBranchTransferSchema);
export default ProductBranchTransfer;
