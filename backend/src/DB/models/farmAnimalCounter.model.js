import mongoose from 'mongoose';

const farmAnimalCounterSchema = new mongoose.Schema(
  {
    _id: { type: String, default: 'farm-animal' },
    value: { type: Number, default: 0, min: 0 },
  },
  { versionKey: false }
);

const FarmAnimalCounter = mongoose.model('FarmAnimalCounter', farmAnimalCounterSchema);
export default FarmAnimalCounter;
