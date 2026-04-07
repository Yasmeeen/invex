import mongoose from 'mongoose';
import Product from './models/product.model.js';
import ProductBooking from './models/productBooking.model.js';
import { seedDefaultSuperAdmin } from './seedDefaultAdmin.js';

/** One-way sync: denormalize Product.bookedQuantity / bookingStatus from active ProductBooking rows. */
async function syncBookedQuantitiesFromBookings() {
  const agg = await ProductBooking.aggregate([
    { $match: { status: 'active' } },
    { $group: { _id: '$product', total: { $sum: { $ifNull: ['$quantity', 1] } } } },
  ]);
  const idsWithBookings = agg.map((a) => a._id);
  await Promise.all(
    agg.map((row) =>
      Product.updateOne(
        { _id: row._id },
        { $set: { bookedQuantity: row.total, bookingStatus: 'active', activeBooking: null } }
      )
    )
  );
  await Product.updateMany(
    { _id: { $nin: idsWithBookings } },
    { $set: { bookedQuantity: 0, bookingStatus: 'none', activeBooking: null } }
  );
}

const connectToMongoDB = async () => {
  mongoose
    .connect(process.env.MONGO_URI)
    .then(() => console.log('✅ Connected to MongoDB Atlas successfully.'))
    .catch((err) => console.error('❌ MongoDB connection error:', err));

  mongoose.connection.once('open', async () => {
    try {
      await seedDefaultSuperAdmin();
    } catch (e) {
      console.warn('⚠️ Default admin seed:', e.message);
    }
    try {
      await syncBookedQuantitiesFromBookings();
      console.log('✅ Product bookedQuantity synced from ProductBooking');
    } catch (e) {
      console.warn('⚠️ Booked quantity sync:', e.message);
    }
  });
};

export default connectToMongoDB;
