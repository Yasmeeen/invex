/**
 * One-off: remove purchase price (netPrice) from all existing products.
 * Usage: node scripts/clear-product-net-prices.mjs [--dry-run]
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

import Product from '../src/DB/models/product.model.js';

const dryRun = process.argv.includes('--dry-run');

const uri = String(process.env.MONGO_URI || '').trim();
if (!uri) {
  console.error('MONGO_URI missing');
  process.exit(1);
}

await mongoose.connect(uri);

const filter = {
  $or: [
    { netPrice: { $ne: null } },
    { netPrice: { $exists: true, $type: 'number' } },
  ],
};

const count = await Product.countDocuments(filter);
console.log(`Products with netPrice set: ${count}`);

if (dryRun) {
  const sample = await Product.find(filter).select('code name netPrice branch').limit(10).lean();
  console.log('Sample (up to 10):', sample);
  await mongoose.disconnect();
  process.exit(0);
}

if (count === 0) {
  console.log('Nothing to update.');
  await mongoose.disconnect();
  process.exit(0);
}

const result = await Product.updateMany(filter, { $unset: { netPrice: 1 } });
console.log('Updated:', {
  matched: result.matchedCount ?? result.n,
  modified: result.modifiedCount ?? result.nModified,
});

const remaining = await Product.countDocuments({
  netPrice: { $ne: null, $exists: true },
});
console.log(`Remaining products with netPrice: ${remaining}`);

await mongoose.disconnect();
console.log('Done.');
