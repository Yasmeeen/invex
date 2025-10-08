import mongoose from 'mongoose';

const branchSchema = new mongoose.Schema({
  name: { type: String, required: true },
  productsCount:{type: Number,required: true  }
}, { timestamps: true });


const Branch = mongoose.model('Branch', branchSchema);
export default Branch;