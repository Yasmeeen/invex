import mongoose from 'mongoose';

const ingredientLineSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    name: { type: String, default: '', trim: true },
    code: { type: String, default: '', trim: true },
    qty: { type: Number, required: true, min: 0 },
    unitCost: { type: Number, default: 0, min: 0 },
    lineCost: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const manufacturingOrderSchema = new mongoose.Schema(
  {
    factory: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Factory',
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['draft', 'completed', 'cancelled'],
      default: 'completed',
      index: true,
    },
    outputProductId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },
    outputProductName: { type: String, default: '', trim: true },
    outputProductCode: { type: String, default: '', trim: true },
    outputQty: { type: Number, required: true, min: 0 },
    wasteQty: { type: Number, default: 0, min: 0 },
    recipeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ManufacturingRecipe',
      default: null,
    },
    ingredients: { type: [ingredientLineSchema], default: [] },
    totalIngredientCost: { type: Number, default: 0, min: 0 },
    unitCost: { type: Number, default: 0, min: 0 },
    notes: { type: String, default: '', trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

manufacturingOrderSchema.index({ factory: 1, createdAt: -1 });
manufacturingOrderSchema.index({ createdAt: -1 });

const ManufacturingOrder = mongoose.model('ManufacturingOrder', manufacturingOrderSchema);
export default ManufacturingOrder;
