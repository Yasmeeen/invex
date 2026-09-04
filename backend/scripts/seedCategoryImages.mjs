/**
 * Upload category banner images to Cloudinary and set Category.imageUrl.
 *
 * Usage:
 *   node scripts/seedCategoryImages.mjs
 *   node scripts/seedCategoryImages.mjs --force   # overwrite existing imageUrl
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import { v2 as cloudinary } from 'cloudinary';

import Category from '../src/DB/models/category.model.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const FORCE = process.argv.includes('--force');

const ASSETS_DIR =
  process.env.CATEGORY_IMAGES_DIR ||
  path.resolve(__dirname, '../assets/category-images');

/** category code → image filename (basename in assets folder) */
const CATEGORY_IMAGES = {
  DAIRY: 'DAIRY-ce059c5d-c063-40a6-9daf-f2a4f5308af9.png',
  BETLO: 'BETLO-5b994d6c-cffb-4420-b9f7-4cfa4724475b.png',
  FARM: 'FARM-082bffd3-7f06-43eb-810b-7f5f53a37658.png',
  OFFAL: 'OFFAL-1a6cbade-2868-4e0a-b858-af9c26069692.png',
  SERV: 'SERV-5e2d0d04-2251-4a2f-90de-b2d1a450d90c.png',
  HONEY: 'HONEY-52e03b03-5c5b-4934-9e51-4bb030c3fb89.png',
  DHANI: 'DHANI-1ddeb247-2658-4911-93e6-f2f485c21620.png',
  POULTRY: 'POULTRY-e921a4c6-18a2-43f9-a0cc-b2c179eabfa7.png',
  PROC_POULTRY: 'PROC_POULTRY-bd5d51a3-b39a-4166-9b08-bf926f6f58ef.png',
  KANDOUZ: 'KANDOUZ-f140aad1-4d5e-49c9-972f-b0853e72dc0c.png',
  PROC_MEAT: 'PROC_MEAT-eaba3b8d-5949-4a6f-be40-406bfd437645.png',
};

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
    cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, secure: true });
    return true;
  }
  return false;
}

function resolveCloudinaryFolder() {
  const envRoot = String(process.env.CLOUDINARY_FOLDER || '').trim().replace(/^\/+|\/+$/g, '');
  const sub = 'categories';
  return envRoot ? `${envRoot}/${sub}` : sub;
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
  if (!ensureCloudinary()) {
    console.error('❌ Cloudinary is not configured');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log('✅ Connected to MongoDB');
  console.log(`📁 Assets: ${ASSETS_DIR}`);
  console.log(`☁️  Cloudinary folder: ${resolveCloudinaryFolder()}`);

  let updated = 0;
  let skipped = 0;

  for (const [code, filename] of Object.entries(CATEGORY_IMAGES)) {
    const cat = await Category.findOne({ code }).select('_id name code imageUrl').lean();
    if (!cat) {
      console.warn(`⚠️  Category not found: ${code}`);
      continue;
    }
    if (cat.imageUrl && String(cat.imageUrl).trim() && !FORCE) {
      console.log(`⏭  ${code} (${cat.name}) — already has image`);
      skipped += 1;
      continue;
    }

    const filePath = path.join(ASSETS_DIR, filename);
    const publicId = code.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    console.log(`⬆️  Uploading ${code} (${cat.name})…`);
    const secureUrl = await uploadFile(filePath, publicId);
    await Category.updateOne({ _id: cat._id }, { $set: { imageUrl: secureUrl } });
    console.log(`   ✅ ${secureUrl}`);
    updated += 1;
  }

  console.log('\n✅ Category images done');
  console.log(`   Updated: ${updated}`);
  console.log(`   Skipped: ${skipped}`);
  if (skipped && !FORCE) {
    console.log('   Tip: use --force to replace existing images');
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
