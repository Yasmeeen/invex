/**
 * Void desk-purchase cash impact on the drawer, keep fridge stock.
 *
 * Target: كندوز ثلاجة purchase 70000 نقدي (2026-09-13)
 *
 *   node scripts/voidPurchaseCashKeepStock.mjs --dry-run
 *   node scripts/voidPurchaseCashKeepStock.mjs
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const dryRun = process.argv.includes('--dry-run');
const PURCHASE_ID = '6aa6dd18e61dd8d4d777e7dd';

async function main() {
  const uri = String(process.env.MONGO_URI || process.env.MONGODB_URI || '').trim();
  if (!uri) {
    console.error('❌ MONGO_URI missing in backend/.env');
    process.exit(1);
  }

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  const oid = new mongoose.Types.ObjectId(PURCHASE_ID);

  const purchase = await db.collection('usedphonepurchases').findOne({ _id: oid });
  if (!purchase) {
    console.error('❌ Purchase not found:', PURCHASE_ID);
    process.exit(1);
  }

  const productId = purchase.createdProductId
    ? new mongoose.Types.ObjectId(String(purchase.createdProductId))
    : null;
  const product = productId
    ? await db
        .collection('products')
        .findOne(
          { _id: productId },
          { projection: { name: 1, stock: 1, netPrice: 1, catalogKey: 1 } }
        )
    : null;

  const ledger = await db
    .collection('treasuryledgerentries')
    .find({ sourceType: 'desk_purchase', sourceId: oid, accountKey: 'cash', direction: 'out' })
    .toArray();

  const stockBefore = product?.stock;
  console.log('Purchase:', {
    id: String(purchase._id),
    name: purchase.productPayload?.name,
    qty: purchase.quantity,
    treasury: purchase.purchaseTreasurySplits,
    status: purchase.status,
  });
  console.log('Fridge product stock (will KEEP):', stockBefore);
  console.log(
    'Cash ledger outs to remove:',
    ledger.map((e) => ({ id: String(e._id), amount: e.amount, businessDate: e.businessDate }))
  );

  if (dryRun) {
    console.log('\n🔍 DRY RUN — no writes');
    await mongoose.disconnect();
    return;
  }

  const note =
    'ملغاة مالياً (إلغاء أثر الدرج) مع الاحتفاظ بالمخزون — voidPurchaseCashKeepStock';

  const purchaseUpdate = await db.collection('usedphonepurchases').updateOne(
    { _id: oid },
    {
      $set: {
        purchaseTreasuryKey: 'voided_no_cash',
        purchaseTreasuryLabel: 'ملغاة — بدون أثر درج',
        purchaseTreasurySplits: [
          {
            key: 'voided_no_cash',
            label: 'ملغاة — بدون أثر درج',
            amount: 70000,
          },
        ],
        resolutionNote: note,
        updatedAt: new Date(),
      },
    }
  );
  console.log('✅ Purchase treasury updated:', purchaseUpdate.modifiedCount);

  if (ledger.length) {
    const del = await db.collection('treasuryledgerentries').deleteMany({
      _id: { $in: ledger.map((e) => e._id) },
    });
    console.log('✅ Deleted cash ledger entries:', del.deletedCount);
  } else {
    console.log('ℹ️ No cash ledger entries to delete');
  }

  const productAfter = productId
    ? await db
        .collection('products')
        .findOne({ _id: productId }, { projection: { stock: 1, name: 1 } })
    : null;
  console.log('✅ Fridge stock unchanged:', productAfter?.stock);

  const verifyPurchase = await db.collection('usedphonepurchases').findOne(
    { _id: oid },
    { projection: { purchaseTreasurySplits: 1, purchaseTreasuryKey: 1, resolutionNote: 1 } }
  );
  console.log('Verify treasury:', verifyPurchase?.purchaseTreasurySplits);
  console.log('Done.');

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
