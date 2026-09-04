import mongoose from 'mongoose';

const recipeLineSchema = new mongoose.Schema(
  {
    /** Prefer matching factory stock by product code. */
    ingredientProductCode: { type: String, required: true, trim: true },
    ingredientCatalogKey: { type: String, default: '', trim: true },
    name: { type: String, default: '', trim: true },
    /** Quantity of ingredient consumed per 1 unit of output. */
    defaultQtyPerOutputUnit: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const manufacturingRecipeSchema = new mongoose.Schema(
  {
    outputProductCode: { type: String, required: true, trim: true, index: true },
    outputCatalogKey: { type: String, default: '', trim: true },
    outputName: { type: String, required: true, trim: true },
    /** Display unit hint: kg | unit */
    outputUnit: {
      type: String,
      enum: ['kg', 'unit'],
      default: 'kg',
      trim: true,
    },
    lines: { type: [recipeLineSchema], default: [] },
    notes: { type: String, default: '', trim: true },
    isActive: { type: Boolean, default: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

manufacturingRecipeSchema.index({ outputProductCode: 1, isActive: 1 });

const ManufacturingRecipe = mongoose.model('ManufacturingRecipe', manufacturingRecipeSchema);
export default ManufacturingRecipe;
