import mongoose from 'mongoose';

const categorySchema = new mongoose.Schema({
  name: { type: String, required: true },
  productsCount: {
    type: Number, required: false
  },
  totalItems: {
    type: Number, required: false
  }
}, { timestamps: true });

const Category = mongoose.model('Category', categorySchema);
export default Category;