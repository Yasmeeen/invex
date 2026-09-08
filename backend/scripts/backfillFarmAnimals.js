import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Product from '../src/DB/models/product.model.js';
import FarmAnimal from '../src/DB/models/farmAnimal.model.js';
import { registerPurchasedFarmAnimals } from '../src/modules/farm_animals_module/service.js';
import { isFarmProduct, roundFarmHeads } from '../src/utils/product-type.util.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function main() {
  const uri = String(process.env.MONGO_URI || process.env['MONGO_URI '] || '').trim();
  if (!uri) throw new Error('MONGO_URI missing');
  await mongoose.connect(uri);

  const products = await Product.find({
    $or: [{ productType: 'farm' }, { catalogKey: /^farm_/ }],
    stock: { $gt: 0 },
  });
  const report = [];
  for (const product of products) {
    if (!isFarmProduct(product)) continue;
    const tracked = await FarmAnimal.aggregate([
      {
        $match: {
          product: product._id,
          status: { $in: ['available', 'reserved'] },
        },
      },
      { $group: { _id: null, share: { $sum: '$remainingShare' } } },
    ]);
    const trackedShare = roundFarmHeads(tracked[0]?.share || 0);
    const missing = roundFarmHeads(Math.max(0, Number(product.stock) - trackedShare));
    if (missing < 0.25) continue;
    const animals = await registerPurchasedFarmAnimals({
      product,
      purchaseRequest: null,
      quantity: missing,
      unitNet: product.netPrice,
      actorId: null,
    });
    report.push({
      product: product.name,
      code: product.code,
      missingShare: missing,
      serials: animals.map((animal) => animal.serial),
    });
  }
  console.log(JSON.stringify(report, null, 2));
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
