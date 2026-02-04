import mongoose from "mongoose";

const orderSchema = new mongoose.Schema(
  {
    clientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Client",
    },

    clientName: { type: String, required: false, trim: true },
    clientPhoneNumber: { type: String, required: true, trim: true },
    clientAddress: { type: String, required: false, trim: true },

    sellerName: { type: String, trim: true },
    paymentMethod: { type: String, required: false, trim: true ,  default: "cash"},

    branch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
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
    },

    orderNumber: { type: Number, unique: true, required: true },
  },
  { timestamps: true }
);

const Order = mongoose.model("Order", orderSchema);
export default Order;
