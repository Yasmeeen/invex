import mongoose from 'mongoose';

const outputLineSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    skuKey: { type: String, default: '', trim: true },
    name: { type: String, default: '', trim: true },
    kind: { type: String, enum: ['fridge', 'offal', 'waste'], default: 'offal' },
    quantity: { type: Number, required: true, min: 0 },
    /** Unit cost applied to this line (EGP/kg) from animal cost allocation. */
    unitCost: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const slaughterTicketSchema = new mongoose.Schema(
  {
    /** Set when slaughter happens at a branch; null when inWarehouse. */
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', default: null, index: true },
    /** True when slaughter consumes farm stock and yields products in the central warehouse. */
    inWarehouse: { type: Boolean, default: false, index: true },
    farmProductId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    farmProductName: { type: String, default: '', trim: true },
    templateId: { type: mongoose.Schema.Types.ObjectId, ref: 'SlaughterTemplate', default: null },
    templateCode: { type: String, default: '', trim: true },
    share: { type: Number, required: true, min: 0.25, max: 1 },
    liveWeightKg: { type: Number, default: 0, min: 0 },
    wasteKg: { type: Number, default: 0, min: 0 },
    /** Total animal cost for this share (farm netPrice × share). */
    farmCostTotal: { type: Number, default: 0, min: 0 },
    /** Allocated cost per useful kg for this ticket. */
    costPerKg: { type: Number, default: 0, min: 0 },
    outputs: { type: [outputLineSchema], default: [] },
    notes: { type: String, default: '', trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

slaughterTicketSchema.index({ createdAt: -1 });
slaughterTicketSchema.index({ branch: 1, createdAt: -1 });
slaughterTicketSchema.index({ inWarehouse: 1, createdAt: -1 });

const SlaughterTicket = mongoose.model('SlaughterTicket', slaughterTicketSchema);
export default SlaughterTicket;
