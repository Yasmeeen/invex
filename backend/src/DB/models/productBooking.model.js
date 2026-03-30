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
    depositAmount: { type: Number, required: true, min: 0 },
    bookingDate: { type: Date, required: true },
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
    cancelledAt: { type: Date },
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    cancelReason: { type: String, trim: true },
  },
  { timestamps: true }
);

productBookingSchema.index(
  { product: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: 'active' } }
);

const ProductBooking = mongoose.model('ProductBooking', productBookingSchema);
export default ProductBooking;
