import mongoose from 'mongoose';

const productBookingSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      index: true,
    },
    /** Product branch when booked (null = central warehouse). */
    branch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch',
      default: null,
    },
    productInWarehouse: { type: Boolean, default: false },
    client: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Client',
      required: true,
    },
    customerName: { type: String, required: true, trim: true },
    customerPhone: { type: String, required: true, trim: true },
    pickupType: {
      type: String,
      enum: ['branch_pickup', 'online_shipping'],
      required: true,
    },
    shippingAddress: { type: String, default: '', trim: true },
    /** Units reserved by this booking (SKU quantity). */
    quantity: { type: Number, required: true, min: 1, default: 1 },
    depositAmount: { type: Number, required: true, min: 0 },
    /** Deposit payment breakdown (cashier-style methods). */
    depositPayments: {
      type: [
        {
          method: { type: String, required: true, trim: true, maxlength: 40 },
          amount: { type: Number, required: true, min: 0 },
        },
      ],
      default: [],
    },
    /** Optional payment-app fee rows collected with the deposit. */
    depositPaymentFeeAllocations: {
      type: [
        {
          forMethod: { type: String, trim: true, maxlength: 40 },
          feeNet: { type: Number, min: 0, default: 0 },
          paidVia: { type: String, trim: true, maxlength: 40 },
          feeGrossOnPaidVia: { type: Number, min: 0, default: 0 },
          feePercentSnapshot: { type: Number, min: 0, default: 0 },
        },
      ],
      default: [],
    },
    /** Selling unit price snapshot at booking time (for remaining balance on receipt). */
    productUnitPrice: { type: Number, default: 0, min: 0 },
    productNameSnapshot: { type: String, default: '', trim: true },
    productCodeSnapshot: { type: String, default: '', trim: true },
    /** Proof of deposit transfer (e.g. Cloudinary or local /uploads URL). */
    depositTransferImageUrl: { type: String, default: '', trim: true },
    /** Multiple transfer screenshots / receipts (preferred). */
    depositTransferImageUrls: { type: [String], default: [] },
    /** Phone number the deposit transfer was sent from (bank reference). */
    transferReferencePhone: { type: String, default: '', trim: true },
    /** Kept for reporting filters; set server-side to booking creation time. */
    bookingDate: {
      type: Date,
      required: true,
      default() {
        return new Date();
      },
    },
    status: {
      type: String,
      enum: ['active', 'cancelled'],
      default: 'active',
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    /** pos = cashier/app booking; ecommerce = paid order from the website. */
    source: {
      type: String,
      enum: ['pos', 'ecommerce'],
      default: 'pos',
      index: true,
    },
    ecommerceOrderId: {
      type: String,
      default: '',
      trim: true,
      index: true,
    },
    cancelledAt: { type: Date },
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    cancelReason: { type: String, trim: true },
    /** Set when Super Admin / Co Admin / Branch Manager confirms the reservation (informational). */
    confirmed: { type: Boolean, default: false, index: true },
    confirmedAt: { type: Date },
    confirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

/** Never fail on missing client `bookingDate`; reporting uses this as “booked at”. */
productBookingSchema.pre('validate', function bookingDateDefault(next) {
  const v = this.bookingDate;
  if (v == null || v === '') {
    this.bookingDate = new Date();
  } else if (v instanceof Date && Number.isNaN(v.getTime())) {
    this.bookingDate = new Date();
  }
  next();
});

productBookingSchema.index({ product: 1, status: 1 });

const ProductBooking = mongoose.model('ProductBooking', productBookingSchema);
export default ProductBooking;
