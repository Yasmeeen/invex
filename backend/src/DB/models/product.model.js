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
    /** Quantity reserved for pending branch-to-branch transfers (not sold until approved or released). */
    transferReservedQuantity: {
      type: Number,
      default: 0,
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
    /** Sum of quantities on all active ProductBooking rows (denormalized). */
    bookedQuantity: {
      type: Number,
      default: 0,
      min: 0,
    },
    /** Sum of quantities on active ProductBooking rows where confirmed is true (denormalized). Cashier warning uses this. */
    confirmedBookedQuantity: {
      type: Number,
      default: 0,
      min: 0,
    },
    /** Units held for open e-commerce channel orders (not yet converted to a sale). */
    ecommerceReservedQuantity: {
      type: Number,
      default: 0,
      min: 0,
    },
    /** @deprecated Use bookedQuantity + ProductBooking list; kept for older documents. */
    activeBooking: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ProductBooking',
      default: null,
    },
    /** Dynamic category attributes (values keyed by Category.attributeDefs.key). */
    attributes: {
      type: Map,
      of: String,
      default: {},
    },
    /** Optional: name of the employee who registered / added the device. */
    addedBy: {
      type: String,
      default: '',
      trim: true,
    },
    /** Optional: client or supplier the device was acquired from (trade-in / purchase source). */
    acquiredFrom: {
      partyType: {
        type: String,
        enum: ['client', 'supplier'],
        required: false,
      },
      clientId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Client',
        default: null,
      },
      vendorId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Vendor',
        default: null,
      },
      displayName: { type: String, default: '', trim: true },
      phone: { type: String, default: '', trim: true },
    },
    /**
     * Soft-hide after last unit sold when category.deleteProductWhenOutOfStock.
     * Kept in DB so sales returns can restore stock and show the product again.
     */
    removedWhenOutOfStock: {
      type: Boolean,
      default: false,
      index: true,
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
