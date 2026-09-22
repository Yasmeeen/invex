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
    /** null/undefined = inherit category.sellByWeight; true/false = override. */
    sellByWeightOverride: { type: Boolean, required: false, default: undefined },
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
    /**
     * Selling price shown on the online store.
     * null/undefined = use branch `price` automatically; set only when the store price differs.
     */
    ecommercePrice: {
      type: Number,
      min: 0,
      default: null,
    },
    /**
     * Shared id for storefront variant grouping (same device, different colors).
     * Null = listed alone on the e-commerce site.
     */
    ecommerceVariantGroupId: {
      type: String,
      default: null,
      index: true,
      trim: true,
    },
    /** When true, auto-grouping will not move this product between groups. */
    ecommerceVariantGroupLocked: {
      type: Boolean,
      default: false,
    },
    /** How the current group membership was set. */
    ecommerceVariantGroupSource: {
      type: String,
      enum: ['auto', 'manual'],
      required: false,
      default: undefined,
    },
    /** Shared storefront title for the variant group (optional). */
    ecommerceListingTitle: {
      type: String,
      default: '',
      trim: true,
    },
    /** Category attribute key used as the variant axis (e.g. color). */
    ecommerceVariantAxisKey: {
      type: String,
      default: '',
      trim: true,
    },
    /** Label shown for this SKU in the storefront variant picker. */
    ecommerceVariantLabel: {
      type: String,
      default: '',
      trim: true,
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
    /**
     * Optional installment plans linked to this SKU for barcode stickers.
     * Snapshot (name/months/interest) is stored so reprint works without reloading settings.
     */
    barcodeInstallmentPlans: {
      type: [
        {
          planId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'InstallmentPlan',
            required: true,
          },
          showOnBarcode: { type: Boolean, default: true },
          name: { type: String, default: '', trim: true, maxlength: 120 },
          months: { type: Number, min: 1, max: 120 },
          interestPercent: { type: Number, min: 0, max: 500, default: 0 },
        },
      ],
      default: [],
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
