/**
 * Upload product photos from a local folder tree to Cloudinary and set Product.imageUrl.
 *
 * Folder layout (category subfolders optional):
 *   PRODUCT_IMAGES_DIR/
 *     كندوز/إنتركوت.png
 *     عسل/عسل زهور.png
 *     ...
 *
 * Matching: image basename (without extension) ↔ Product.name
 * Unicode NFC + light Arabic normalization is applied so macOS NFD filenames still match.
 *
 * Usage:
 *   PRODUCT_IMAGES_DIR="/path/to/صور المنتجات" node scripts/seedProductImagesFromFolder.mjs
 *   PRODUCT_IMAGES_DIR="..." node scripts/seedProductImagesFromFolder.mjs --force
 *   PRODUCT_IMAGES_DIR="..." node scripts/seedProductImagesFromFolder.mjs --dry-run
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v2 as cloudinary } from 'cloudinary';

import Product from '../src/DB/models/product.model.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const FORCE = process.argv.includes('--force');
const DRY_RUN = process.argv.includes('--dry-run');
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

const ASSETS_DIR =
  process.env.PRODUCT_IMAGES_DIR ||
  path.resolve(__dirname, '../assets/product-images');

function normalizeName(s) {
  return String(s || '')
    .normalize('NFC')
    .replace(/\u0640/g, '') // tatweel
    .replace(/[\u064B-\u065F\u0670]/g, '') // harakat
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function walkImages(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walkImages(full));
    else if (IMAGE_EXTS.has(path.extname(ent.name).toLowerCase())) out.push(full);
  }
  return out;
}

function ensureCloudinary() {
  const url = String(process.env.CLOUDINARY_URL || '').trim();
  const cloudName = String(process.env.CLOUDINARY_CLOUD_NAME || '').trim();
  const apiKey = String(process.env.CLOUDINARY_API_KEY || '').trim();
  const apiSecret = String(process.env.CLOUDINARY_API_SECRET || '').trim();
  if (url) {
    cloudinary.config({ secure: true });
    return true;
  }
  if (cloudName && apiKey && apiSecret) {
    cloudinary.config({
      cloud_name: cloudName,
      api_key: apiKey,
      api_secret: apiSecret,
      secure: true,
    });
    return true;
  }
  return false;
}

function resolveCloudinaryFolder() {
  const envRoot = String(process.env.CLOUDINARY_FOLDER || '')
    .trim()
    .replace(/^\/+|\/+$/g, '');
  const sub = 'products';
  return envRoot ? `${envRoot}/${sub}` : sub;
}

function publicIdFromName(name) {
  // Keep Arabic letters; replace unsafe path chars only.
  const base = normalizeName(name)
    .replace(/[\/\\?#%&]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 120);
  return base || `product_${Date.now()}`;
}

async function uploadFile(filePath, publicId) {
  const folder = resolveCloudinaryFolder();
  const uploaded = await cloudinary.uploader.upload(filePath, {
    folder,
    public_id: publicId,
    overwrite: true,
    resource_type: 'image',
    timeout: 120000,
  });
  return uploaded.secure_url;
}

async function main() {
  const uri = String(process.env.MONGO_URI || '').trim();
  if (!uri) {
    console.error('❌ MONGO_URI missing');
    process.exit(1);
  }
  if (!DRY_RUN && !ensureCloudinary()) {
    console.error('❌ Cloudinary is not configured');
    process.exit(1);
  }

  const files = walkImages(ASSETS_DIR);
  if (!files.length) {
    console.error(`❌ No images found in: ${ASSETS_DIR}`);
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log('✅ Connected to MongoDB');
  console.log(`📁 Assets: ${ASSETS_DIR}`);
  console.log(`🖼️  Files: ${files.length}`);
  if (!DRY_RUN) console.log(`☁️  Cloudinary folder: ${resolveCloudinaryFolder()}`);
  if (DRY_RUN) console.log('🔍 Dry run — no uploads / DB writes');
  if (FORCE) console.log('⚠️  --force: will overwrite existing imageUrl');

  const products = await Product.find({})
    .select('_id name code imageUrl')
    .lean();

  const byNorm = new Map();
  for (const p of products) {
    const k = normalizeName(p.name);
    if (!byNorm.has(k)) byNorm.set(k, []);
    byNorm.get(k).push(p);
  }

  let updatedProducts = 0;
  let uploadedFiles = 0;
  let skippedFiles = 0;
  let unmatchedFiles = 0;

  for (const filePath of files) {
    const base = path.basename(filePath, path.extname(filePath));
    const key = normalizeName(base);
    const hits = byNorm.get(key) || [];

    if (!hits.length) {
      console.warn(`⚠️  No product for image: ${base}`);
      unmatchedFiles += 1;
      continue;
    }

    const needsUpdate = hits.filter((p) => {
      const has = p.imageUrl && String(p.imageUrl).trim();
      return FORCE || !has;
    });

    if (!needsUpdate.length) {
      console.log(`⏭  ${base} — all ${hits.length} product(s) already have image`);
      skippedFiles += 1;
      continue;
    }

    if (DRY_RUN) {
      console.log(
        `✓ would update ${needsUpdate.length}/${hits.length} for "${hits[0].name}" ← ${path.relative(ASSETS_DIR, filePath)}`
      );
      updatedProducts += needsUpdate.length;
      uploadedFiles += 1;
      continue;
    }

    const publicId = publicIdFromName(hits[0].name);
    console.log(`⬆️  ${hits[0].name} (${needsUpdate.length} row(s))…`);
    const secureUrl = await uploadFile(filePath, publicId);

    const ids = needsUpdate.map((p) => p._id);
    const res = await Product.updateMany(
      { _id: { $in: ids } },
      { $set: { imageUrl: secureUrl } }
    );
    const n = res.modifiedCount ?? res.nModified ?? ids.length;
    updatedProducts += n;
    uploadedFiles += 1;
    console.log(`   ✅ ${secureUrl}`);

    // Keep in-memory state so later duplicate filenames don't re-upload unnecessarily
    for (const p of needsUpdate) p.imageUrl = secureUrl;
  }

  console.log('\n✅ Product images done');
  console.log(`   Uploaded files: ${uploadedFiles}`);
  console.log(`   Product rows updated: ${updatedProducts}`);
  console.log(`   Skipped files: ${skippedFiles}`);
  console.log(`   Unmatched files: ${unmatchedFiles}`);
  if (skippedFiles && !FORCE) {
    console.log('   Tip: use --force to replace existing images');
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
