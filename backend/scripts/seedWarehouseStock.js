/**
 * Seed central warehouse stock from supermarket demo catalog (with images).
 * Safe to re-run: skips WH-* codes that already exist.
 *
 * Usage:
 *   node scripts/seedWarehouseStock.js
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';

import Category from '../src/DB/models/category.model.js';
import Product from '../src/DB/models/product.model.js';
import { DEMO_CATEGORIES } from './supermarketDemoData.js';
import { pickProductImageUrl } from './productImageUrls.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function main() {
  const uri = String(process.env.MONGO_URI || '').trim();
  if (!uri) {
    console.error('❌ MONGO_URI missing in backend/.env');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log('✅ Connected to MongoDB');

  const categories = await Category.find().select('_id code name').lean();
  if (!categories.length) {
    console.error('❌ No categories found. Run seed:supermarket:fresh first.');
    await mongoose.disconnect();
    process.exit(1);
  }

  const categoryByCode = new Map(
    categories.map((c) => [String(c.code || '').trim().toUpperCase(), c])
  );

  const existingWhCodes = new Set(
    (
      await Product.find({ inWarehouse: true })
        .select('code')
        .lean()
    ).map((p) => String(p.code || '').trim())
  );

  const imageCounters = new Map();
  let whCodeCounter = 1;
  let created = 0;
  let skipped = 0;

  for (const catDef of DEMO_CATEGORIES) {
    const category = categoryByCode.get(String(catDef.code || '').trim().toUpperCase());
    if (!category) {
      console.warn(`  ⚠️  Category ${catDef.code} not in DB — skip`);
      continue;
    }

    const pool = catDef.sellByWeight ? catDef.products.slice(0, 2) : catDef.products;
    for (const p of pool) {
      let code;
      do {
        code = `WH-${catDef.code}-${String(whCodeCounter).padStart(3, '0')}`;
        whCodeCounter += 1;
      } while (existingWhCodes.has(code));

      if (existingWhCodes.has(code)) {
        skipped += 1;
        continue;
      }

      const imageIdx = imageCounters.get(catDef.code) || 0;
      imageCounters.set(catDef.code, imageIdx + 1);

      await Product.create({
        name: p.name,
        code,
        price: p.price,
        netPrice: p.netPrice,
        stock: Math.max(p.stock, Math.floor(Number(p.stock) * 2)),
        discount: 0,
        category: category._id,
        branch: null,
        inWarehouse: true,
        imageUrl: pickProductImageUrl(catDef.code, code, imageIdx),
      });
      existingWhCodes.add(code);
      created += 1;
    }
  }

  console.log('\n✅ Warehouse stock seeded');
  console.log(`   Created: ${created}`);
  console.log(`   Skipped: ${skipped}`);
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
