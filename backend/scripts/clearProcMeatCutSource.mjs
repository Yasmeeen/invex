/**
 * Clear cut-from-source (sourceProductId) on processed categories.
 * Products keep own stock; client can re-link from the UI if needed.
 *
 *   node scripts/clearProcMeatCutSource.mjs
 *   node scripts/clearProcMeatCutSource.mjs --dry-run
 *   node scripts/clearProcMeatCutSource.mjs --codes PROC_POULTRY
 *   node scripts/clearProcMeatCutSource.mjs --codes PROC_MEAT,PROC_POULTRY
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';

import Category from '../src/DB/models/category.model.js';
import Product from '../src/DB/models/product.model.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const dryRun = process.argv.includes('--dry-run');
const codesArg = (() => {
  const i = process.argv.indexOf('--codes');
  return i >= 0 ? String(process.argv[i + 1] || '').trim() : '';
})();
const categoryCodes = (codesArg || 'PROC_MEAT,PROC_POULTRY')
  .split(',')
  .map((c) => c.trim())
  .filter(Boolean);

async function clearCategory(code) {
  const category = await Category.findOne({ code });
  if (!category) {
    console.error(`Category ${code} not found — skip`);
    return 0;
  }

  const linked = await Product.find({
    category: category._id,
    sourceProductId: { $ne: null },
  })
    .select('name code catalogKey sourceProductId branch')
    .lean();

  console.log(`\nCategory: ${category.name} (${category.code})`);
  console.log(`Products with cut-source link: ${linked.length}`);
  linked.forEach((p) => console.log(`  - ${p.name} (${p.code || p.catalogKey})`));

  if (dryRun || !linked.length) return linked.length;

  const result = await Product.updateMany(
    { category: category._id, sourceProductId: { $ne: null } },
    { $unset: { sourceProductId: 1 } }
  );
  console.log(`Cleared sourceProductId on: ${result.modifiedCount}`);
  return result.modifiedCount;
}

async function main() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.error('Missing MONGO_URI');
    process.exit(1);
  }

  await mongoose.connect(uri);
  if (dryRun) console.log('DRY RUN — no changes');

  let total = 0;
  for (const code of categoryCodes) {
    total += await clearCategory(code);
  }

  console.log(`\nDone. Total cleared/matched: ${total}`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
