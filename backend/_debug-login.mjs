import dotenv from 'dotenv';
import mongoose from 'mongoose';
dotenv.config({ path: './.env' });
const uri = process.env.MONGO_URI;
console.log('Loaded URI host:', uri?.replace(/:[^:@]+@/, ':****@'));
await mongoose.connect(uri);
console.log('db name:', mongoose.connection.name);
const users = await mongoose.connection.db.collection('users').find({}).toArray();
console.log('users in default db:', users.length);
for (const u of users) console.log({ email: u.email, role: u.role, pwPrefix: String(u.password||'').slice(0,10) });

// also list all dbs and users collections
const admin = mongoose.connection.db.admin();
const { databases } = await admin.listDatabases();
console.log('databases:', databases.map(d => d.name));
for (const d of databases) {
  if (['admin','local','config'].includes(d.name)) continue;
  const db = mongoose.connection.client.db(d.name);
  const cols = await db.listCollections().toArray();
  const hasUsers = cols.some(c => c.name === 'users');
  if (hasUsers) {
    const us = await db.collection('users').find({}, { projection: { email: 1, role: 1 } }).toArray();
    console.log(`db=${d.name} users:`, us.map(u => u.email));
  }
}
await mongoose.disconnect();
