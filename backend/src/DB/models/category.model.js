import mongoose from 'mongoose';

const categorySchema = new mongoose.Schema({
  name: { type: String, required: true },
  /** Short prefix for product codes (e.g. ELEC → ELEC-001). Uppercase in API. */
  code: { type: String, trim: true },
  /**
   * When true, each physical unit gets its own product code (quantity N creates N products, stock 1 each).
   * When false, one code covers the whole quantity (single product, stock N).
   */
  multiCodePerPiece: { type: Boolean, default: false },
  /** When true (and store weightSalesEnabled), products sell by weight (kg/g). */
  sellByWeight: { type: Boolean, default: false },
  /** Unit shown on receipts and stock for sellByWeight categories. */
  weightUnit: { type: String, enum: ['kg', 'g'], default: 'kg' },
  /**
   * When true, products in this category are deleted once stock reaches 0 (e.g. after a sale).
   * When false, out-of-stock products remain so stock can be topped up later.
   */
  deleteProductWhenOutOfStock: { type: Boolean, default: false },
  /**
   * When true, product code is printed on the customer invoice/receipt under the product name.
   * Defaults to true for all categories (including legacy docs missing the field).
   */
  showProductCodeOnInvoice: { type: Boolean, default: true },
  /** Dynamic attributes definition for products under this category. */
  attributeDefs: {
    type: [
      {
        key: { type: String, required: true, trim: true },
        /** Optional display label; if omitted, we fallback to key. */
        label: { type: String, required: false, trim: true },
        /** When true, attribute value is printed on customer invoice/receipt. */
        showOnInvoice: { type: Boolean, default: false },
        /** When true, only the attribute value (not the label) is shown on the barcode sticker. */
        showInBarcode: { type: Boolean, default: false },
      },
    ],
    default: [],
  },
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
  if (!Array.isArray(ret.attributeDefs)) {
    ret.attributeDefs = [];
  }
  ret.multiCodePerPiece = !!ret.multiCodePerPiece;
  ret.sellByWeight = !!ret.sellByWeight;
  ret.weightUnit = ret.weightUnit === 'g' ? 'g' : 'kg';
  ret.deleteProductWhenOutOfStock = !!ret.deleteProductWhenOutOfStock;
  // Missing / null → true (legacy categories & schema default)
  ret.showProductCodeOnInvoice =
    ret.showProductCodeOnInvoice == null ? true : !!ret.showProductCodeOnInvoice;
  return ret;
}

categorySchema.set('toJSON', {
  transform: ensureCodeInPlain,
});

categorySchema.set('toObject', {
  transform: ensureCodeInPlain,
});

const normalizeAttrKey = (raw) =>
  String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');

categorySchema.pre('validate', function normalizeAttributeDefs(next) {
  try {
    if (!Array.isArray(this.attributeDefs)) {
      this.attributeDefs = [];
      return next();
    }
    const cleaned = [];
    const seen = new Set();
    for (const row of this.attributeDefs) {
      const key = normalizeAttrKey(row?.key);
      const label = String(row?.label || '').trim() || key;
      if (!key) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      cleaned.push({
        key,
        label,
        showOnInvoice: !!row?.showOnInvoice,
        showInBarcode: !!row?.showInBarcode,
      });
    }
    this.attributeDefs = cleaned;
    return next();
  } catch (e) {
    return next(e);
  }
});

const Category = mongoose.model('Category', categorySchema);
export default Category;