import mongoose from 'mongoose';
import Product from './models/product.model.js';
import ProductBooking from './models/productBooking.model.js';
import Notification from './models/notification.model.js';
import { seedDefaultSuperAdmin } from './seedDefaultAdmin.js';

const globalForMongoose = globalThis;

if (!globalForMongoose.__invexMongo) {
  globalForMongoose.__invexMongo = { conn: null, promise: null, postConnect: false };
}

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

async function runPostConnectTasks() {
  const cache = globalForMongoose.__invexMongo;
  if (cache.postConnect) return;
  cache.postConnect = true;
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
  if (process.env.VERCEL) {
    return;
  }
  try {
    await syncBookedQuantitiesFromBookings();
    console.log('✅ Product booked / confirmed booked quantities synced from ProductBooking');
  } catch (e) {
    console.warn('⚠️ Booked quantity sync:', e.message);
  }
}

const connectToMongoDB = async () => {
  const cache = globalForMongoose.__invexMongo;
  if (cache.conn) return cache.conn;

  const uri = String(process.env.MONGO_URI || '').trim();
  if (!uri) {
    throw new Error('MONGO_URI is not set');
  }

  if (!cache.promise) {
    mongoose.set('bufferCommands', false);
    cache.promise = mongoose.connect(uri, {
      serverSelectionTimeoutMS: 15000,
    }).then((m) => m);
  }

  try {
    cache.conn = await cache.promise;
  } catch (err) {
    cache.promise = null;
    cache.conn = null;
    throw err;
  }

  console.log('✅ Connected to MongoDB Atlas successfully.');
  void runPostConnectTasks();
  return cache.conn;
};

export default connectToMongoDB;
