/**
 * Keep only PROC_MEAT (مصنعات اللحوم) products on a branch; delete the rest.
 * Also clears sourceProductId on kept products (factory manages own stock).
 *
 *   node scripts/pruneBranchToProcMeat.mjs --branch-name "مصنع الراجي"
 *   node scripts/pruneBranchToProcMeat.mjs --branch-id <id>
 *   node scripts/pruneBranchToProcMeat.mjs --branch-name "مصنع الراجي" --dry-run
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';

import Branch from '../src/DB/models/branch.model.js';
import Category from '../src/DB/models/category.model.js';
import Product from '../src/DB/models/product.model.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const dryRun = process.argv.includes('--dry-run');
const branchIdArg = (() => {
  const i = process.argv.indexOf('--branch-id');
  return i >= 0 ? String(process.argv[i + 1] || '').trim() : '';
})();
const branchNameArg = (() => {
  const i = process.argv.indexOf('--branch-name');
  return i >= 0 ? String(process.argv[i + 1] || '').trim() : '';
})();

async function main() {
  if (!branchIdArg && !branchNameArg) {
    console.error('Usage: --branch-id <id> OR --branch-name <name> [--dry-run]');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);

  let branch;
  if (branchIdArg) {
    branch = await Branch.findById(branchIdArg);
  } else {
    branch = await Branch.findOne({ name: new RegExp(branchNameArg.trim(), 'i') });
  }
  if (!branch) {
    console.error('Branch not found');
    process.exit(1);
  }

  const procMeat = await Category.findOne({ code: 'PROC_MEAT' });
  if (!procMeat) {
    console.error('Category PROC_MEAT not found');
    process.exit(1);
  }

  console.log(`Branch: ${branch.name} (${branch._id})`);
  console.log(`Keep category: ${procMeat.name} (${procMeat.code})`);
  if (dryRun) console.log('DRY RUN — no changes\n');

  const keep = await Product.find({
    branch: branch._id,
    category: procMeat._id,
  })
    .select('name code catalogKey sourceProductId stock transferReservedQuantity')
    .lean();

  const toDelete = await Product.find({
    branch: branch._id,
    category: { $ne: procMeat._id },
  })
    .select('name code catalogKey stock transferReservedQuantity')
    .lean();

  const blocked = toDelete.filter((p) => Number(p.transferReservedQuantity || 0) > 0);
  if (blocked.length) {
    console.error(`Cannot delete ${blocked.length} product(s) with pending transfers:`);
    blocked.forEach((p) => console.error(`  - ${p.name} (${p.code}) reserved=${p.transferReservedQuantity}`));
    process.exit(1);
  }

  console.log(`\nKeep (${keep.length}):`);
  keep.forEach((p) => console.log(`  + ${p.name}`));
  console.log(`\nDelete (${toDelete.length}):`);
  toDelete.forEach((p) => console.log(`  - ${p.name}`));

  if (dryRun) {
    console.log('\nDry run complete.');
    await mongoose.disconnect();
    return;
  }

  const delResult = await Product.deleteMany({
    _id: { $in: toDelete.map((p) => p._id) },
  });

  const clearResult = await Product.updateMany(
    { branch: branch._id, category: procMeat._id },
    { $unset: { sourceProductId: 1 } }
  );

  const remaining = await Product.countDocuments({ branch: branch._id });
  console.log(`\nDeleted: ${delResult.deletedCount}`);
  console.log(`Cleared sourceProductId on: ${clearResult.modifiedCount}`);
  console.log(`Products remaining on branch: ${remaining}`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
