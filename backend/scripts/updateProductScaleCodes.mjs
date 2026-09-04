/**
 * Update product codes to match scale PLU numbers (ورقة الميزان).
 *
 *   node scripts/updateProductScaleCodes.mjs
 *   node scripts/updateProductScaleCodes.mjs --dry-run
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';

import Product from '../src/DB/models/product.model.js';
import { SCALE_CODE_BY_SKU } from './alRajiScaleCodes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const dryRun = process.argv.includes('--dry-run');

const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!uri) {
  console.error('Missing MONGO_URI');
  process.exit(1);
}

function productCodeForSku(skuKey) {
  return SCALE_CODE_BY_SKU[String(skuKey || '').trim()] || '';
}

await mongoose.connect(uri);
console.log(dryRun ? 'DRY RUN — no writes' : 'Connected');

const products = await Product.find({
  catalogKey: { $in: Object.keys(SCALE_CODE_BY_SKU) },
}).select('_id name code catalogKey branch').lean();

const byBranch = new Map();
for (const p of products) {
  const branchId = String(p.branch);
  if (!byBranch.has(branchId)) byBranch.set(branchId, []);
  byBranch.get(branchId).push(p);
}

let updated = 0;
let skipped = 0;
const conflicts = [];

for (const [, branchProducts] of byBranch) {
  const targetById = new Map();
  for (const p of branchProducts) {
    const nextCode = productCodeForSku(p.catalogKey);
    if (!nextCode) continue;
    if (p.code === nextCode) {
      skipped += 1;
      continue;
    }
    targetById.set(String(p._id), { product: p, nextCode });
  }

  const codeOwners = new Map();
  for (const p of branchProducts) {
    const owner = codeOwners.get(p.code) || [];
    owner.push(p);
    codeOwners.set(p.code, owner);
  }

  for (const [, { product, nextCode }] of targetById) {
    const existing = branchProducts.find(
      (row) => row.code === nextCode && String(row._id) !== String(product._id)
    );
    if (existing && !targetById.has(String(existing._id))) {
      conflicts.push({
        branch: String(product.branch),
        code: nextCode,
        keep: `${existing.name} (${existing.catalogKey})`,
        want: `${product.name} (${product.catalogKey})`,
      });
    }
  }

  if (conflicts.length) continue;

  const tempPrefix = `__scale_mig_${Date.now()}__`;
  const phase1 = [];
  const phase2 = [];

  for (const [, { product, nextCode }] of targetById) {
    phase1.push({
      updateOne: {
        filter: { _id: product._id },
        update: { $set: { code: `${tempPrefix}${product.catalogKey}` } },
      },
    });
    phase2.push({
      updateOne: {
        filter: { _id: product._id },
        update: { $set: { code: nextCode } },
      },
    });
    console.log(`${dryRun ? '[dry] ' : ''}${product.catalogKey}: ${product.code} → ${nextCode} (${product.name})`);
    updated += 1;
  }

  if (!dryRun && phase1.length) {
    await Product.bulkWrite(phase1, { ordered: true });
    await Product.bulkWrite(phase2, { ordered: true });
  }
}

if (conflicts.length) {
  console.error('\nConflicts — resolve manually before re-running:');
  for (const c of conflicts) {
    console.error(`  code ${c.code}: already "${c.keep}", wanted for "${c.want}"`);
  }
  process.exit(1);
}

await mongoose.disconnect();
console.log(`\nDone. Updated: ${updated}, already correct: ${skipped}`);
