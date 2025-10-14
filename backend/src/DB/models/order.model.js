import mongoose from "mongoose";

const orderSchema = new mongoose.Schema(
  {
    clientName: { type: String, required: true, trim: true },
    clientPhoneNumber: { type: String, required: true, trim: true },
    sellerName: { type: String, trim: true },
    paymentMethod: { type: String, required: true, trim: true },
    clientAddress: { type: String, required: true, trim: true },

    branch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      required: false,
    },

    numberOfProducts: { type: Number, min: 0 },
    totalPrice: { type: Number, min: 0 },

    products: [
      {
        productId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Product",
          required: true,
        },
        name: { type: String, required: true },
        code: { type: String, required: true },
        quantity: { type: Number, required: true },
        price: { type: Number, required: true },
        isApplyDiscount: { type: Boolean, default: false },
      },
    ],

    status: {
      type: String,
      enum: ["completed", "restored"],
      default: "completed",
      required: true,
    },

    orderNumber: { type: Number, unique: true, required: true },
  },
  { timestamps: true }
);

const Order = mongoose.model("Order", orderSchema);
export default Order;
