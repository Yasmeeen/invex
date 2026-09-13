/**
 * Assign sequential installmentSaleNumber to existing installment sales
 * that do not have one yet (ordered by createdAt ascending).
 *
 * Safe to re-run: only updates orders missing installmentSaleNumber.
 *
 * Usage:
 *   node scripts/backfillInstallmentSaleNumbers.js
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';

import Order from '../src/DB/models/order.model.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('✅ Connected');

  const last = await Order.findOne({
    installmentSaleNumber: { $exists: true, $ne: null },
  })
    .sort({ installmentSaleNumber: -1 })
    .select('installmentSaleNumber')
    .lean();

  let next = Number(last?.installmentSaleNumber || 0) + 1;

  const missing = await Order.find({
    paymentMethod: 'installment',
    status: { $ne: 'restored' },
    $or: [
      { installmentSaleNumber: { $exists: false } },
      { installmentSaleNumber: null },
    ],
  })
    .sort({ createdAt: 1 })
    .select('_id orderNumber createdAt')
    .lean();

  console.log(`Found ${missing.length} installment sales without a sale number`);
  console.log(`Starting from installmentSaleNumber = ${next}`);

  let updated = 0;
  for (const order of missing) {
    await Order.updateOne(
      { _id: order._id },
      { $set: { installmentSaleNumber: next } }
    );
    console.log(
      `  #${next} → order ${order.orderNumber ?? order._id} (${order.createdAt?.toISOString?.() || ''})`
    );
    next += 1;
    updated += 1;
  }

  console.log(`✅ Done. Assigned ${updated} installment sale numbers.`);
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('❌', err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
