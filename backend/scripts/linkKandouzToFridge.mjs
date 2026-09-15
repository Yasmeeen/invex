/**
 * Kandouz category: every cut draws from كندوز ثلاجة; rename fridge SKU; fridge sorts first via catalogKey.
 *
 *   node scripts/linkKandouzToFridge.mjs --dry-run
 *   node scripts/linkKandouzToFridge.mjs
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';

import Category from '../src/DB/models/category.model.js';
import Product from '../src/DB/models/product.model.js';
import '../src/DB/models/branch.model.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const dryRun = process.argv.includes('--dry-run');
const FRIDGE_NAME = 'كندوز ثلاجة';
const FRIDGE_KEY = 'kandouz_fridge';
/** Piece SKUs that should keep their own stock (not cut-from-fridge). */
const SKIP_KEYS = new Set(['kandouz_masoura']);

function locationKey(p) {
  if (p.inWarehouse) return 'warehouse';
  return p.branch ? `branch:${String(p.branch)}` : 'none';
}

function isFridge(p) {
  const key = String(p.catalogKey || '').trim();
  if (key === FRIDGE_KEY) return true;
  const code = String(p.code || '').toLowerCase();
  return code.includes('kandouz-fridge') || code.endsWith('kandouz_fridge');
}

async function main() {
  const uri = String(process.env.MONGO_URI || process.env.MONGODB_URI || '').trim();
  if (!uri) {
    console.error('❌ MONGO_URI missing in backend/.env');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log('✅ Connected to MongoDB');
  if (dryRun) console.log('🔍 DRY RUN — no writes\n');

  const category = await Category.findOne({
    $or: [{ code: 'KANDOUZ' }, { name: 'كندوز' }],
  }).lean();
  if (!category) {
    console.error('❌ Category كندوز / KANDOUZ not found');
    process.exit(1);
  }
  console.log(`Category: ${category.name} (${category.code})`);

  const products = await Product.find({ category: category._id })
    .select('name code catalogKey sourceProductId stock branch inWarehouse productType sellByWeightOverride')
    .lean();

  const byLoc = new Map();
  for (const p of products) {
    const k = locationKey(p);
    if (!byLoc.has(k)) byLoc.set(k, []);
    byLoc.get(k).push(p);
  }

  let renamed = 0;
  let linked = 0;
  let skipped = 0;

  for (const [loc, list] of byLoc) {
    const fridges = list.filter(isFridge);
    console.log(`\n=== ${loc} (${list.length} products, ${fridges.length} fridge) ===`);

    if (!fridges.length) {
      console.log('  ⚠ No fridge SKU — skip location');
      skipped += list.length;
      continue;
    }
    if (fridges.length > 1) {
      console.log(
        '  ⚠ Multiple fridge rows:',
        fridges.map((f) => `${f.name} (${f._id})`).join(', ')
      );
    }

    const fridge = fridges[0];

    if (String(fridge.name || '').trim() !== FRIDGE_NAME) {
      console.log(`  Rename: "${fridge.name}" → "${FRIDGE_NAME}"`);
      if (!dryRun) {
        await Product.updateOne({ _id: fridge._id }, { $set: { name: FRIDGE_NAME } });
      }
      renamed += 1;
    } else {
      console.log(`  Fridge already named "${FRIDGE_NAME}"`);
    }

    for (const p of list) {
      if (String(p._id) === String(fridge._id)) continue;
      if (fridges.some((f) => String(f._id) === String(p._id))) continue;

      const t = String(p.productType || 'good').toLowerCase();
      if (t === 'service' || t === 'farm') {
        skipped += 1;
        continue;
      }
      if (SKIP_KEYS.has(String(p.catalogKey || '').trim())) {
        console.log(`  Skip (own stock): ${p.name}`);
        skipped += 1;
        continue;
      }

      if (String(p.sourceProductId || '') === String(fridge._id)) {
        continue;
      }

      console.log(
        `  Link: ${p.name} ← ${FRIDGE_NAME}` +
          (p.sourceProductId ? ` (was ${p.sourceProductId})` : ' (was none)')
      );
      if (!dryRun) {
        await Product.updateOne(
          { _id: p._id },
          { $set: { sourceProductId: fridge._id } }
        );
      }
      linked += 1;
    }
  }

  console.log(`\nDone. renamed=${renamed} linked=${linked} skipped=${skipped}`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
