import mongoose from 'mongoose';

const saleLineSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    name: { type: String, default: '', trim: true },
    code: { type: String, default: '', trim: true },
    quantity: { type: Number, required: true, min: 0 },
    unitPrice: { type: Number, required: true, min: 0 },
    unitCost: { type: Number, default: 0, min: 0 },
    lineTotal: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const factorySaleSchema = new mongoose.Schema(
  {
    factory: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Factory',
      required: true,
      index: true,
    },
    partyType: {
      type: String,
      enum: ['client', 'vendor'],
      required: true,
    },
    clientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Client',
      default: null,
    },
    vendorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Vendor',
      default: null,
    },
    partyName: { type: String, default: '', trim: true },
    lines: { type: [saleLineSchema], default: [] },
    totalAmount: { type: Number, default: 0, min: 0 },
    notes: { type: String, default: '', trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

factorySaleSchema.index({ factory: 1, createdAt: -1 });
factorySaleSchema.index({ createdAt: -1 });

const FactorySale = mongoose.model('FactorySale', factorySaleSchema);
export default FactorySale;
