import mongoose from 'mongoose';

const factorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    address: { type: String, default: '', trim: true },
    isActive: { type: Boolean, default: true, index: true },
    notes: { type: String, default: '', trim: true },
  },
  { timestamps: true }
);

factorySchema.index({ name: 1 });

const Factory = mongoose.model('Factory', factorySchema);
export default Factory;
