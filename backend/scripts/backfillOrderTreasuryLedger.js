/**
 * Backfill money-account ledger from existing order payments.
 * Safe to re-run: skips orders that already have order_payment ledger rows.
 *
 * Usage:
 *   node scripts/backfillOrderTreasuryLedger.js
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import moment from 'moment-timezone';
import path from 'path';
import { fileURLToPath } from 'url';

import Order from '../src/DB/models/order.model.js';
import TreasuryLedgerEntry from '../src/DB/models/treasuryLedgerEntry.model.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const BUSINESS_TZ = 'Africa/Cairo';
const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('✅ Connected');

  const orders = await Order.find({
    status: { $ne: 'restored' },
    'payments.0': { $exists: true },
  })
    .select('_id branch payments createdAt')
    .lean();

  console.log(`Found ${orders.length} orders with payments`);

  const already = await TreasuryLedgerEntry.distinct('sourceId', {
    sourceType: 'order_payment',
    sourceId: { $ne: null },
  });
  const done = new Set(already.map((id) => String(id)));

  const methodToAccount = {
    cash: 'cash',
    visa: 'bank_misr',
    vodafone_cash: 'vodafone_cash',
  };

  const docs = [];
  let skipped = 0;
  for (const order of orders) {
    const id = String(order._id);
    if (done.has(id)) {
      skipped += 1;
      continue;
    }
    if (!order.branch) {
      skipped += 1;
      continue;
    }
    for (const p of order.payments || []) {
      const method = String(p?.method || '').trim().toLowerCase();
      const amount = round2(p?.amount);
      if (!method || method === 'credit' || !(amount > 0)) continue;
      const when = p.paidAt ? new Date(p.paidAt) : new Date(order.createdAt || Date.now());
      docs.push({
        branch: order.branch,
        accountKey: methodToAccount[method] || (method === 'cash' ? 'cash' : method),
        direction: 'in',
        amount,
        occurredAt: when,
        businessDate: moment(when).tz(BUSINESS_TZ).format('YYYY-MM-DD'),
        sourceType: 'order_payment',
        sourceId: order._id,
        note: method,
        createdBy: p.paidByUserId || null,
      });
    }
  }

  if (docs.length) {
    await TreasuryLedgerEntry.insertMany(docs, { ordered: false });
  }

  const cashCount = await TreasuryLedgerEntry.countDocuments({ accountKey: 'cash' });
  console.log('\n✅ Backfill done');
  console.log(`  Ledger lines created: ${docs.length}`);
  console.log(`  Orders skipped:      ${skipped}`);
  console.log(`  Cash ledger rows:    ${cashCount}`);

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('❌', err);
  try {
    await mongoose.disconnect();
  } catch (_) {
    /* ignore */
  }
  process.exit(1);
});
