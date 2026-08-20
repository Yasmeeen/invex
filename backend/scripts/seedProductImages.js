/**
 * Assign category-appropriate placeholder image URLs to all products (demo / presentation).
 *
 * Usage:
 *   node scripts/seedProductImages.js
 *   node scripts/seedProductImages.js --force
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';

import Category from '../src/DB/models/category.model.js';
import Product from '../src/DB/models/product.model.js';
import { pickProductImageUrl } from './productImageUrls.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const FORCE = process.argv.includes('--force');

async function main() {
  const uri = String(process.env.MONGO_URI || '').trim();
  if (!uri) {
    console.error('❌ MONGO_URI missing in backend/.env');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log('✅ Connected to MongoDB');

  const categories = await Category.find().select('_id code name').lean();
  const codeById = new Map(categories.map((c) => [String(c._id), c.code || '']));

  const products = await Product.find().select('_id name code category imageUrl').lean();
  if (!products.length) {
    console.error('❌ No products found.');
    await mongoose.disconnect();
    process.exit(1);
  }

  const counters = new Map();
  let updated = 0;
  let skipped = 0;
  const bulk = [];

  console.log(`🖼  Resolving images for ${products.length} products…`);

  for (const p of products) {
    if (p.imageUrl && String(p.imageUrl).trim() && !FORCE) {
      skipped += 1;
      continue;
    }

    const catCode = codeById.get(String(p.category)) || '';
    const idx = counters.get(catCode) || 0;
    counters.set(catCode, idx + 1);

    const imageUrl = pickProductImageUrl(catCode, p.code, idx);
    bulk.push({
      updateOne: {
        filter: { _id: p._id },
        update: { $set: { imageUrl } },
      },
    });
    updated += 1;

    if (updated % 25 === 0) {
      process.stdout.write(`   … ${updated}/${products.length - skipped}\r`);
    }
  }

  if (bulk.length) {
    await Product.bulkWrite(bulk, { ordered: false });
  }

  console.log('\n✅ Product images assigned');
  console.log(`   Updated: ${updated}`);
  console.log(`   Skipped (already had image): ${skipped}`);
  if (skipped && !FORCE) {
    console.log('   Tip: npm run seed:product-images:force');
  }
  console.log('');

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('❌ Failed:', err);
  try {
    await mongoose.disconnect();
  } catch (_) {
    /* ignore */
  }
  process.exit(1);
});
