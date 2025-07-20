import mongoose from 'mongoose';

const orderSchema = new mongoose.Schema({
  client_name: { type: String, required: true },
  total_amount: { type: Number, required: true },
  status: { type: String, required: true }, // You can later use enum for specific statuses
}, { timestamps: true });

const Order = mongoose.model('Order', orderSchema);
export default Order;