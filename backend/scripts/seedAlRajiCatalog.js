/**
 * Seed جزارا الراجي catalog + slaughter templates into existing branches.
 *
 *   node scripts/seedAlRajiCatalog.js
 *   node scripts/seedAlRajiCatalog.js --branch-id <id>
 *   node scripts/seedAlRajiCatalog.js --enable-store-flags
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';

import Branch from '../src/DB/models/branch.model.js';
import Category from '../src/DB/models/category.model.js';
import Product from '../src/DB/models/product.model.js';
import StoreSettings from '../src/DB/models/storeSettings.model.js';
import SlaughterTemplate from '../src/DB/models/slaughterTemplate.model.js';

import {
  AL_RAJI_CATEGORIES,
  AL_RAJI_SLAUGHTER_TEMPLATES,
  AL_RAJI_STORE_FLAGS,
} from './alRajiCatalogData.js';
import { scaleCodeForSku } from './alRajiScaleCodes.js';
import { normalizeProductType } from '../src/utils/product-type.util.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const branchIdArg = (() => {
  const i = process.argv.indexOf('--branch-id');
  return i >= 0 ? String(process.argv[i + 1] || '').trim() : '';
})();
const enableStoreFlags = process.argv.includes('--enable-store-flags');

async function upsertCategory(catDef) {
  let category = await Category.findOne({ code: catDef.code });
  if (!category) {
    category = await Category.create({
      name: catDef.name,
      code: catDef.code,
      sellByWeight: !!catDef.sellByWeight,
      weightUnit: catDef.weightUnit || 'kg',
      multiCodePerPiece: false,
      deleteProductWhenOutOfStock: false,
      showProductCodeOnInvoice: true,
      attributeDefs: [],
    });
    console.log(`  + category ${catDef.code}`);
  }
  return category;
}

async function seedBranch(branch, categoryByCode) {
  let created = 0;
  let linked = 0;
  const sourceByKey = new Map();
  const createdRows = [];

  for (const catDef of AL_RAJI_CATEGORIES) {
    const category = categoryByCode.get(catDef.code);
    for (const p of catDef.products) {
      const skuKey = p.skuKey;
      let product = await Product.findOne({ catalogKey: skuKey, branch: branch._id });
      const scaleCode = scaleCodeForSku(skuKey);
      const code =
        scaleCode || `${catDef.code}-${String(skuKey).replace(/_/g, '-')}`.slice(0, 40);
      if (!product) {
        const isCut = !!(p.sourceKey && !p.isSource);
        const productType = normalizeProductType(p.productType);
        product = await Product.create({
          name: p.name,
          code,
          price: p.price,
          netPrice: p.netPrice,
          stock: isCut ? 0 : Number(p.stock ?? 0),
          discount: 0,
          category: category._id,
          branch: branch._id,
          inWarehouse: false,
          productType,
          catalogKey: skuKey,
          ...(p.sellByWeightOverride !== undefined
            ? { sellByWeightOverride: p.sellByWeightOverride }
            : {}),
        });
        created += 1;
      } else if (scaleCode && product.code !== scaleCode) {
        product.code = scaleCode;
        await product.save();
      }
      createdRows.push({ product, def: p });
      if (p.isSource || (!p.sourceKey && skuKey)) {
        sourceByKey.set(skuKey, product);
      }
    }
  }

  for (const row of createdRows) {
    if (row.def.isSource || !row.def.sourceKey) continue;
    const src = sourceByKey.get(row.def.sourceKey);
    if (!src) continue;
    if (String(row.product.sourceProductId || '') !== String(src._id)) {
      row.product.sourceProductId = src._id;
      row.product.stock = 0;
      await row.product.save();
      linked += 1;
    }
  }

  return { created, linked };
}

async function seedTemplates() {
  let n = 0;
  for (const t of AL_RAJI_SLAUGHTER_TEMPLATES) {
    await SlaughterTemplate.findOneAndUpdate(
      { code: t.code },
      { code: t.code, name: t.name, farmSkuKey: t.farmSkuKey, outputs: t.outputs },
      { upsert: true }
    );
    n += 1;
  }
  return n;
}

async function main() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.error('Missing MONGO_URI');
    process.exit(1);
  }
  await mongoose.connect(uri);
  console.log('Connected');

  if (enableStoreFlags) {
    const settings = await StoreSettings.findOne().sort({ updatedAt: -1 });
    if (settings) {
      settings.weightSalesEnabled = true;
      settings.cutFromSourceEnabled = true;
      settings.businessActivityType = 'butcher';
      await settings.save();
      console.log('Store flags: butcher activity + weight + cut-from-source enabled');
    } else {
      await StoreSettings.create({
        storeName: 'جزارا الراجي',
        ...AL_RAJI_STORE_FLAGS,
      });
      console.log('Created store settings with butcher flags');
    }
  }

  const categoryByCode = new Map();
  for (const catDef of AL_RAJI_CATEGORIES) {
    const cat = await upsertCategory(catDef);
    categoryByCode.set(catDef.code, cat);
  }

  const branchFilter = branchIdArg ? { _id: branchIdArg } : {};
  const branches = await Branch.find(branchFilter);
  if (!branches.length) {
    console.error('No branches found');
    process.exit(1);
  }

  for (const branch of branches) {
    const { created, linked } = await seedBranch(branch, categoryByCode);
    console.log(`Branch ${branch.name}: +${created} products, ${linked} cut links`);
  }

  const templates = await seedTemplates();
  console.log(`Slaughter templates upserted: ${templates}`);

  await mongoose.disconnect();
  console.log('Done');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
