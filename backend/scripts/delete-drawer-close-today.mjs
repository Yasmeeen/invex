import dotenv from 'dotenv';
import mongoose from 'mongoose';
import moment from 'moment-timezone';

dotenv.config();

const dateArg = process.argv[2];
const today = dateArg || moment.tz('Africa/Cairo').format('YYYY-MM-DD');

await mongoose.connect(process.env.MONGO_URI);
const coll = mongoose.connection.collection('drawercloses');

const rows = await coll.find({ businessDate: today }).toArray();
if (!rows.length) {
  console.log(`No drawer close found for businessDate=${today}`);
  await mongoose.disconnect();
  process.exit(0);
}

console.log(`Deleting ${rows.length} drawer close(s) for businessDate=${today}:`);
for (const r of rows) {
  console.log(`  - ${r._id} branch=${r.branch} actual=${r.actualCashCounted}`);
}

const result = await coll.deleteMany({ businessDate: today });
console.log(`Deleted: ${result.deletedCount}`);

await mongoose.disconnect();
