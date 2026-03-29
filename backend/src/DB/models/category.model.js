import mongoose from 'mongoose';

const categorySchema = new mongoose.Schema({
  name: { type: String, required: true },
  /** Short prefix for product codes (e.g. ELEC → ELEC-001). Uppercase in API. */
  code: { type: String, trim: true },
  productsCount: {
    type: Number, required: false
  },
  totalItems: {
    type: Number, required: false
  }
}, { timestamps: true });

categorySchema.index(
  { code: 1 },
  { unique: true, partialFilterExpression: { code: { $type: 'string', $gt: '' } } }
);

function ensureCodeInPlain(_doc, ret) {
  if (ret.code == null || String(ret.code).trim() === '') {
    ret.code = '';
  } else {
    ret.code = String(ret.code).trim();
  }
  return ret;
}

categorySchema.set('toJSON', {
  transform: ensureCodeInPlain,
});

categorySchema.set('toObject', {
  transform: ensureCodeInPlain,
});

const Category = mongoose.model('Category', categorySchema);
export default Category;