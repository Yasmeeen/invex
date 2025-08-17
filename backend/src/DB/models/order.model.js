import mongoose from 'mongoose';

const orderSchema = new mongoose.Schema({
  client_name: { type: String, required: true },
  products: [
    {
      _id: false,
      product_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
        required: true,
      },
      name: String,
      code: String,
      price: Number,
    },
  ],
  total_amount: { type: Number, required: true },
  status: { type: String, required: true }, // You can later use enum for specific statuses
}, { timestamps: true });

const Order = mongoose.model('Order', orderSchema);
export default Order;
