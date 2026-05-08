import mongoose from 'mongoose';
import Product from './models/product.model.js';
import ProductBooking from './models/productBooking.model.js';
import Notification from './models/notification.model.js';
import { seedDefaultSuperAdmin } from './seedDefaultAdmin.js';

/**
 * MongoDB forbids compound indexes that include two array fields. An old index
 * { recipients, readBy, ... } breaks Notification.create(); drop it if present.
 */
async function fixNotificationIndexes() {
  const coll = mongoose.connection.collection('notifications');
  let list = [];
  try {
    list = await coll.indexes();
  } catch (e) {
    if (e?.codeName !== 'NamespaceNotFound') throw e;
  }
  for (const idx of list) {
    const key = idx.key || {};
    const fields = Object.keys(key);
    if (fields.includes('recipients') && fields.includes('readBy') && idx.name && idx.name !== '_id_') {
      await coll.dropIndex(idx.name);
      console.log(`✅ Dropped illegal notification index: ${idx.name}`);
    }
  }
  await Notification.syncIndexes();
}

/** One-way sync: denormalize Product booked totals / bookingStatus from active ProductBooking rows. */
async function syncBookedQuantitiesFromBookings() {
  const agg = await ProductBooking.aggregate([
    { $match: { status: 'active' } },
    {
      $group: {
        _id: '$product',
        total: { $sum: { $ifNull: ['$quantity', 1] } },
        confirmedTotal: {
          $sum: {
            $cond: [{ $eq: ['$confirmed', true] }, { $ifNull: ['$quantity', 1] }, 0],
          },
        },
      },
    },
  ]);
  const idsWithBookings = agg.map((a) => a._id);
  await Promise.all(
    agg.map((row) =>
      Product.updateOne(
        { _id: row._id },
        {
          $set: {
            bookedQuantity: row.total,
            confirmedBookedQuantity: row.confirmedTotal || 0,
            bookingStatus: 'active',
            activeBooking: null,
          },
        }
      )
    )
  );
  await Product.updateMany(
    { _id: { $nin: idsWithBookings } },
    {
      $set: {
        bookedQuantity: 0,
        confirmedBookedQuantity: 0,
        bookingStatus: 'none',
        activeBooking: null,
      },
    }
  );
}

const connectToMongoDB = async () => {
  mongoose
    .connect(process.env.MONGO_URI)
    .then(() => console.log('✅ Connected to MongoDB Atlas successfully.'))
    .catch((err) => console.error('❌ MongoDB connection error:', err));

  mongoose.connection.once('open', async () => {
    try {
      await fixNotificationIndexes();
    } catch (e) {
      console.warn('⚠️ Notification indexes fix:', e.message);
    }
    try {
      await seedDefaultSuperAdmin();
    } catch (e) {
      console.warn('⚠️ Default admin seed:', e.message);
    }
    try {
      await syncBookedQuantitiesFromBookings();
      console.log('✅ Product booked / confirmed booked quantities synced from ProductBooking');
    } catch (e) {
      console.warn('⚠️ Booked quantity sync:', e.message);
    }
  });
};

export default connectToMongoDB;
