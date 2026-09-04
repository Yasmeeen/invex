import mongoose from 'mongoose';

const outputLineSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    name: { type: String, default: '', trim: true },
    code: { type: String, default: '', trim: true },
    quantity: { type: Number, required: true, min: 0 },
    /** Unit cost applied to this line (EGP/kg or unit) from source cost allocation. */
    unitCost: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const trimTicketSchema = new mongoose.Schema(
  {
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true, index: true },
    sourceProductId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    sourceProductName: { type: String, default: '', trim: true },
    sourceProductCode: { type: String, default: '', trim: true },
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
    categoryName: { type: String, default: '', trim: true },
    /** Quantity of the source product consumed (تشفيه). */
    inputQty: { type: Number, required: true, min: 0 },
    /** Total useful yield = sum of output quantities. */
    outputQty: { type: Number, default: 0, min: 0 },
    /** Waste / هالك (kg or units). */
    wasteQty: { type: Number, default: 0, min: 0 },
    /** Total source cost for this trim (netPrice × inputQty). */
    sourceCostTotal: { type: Number, default: 0, min: 0 },
    /** Allocated cost per useful unit for this ticket. */
    costPerUnit: { type: Number, default: 0, min: 0 },
    outputs: { type: [outputLineSchema], default: [] },
    notes: { type: String, default: '', trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

trimTicketSchema.index({ createdAt: -1 });
trimTicketSchema.index({ branch: 1, createdAt: -1 });

const TrimTicket = mongoose.model('TrimTicket', trimTicketSchema);
export default TrimTicket;
