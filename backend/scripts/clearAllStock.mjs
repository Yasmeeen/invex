/**
 * Zero all product stock (test inventory wipe before client go-live).
 * Keeps products/catalog; clears quantities and related stock history.
 *
 *   node scripts/clearAllStock.mjs --dry-run
 *   node scripts/clearAllStock.mjs
 *   node scripts/clearAllStock.mjs --keep-movements   # only zero product stock
 *   node scripts/clearAllStock.mjs --keep-farm        # leave farm animals
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';

import Product from '../src/DB/models/product.model.js';
import StockMovement from '../src/DB/models/stockMovement.model.js';
import FarmAnimal from '../src/DB/models/farmAnimal.model.js';
import EcommerceChannelReservation from '../src/DB/models/ecommerceChannelReservation.model.js';
import ProductBooking from '../src/DB/models/productBooking.model.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const dryRun = process.argv.includes('--dry-run');
const keepMovements = process.argv.includes('--keep-movements');
const keepFarm = process.argv.includes('--keep-farm');

async function main() {
  const uri = String(process.env.MONGO_URI || process.env.MONGODB_URI || '').trim();
  if (!uri) {
    console.error('❌ MONGO_URI missing in backend/.env');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log('✅ Connected to MongoDB');
  if (dryRun) console.log('🔍 DRY RUN — no writes\n');

  const stockFilter = {
    $or: [{ stock: { $gt: 0 } }, { transferReservedQuantity: { $gt: 0 } }],
  };

  const withStock = await Product.countDocuments(stockFilter);
  const stockAgg = await Product.aggregate([
    { $match: stockFilter },
    {
      $group: {
        _id: null,
        totalStock: { $sum: '$stock' },
        totalReserved: { $sum: '$transferReservedQuantity' },
      },
    },
  ]);
  const totals = stockAgg[0] || { totalStock: 0, totalReserved: 0 };

  const sample = await Product.find(stockFilter)
    .select('name code stock transferReservedQuantity branch inWarehouse factory')
    .sort({ stock: -1 })
    .limit(15)
    .lean();

  const movementCount = await StockMovement.countDocuments();
  const farmAvailable = await FarmAnimal.countDocuments({
    status: { $in: ['available', 'reserved'] },
  });
  const ecomReservations = await EcommerceChannelReservation.countDocuments();
  const bookingCount = await ProductBooking.countDocuments();
  const productsWithBookingFlags = await Product.countDocuments({
    $or: [
      { bookedQuantity: { $gt: 0 } },
      { confirmedBookedQuantity: { $gt: 0 } },
      { ecommerceReservedQuantity: { $gt: 0 } },
      { bookingStatus: { $nin: [null, 'none', ''] } },
      { activeBooking: { $ne: null } },
    ],
  });

  console.log('Products with stock or transfer reserve:', withStock);
  console.log('  Sum of stock units/kg:', Math.round(Number(totals.totalStock) * 1000) / 1000);
  console.log('  Sum of transferReserved:', Math.round(Number(totals.totalReserved) * 1000) / 1000);
  console.log('StockMovement rows:', movementCount);
  console.log('Farm animals (available/reserved):', farmAvailable);
  console.log('Ecommerce channel reservations:', ecomReservations);
  console.log('ProductBooking rows:', bookingCount);
  console.log('Products with booking flags:', productsWithBookingFlags);
  console.log('\nTop stock sample:');
  for (const p of sample) {
    const loc = p.inWarehouse
      ? 'WH'
      : p.factory
        ? `factory:${p.factory}`
        : p.branch
          ? `branch:${p.branch}`
          : '—';
    console.log(
      `  - ${p.name} (${p.code}) stock=${p.stock} reserved=${p.transferReservedQuantity || 0} [${loc}]`
    );
  }

  if (dryRun) {
    console.log('\nDry run complete. Re-run without --dry-run to apply.');
    await mongoose.disconnect();
    return;
  }

  const productResult = await Product.updateMany(
    {},
    { $set: { stock: 0, transferReservedQuantity: 0 } }
  );
  console.log('\n✅ Products zeroed:', {
    matched: productResult.matchedCount ?? productResult.n,
    modified: productResult.modifiedCount ?? productResult.nModified,
  });

  if (!keepMovements) {
    const delMov = await StockMovement.deleteMany({});
    console.log('✅ StockMovement deleted:', delMov.deletedCount);
  } else {
    console.log('⏭  Kept StockMovement (--keep-movements)');
  }

  if (!keepFarm) {
    const delFarm = await FarmAnimal.deleteMany({
      status: { $in: ['available', 'reserved'] },
    });
    console.log('✅ Farm animals (available/reserved) deleted:', delFarm.deletedCount);
  } else {
    console.log('⏭  Kept farm animals (--keep-farm)');
  }

  const delEcom = await EcommerceChannelReservation.deleteMany({});
  console.log('✅ Ecommerce reservations deleted:', delEcom.deletedCount);

  const delBookings = await ProductBooking.deleteMany({});
  console.log('✅ ProductBooking deleted:', delBookings.deletedCount);

  const bookingFlags = await Product.updateMany(
    {},
    {
      $set: {
        bookingStatus: 'none',
        bookedQuantity: 0,
        confirmedBookedQuantity: 0,
        ecommerceReservedQuantity: 0,
        activeBooking: null,
      },
    }
  );
  console.log('✅ Product booking flags cleared:', {
    matched: bookingFlags.matchedCount ?? bookingFlags.n,
    modified: bookingFlags.modifiedCount ?? bookingFlags.nModified,
  });

  const remainingStock = await Product.countDocuments({ stock: { $gt: 0 } });
  const remainingReserved = await Product.countDocuments({
    transferReservedQuantity: { $gt: 0 },
  });
  const remainingBookings = await ProductBooking.countDocuments();
  const remainingBookingFlags = await Product.countDocuments({
    $or: [
      { bookedQuantity: { $gt: 0 } },
      { confirmedBookedQuantity: { $gt: 0 } },
      { ecommerceReservedQuantity: { $gt: 0 } },
      { bookingStatus: { $nin: [null, 'none', ''] } },
      { activeBooking: { $ne: null } },
    ],
  });
  console.log('\nVerify — products with stock > 0:', remainingStock);
  console.log('Verify — products with transferReserved > 0:', remainingReserved);
  console.log('Verify — ProductBooking rows:', remainingBookings);
  console.log('Verify — products with booking flags:', remainingBookingFlags);

  await mongoose.disconnect();
  console.log('Done.');
}

main().catch(async (err) => {
  console.error('❌', err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
