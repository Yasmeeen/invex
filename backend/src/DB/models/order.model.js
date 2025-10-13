import mongoose from 'mongoose';

const orderSchema = new mongoose.Schema(
  {
    clientName: {
      type: String,
      required: true,
      trim: true,
    },
    clientPhoneNumber: {
      type: String,
      required: true,
      trim: true,
    },
    sellerName: {
      type: String,
      required: false,
      trim: true,
    },
    paymentMethod: {
      type: String,
      required: true,
      trim: true,
    },
    clientAddress: {
      type: String,
      required: true,
      trim: true,
    },
    branch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch',
      required: false,
    },
    numberOfProducts: {
      type: Number,
      required: false,
      min: 0,
    },
    totalPrice: {
      type: Number,
      required: false,
      min: 0,
    },
    products: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
      },
    ],
    status: {
      type: String,
      enum: [ 'completed', 'restored'],
      default: 'completed',
      required: true,
    },
    orderNumber: {
      type: Number,
      unique: true,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

const Order = mongoose.model('Order', orderSchema);
export default Order;
