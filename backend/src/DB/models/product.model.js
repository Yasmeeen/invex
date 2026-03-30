import mongoose from 'mongoose';

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    code: {
      type: String,
      required: true,
      trim: true, // removed "unique" from here
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    netPrice: {
      type: Number,
      required: true,
      min: 0,
    },
    stock: {
      type: Number,
      required: true,
      min: 0,
    },
    discount: {
      type: Number,
      default: 0,
      min: 0,
    },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      required: true,
    },
    branch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch',
      required: false,
      default: null,
    },
    /** Central warehouse stock (no branch). Mutually exclusive with branch placement. */
    inWarehouse: {
      type: Boolean,
      default: false,
    },
    /** Public HTTPS URL (e.g. Cloudinary secure_url) */
    imageUrl: {
      type: String,
      default: '',
      trim: true,
    },
    /** Product reservation / booking (see ProductBooking). */
    bookingStatus: {
      type: String,
      enum: ['none', 'active'],
      default: 'none',
    },
    activeBooking: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ProductBooking',
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// ✅ Compound unique index: code + branch combination must be unique
productSchema.index({ code: 1, branch: 1 }, { unique: true });

const Product = mongoose.model('Product', productSchema);
export default Product;
