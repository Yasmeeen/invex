/**
 * Wipe today's Cairo test trial: orders, desk purchases, related ledger/movements,
 * and zero كندوز ثلاجة + بتلو ثلاجة stock on the branch that was used.
 *
 *   node scripts/wipeTodayTestTrial.mjs --dry-run
 *   node scripts/wipeTodayTestTrial.mjs
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import moment from 'moment-timezone';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const dryRun = process.argv.includes('--dry-run');
const TZ = 'Africa/Cairo';
const BRANCH_ID = '6a8cc31ea531fb7226184fb1';
const KANDOUZ_FRIDGE_ID = '6a8daefa034eaad4dd601ecd';
const BETLO_FRIDGE_ID = '6a8daf14034eaad4dd601f2d';
const VENDOR_ID = '6a9ad791e15b5756ece57db5';

async function main() {
  const uri = String(process.env.MONGO_URI || process.env.MONGODB_URI || '').trim();
  if (!uri) {
    console.error('❌ MONGO_URI missing in backend/.env');
    process.exit(1);
  }

  await mongoose.connect(uri);
  const db = mongoose.connection.db;

  const today = moment.tz(TZ).format('YYYY-MM-DD');
  const start = moment.tz(today, TZ).startOf('day').toDate();
  const end = moment.tz(today, TZ).endOf('day').toDate();
  const branchOid = new mongoose.Types.ObjectId(BRANCH_ID);
  const fridgeOids = [
    new mongoose.Types.ObjectId(KANDOUZ_FRIDGE_ID),
    new mongoose.Types.ObjectId(BETLO_FRIDGE_ID),
  ];

  console.log(`Business day (Cairo): ${today}`);
  if (dryRun) console.log('🔍 DRY RUN — no writes\n');

  const orders = await db
    .collection('orders')
    .find({ createdAt: { $gte: start, $lte: end }, branch: branchOid })
    .project({ orderNumber: 1, totalPrice: 1, paymentStatus: 1, createdAt: 1 })
    .sort({ orderNumber: 1 })
    .toArray();
  const orderIds = orders.map((o) => o._id);

  const purchases = await db
    .collection('usedphonepurchases')
    .find({ createdAt: { $gte: start, $lte: end }, branch: branchOid })
    .project({
      productPayload: 1,
      quantity: 1,
      status: 1,
      purchaseTreasurySplits: 1,
      linkedPurchasingRequestId: 1,
      createdProductId: 1,
      createdAt: 1,
    })
    .sort({ createdAt: 1 })
    .toArray();
  const purchaseIds = purchases.map((p) => p._id);
  const purchasingRequestIds = purchases
    .map((p) => p.linkedPurchasingRequestId)
    .filter(Boolean)
    .map((id) => new mongoose.Types.ObjectId(String(id)));

  const purchasingRequests = purchasingRequestIds.length
    ? await db
        .collection('purchasingrequests')
        .find({ _id: { $in: purchasingRequestIds } })
        .toArray()
    : [];

  const treasuryFilter = {
    $or: [
      { sourceId: { $in: [...orderIds, ...purchaseIds, ...purchasingRequestIds] } },
      {
        businessDate: today,
        branch: branchOid,
        sourceType: { $in: ['order_payment', 'vendor_payment', 'desk_purchase'] },
      },
    ],
  };
  const treasury = await db.collection('treasuryledgerentries').find(treasuryFilter).toArray();

  const movements = await db
    .collection('stockmovements')
    .find({
      $or: [
        { referenceId: { $in: orderIds } },
        { referenceId: { $in: purchaseIds } },
        {
          createdAt: { $gte: start, $lte: end },
          productId: { $in: fridgeOids },
        },
      ],
    })
    .toArray();

  const fridges = await db
    .collection('products')
    .find({ _id: { $in: fridgeOids } })
    .project({ name: 1, stock: 1, netPrice: 1 })
    .toArray();

  const vendor = await db.collection('vendors').findOne(
    { _id: new mongoose.Types.ObjectId(VENDOR_ID) },
    { projection: { name: 1, ledgerEntries: 1 } }
  );
  const vendorLedgerToRemove = (vendor?.ledgerEntries || []).filter((e) => {
    const prId = e.purchasingRequestId ? String(e.purchasingRequestId) : '';
    return purchasingRequestIds.some((id) => String(id) === prId);
  });

  console.log('\n=== Will remove ===');
  console.log('Orders:', orders.length);
  for (const o of orders) {
    console.log(`  #${o.orderNumber} total=${o.totalPrice} ${o.paymentStatus}`);
  }
  console.log('Purchases:', purchases.length);
  for (const p of purchases) {
    console.log(
      `  ${p.productPayload?.name} qty=${p.quantity} treasury=${JSON.stringify(p.purchaseTreasurySplits)}`
    );
  }
  console.log('Purchasing requests:', purchasingRequests.length);
  for (const r of purchasingRequests) {
    console.log(
      `  ${r.notes || r._id} total=${r.totalAmount} paid=${r.amountPaid} status=${r.paymentStatus}`
    );
  }
  console.log('Treasury ledger entries:', treasury.length);
  for (const e of treasury) {
    console.log(
      `  ${e.sourceType} ${e.direction} ${e.amount} ${e.accountKey} — ${e.note || ''}`
    );
  }
  console.log('Stock movements:', movements.length);
  console.log('Vendor ledger entries to pull:', vendorLedgerToRemove.length);
  console.log('Fridge stock before:');
  for (const f of fridges) {
    console.log(`  ${f.name}: ${f.stock}`);
  }

  if (dryRun) {
    console.log('\n🔍 DRY RUN complete — no changes');
    await mongoose.disconnect();
    return;
  }

  if (orderIds.length) {
    const delOrders = await db.collection('orders').deleteMany({ _id: { $in: orderIds } });
    console.log('\n✅ Orders deleted:', delOrders.deletedCount);
  }

  if (purchaseIds.length) {
    const delPurchases = await db
      .collection('usedphonepurchases')
      .deleteMany({ _id: { $in: purchaseIds } });
    console.log('✅ Purchases deleted:', delPurchases.deletedCount);
  }

  if (purchasingRequestIds.length) {
    const delPr = await db
      .collection('purchasingrequests')
      .deleteMany({ _id: { $in: purchasingRequestIds } });
    console.log('✅ Purchasing requests deleted:', delPr.deletedCount);
  }

  if (treasury.length) {
    const delTreasury = await db.collection('treasuryledgerentries').deleteMany({
      _id: { $in: treasury.map((e) => e._id) },
    });
    console.log('✅ Treasury entries deleted:', delTreasury.deletedCount);
  }

  if (movements.length) {
    const delMov = await db.collection('stockmovements').deleteMany({
      _id: { $in: movements.map((m) => m._id) },
    });
    console.log('✅ Stock movements deleted:', delMov.deletedCount);
  }

  if (vendorLedgerToRemove.length) {
    const pullIds = vendorLedgerToRemove.map((e) => e._id);
    const vendorUpdate = await db.collection('vendors').updateOne(
      { _id: new mongoose.Types.ObjectId(VENDOR_ID) },
      { $pull: { ledgerEntries: { _id: { $in: pullIds } } } }
    );
    console.log('✅ Vendor ledger entries removed:', vendorUpdate.modifiedCount, `(${pullIds.length} ids)`);
  }

  const stockUpdate = await db.collection('products').updateMany(
    { _id: { $in: fridgeOids } },
    { $set: { stock: 0, transferReservedQuantity: 0 } }
  );
  console.log('✅ Fridge stock zeroed:', stockUpdate.modifiedCount);

  const verifyOrders = await db.collection('orders').countDocuments({
    createdAt: { $gte: start, $lte: end },
    branch: branchOid,
  });
  const verifyPurchases = await db.collection('usedphonepurchases').countDocuments({
    createdAt: { $gte: start, $lte: end },
    branch: branchOid,
  });
  const verifyFridges = await db
    .collection('products')
    .find({ _id: { $in: fridgeOids } })
    .project({ name: 1, stock: 1 })
    .toArray();
  const verifyVendor = await db.collection('vendors').findOne(
    { _id: new mongoose.Types.ObjectId(VENDOR_ID) },
    { projection: { ledgerEntries: 1, name: 1 } }
  );

  console.log('\n=== Verify ===');
  console.log('Orders remaining today (branch):', verifyOrders);
  console.log('Purchases remaining today (branch):', verifyPurchases);
  console.log(
    'Fridge stock:',
    verifyFridges.map((f) => `${f.name}=${f.stock}`).join(', ')
  );
  console.log('Vendor ledger remaining:', (verifyVendor?.ledgerEntries || []).length);
  console.log('Done.');

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
