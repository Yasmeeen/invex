import mongoose from 'mongoose';

/**
 * Stock hold created when an e-commerce order is placed.
 * Converted to a POS sale (invoice) on Confirmed; released on Cancelled.
 */
const ecommerceChannelReservationSchema = new mongoose.Schema(
  {
    ecommerceOrderId: { type: String, required: true, index: true },
    ecommerceOrderNumber: { type: String, default: '', trim: true, index: true },
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      index: true,
    },
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, default: 0, min: 0 },
    productNameSnapshot: { type: String, default: '', trim: true },
    productCodeSnapshot: { type: String, default: '', trim: true },
    customerName: { type: String, default: '', trim: true },
    customerPhone: { type: String, default: '', trim: true },
    customerAddress: { type: String, default: '', trim: true },
    status: {
      type: String,
      enum: ['active', 'converted', 'cancelled'],
      default: 'active',
      index: true,
    },
    invexOrderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      default: null,
    },
  },
  { timestamps: true }
);

ecommerceChannelReservationSchema.index(
  { ecommerceOrderId: 1, product: 1, status: 1 }
);

export default mongoose.model(
  'EcommerceChannelReservation',
  ecommerceChannelReservationSchema
);
