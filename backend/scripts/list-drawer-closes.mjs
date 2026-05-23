import dotenv from 'dotenv';
import mongoose from 'mongoose';
import moment from 'moment-timezone';

dotenv.config();

const today = moment.tz('Africa/Cairo').format('YYYY-MM-DD');

await mongoose.connect(process.env.MONGO_URI);
const coll = mongoose.connection.collection('drawercloses');

const rows = await coll.find({}).sort({ createdAt: -1 }).limit(15).toArray();
console.log('Today (Cairo):', today);
console.log('Recent drawer closes:');
for (const r of rows) {
  console.log(
    JSON.stringify({
      _id: String(r._id),
      businessDate: r.businessDate,
      periodStart: r.periodStartDate,
      periodEnd: r.periodEndDate,
      branch: String(r.branch),
      actual: r.actualCashCounted,
      retained: r.retainedCash,
      deposited: r.depositedCash,
      createdAt: r.createdAt,
    })
  );
}

const todayRows = await coll.find({ businessDate: today }).toArray();
console.log(`\nMatching businessDate=${today}:`, todayRows.length);

await mongoose.disconnect();
