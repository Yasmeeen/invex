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
    /** Last time selling price changed (scale / cashier sync). Independent of other product edits. */
    priceUpdatedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    netPrice: {
      type: Number,
      required: false,
      min: 0,
      default: null,
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
    /** null/undefined = inherit category.sellByWeight; true/false = override. */
    sellByWeightOverride: { type: Boolean, required: false, default: undefined },
    /**
     * good: inventory SKU; service: sold without stock deduction; farm: live animal heads (0.25 steps).
     */
    productType: {
      type: String,
      enum: ['good', 'service', 'farm'],
      default: 'good',
      index: true,
    },
    /** Stable catalog key (Al-Raji seed / slaughter templates), unique per branch. */
    catalogKey: {
      type: String,
      default: '',
      trim: true,
      index: true,
    },
    /**
     * When store cutFromSourceEnabled: selling this SKU deducts stock from the source (carcass / fridge piece).
     * Cut SKUs typically keep stock 0; inventory lives on the source.
     */
    sourceProductId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: false,
      default: null,
      index: true,
    },
    /**
     * Extra processing cost per unit/kg (spices, labor, casing) on top of source fridge cost.
     * Used for manufactured cuts when butcher/farm activity + cut-from-source sale.
     * Ignored for general stores.
     */
    processingExtraCost: {
      type: Number,
      default: 0,
      min: 0,
    },
    branch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch',
      required: false,
      default: null,
    },
    /** Central warehouse stock (no branch). Mutually exclusive with branch / factory. */
    inWarehouse: {
      type: Boolean,
      default: false,
    },
    /**
     * Factory stock location (independent of branches/warehouse).
     * Mutually exclusive with branch and inWarehouse.
     */
    factory: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Factory',
      required: false,
      default: null,
      index: true,
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
    /**
     * When store catalog mode is "all", only products with this flag are pushed to the website.
     * Default false so the merchant opts in each SKU.
     */
    listedOnEcommerce: {
      type: Boolean,
      default: false,
      index: true,
    },
    /** Storefront product description (edited in Invex; pushed to the e-commerce catalog). */
    ecommerceDescription: {
      type: String,
      default: '',
    },
    ecommerceShortDescription: {
      type: String,
      default: '',
      trim: true,
    },
    ecommerceIsFeatured: {
      type: Boolean,
      default: false,
      index: true,
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
    /** Optional: name of the employee who registered / added the product. */
    addedBy: {
      type: String,
      default: '',
      trim: true,
    },
    /** Optional: client or supplier the product was acquired from (trade-in / purchase source). */
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

// Location uniqueness: one row per code at each place type.
productSchema.index(
  { code: 1, branch: 1 },
  {
    unique: true,
    partialFilterExpression: { branch: { $type: 'objectId' } },
  }
);
productSchema.index(
  { code: 1 },
  {
    unique: true,
    partialFilterExpression: { inWarehouse: true },
  }
);
productSchema.index(
  { code: 1, factory: 1 },
  {
    unique: true,
    partialFilterExpression: { factory: { $type: 'objectId' } },
  }
);

const Product = mongoose.model('Product', productSchema);
export default Product;
