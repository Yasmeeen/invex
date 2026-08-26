import mongoose from 'mongoose';

const outputSchema = new mongoose.Schema(
  {
    skuKey: { type: String, required: true, trim: true },
    label: { type: String, default: '', trim: true },
    kind: { type: String, enum: ['fridge', 'offal', 'waste'], default: 'offal' },
  },
  { _id: false }
);

const slaughterTemplateSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    farmSkuKey: { type: String, required: true, trim: true, index: true },
    outputs: { type: [outputSchema], default: [] },
  },
  { timestamps: true }
);

const SlaughterTemplate = mongoose.model('SlaughterTemplate', slaughterTemplateSchema);
export default SlaughterTemplate;
