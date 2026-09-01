import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Product from './src/DB/models/product.model.js';
import Branch from './src/DB/models/branch.model.js';
import './src/DB/models/category.model.js';
import { buildProductHistoryEvents } from './src/utils/product-history.js';

const CODE = process.argv[2] || '356365564905872';

dotenv.config({ path: './.env' });
const uri = process.env.MONGO_URI;
console.log('DB host:', uri?.replace(/:[^:@]+@/, ':****@'));

await mongoose.connect(uri);
console.log('Connected to db:', mongoose.connection.name);

const byCode = await Product.find({ code: CODE })
  .populate('branch', 'name createdAt')
  .populate('category', 'name')
  .lean();

const byId = mongoose.Types.ObjectId.isValid(CODE) && CODE.length === 24
  ? await Product.find({ _id: CODE })
      .populate('branch', 'name createdAt')
      .populate('category', 'name')
      .lean()
  : [];

const products = byCode.length ? byCode : byId;

if (!products.length) {
  console.log('No product found for code/id:', CODE);
  await mongoose.disconnect();
  process.exit(1);
}

console.log('\n=== PRODUCT ROWS ===');
for (const p of products) {
  console.log(JSON.stringify({
    _id: String(p._id),
    code: p.code,
    name: p.name,
    stock: p.stock,
    price: p.price,
    branch: p.branch?.name || null,
    branchId: p.branch?._id ? String(p.branch._id) : null,
    inWarehouse: p.inWarehouse,
    removedWhenOutOfStock: p.removedWhenOutOfStock,
    bookingStatus: p.bookingStatus,
    bookedQuantity: p.bookedQuantity,
    addedBy: p.addedBy,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    category: p.category?.name,
  }, null, 2));
}

// List all branches with creation dates
const branches = await Branch.find({}).select('name createdAt').sort({ createdAt: 1 }).lean();
console.log('\n=== ALL BRANCHES (by creation date) ===');
for (const b of branches) {
  console.log(`${b.createdAt?.toISOString?.() || b.createdAt} — ${b.name} (${b._id})`);
}

// Orders containing this code
const Order = (await import('./src/DB/models/order.model.js')).default;
const orders = await Order.find({
  $or: [
    { 'products.code': CODE },
    ...(mongoose.Types.ObjectId.isValid(CODE) ? [{ 'products.productId': new mongoose.Types.ObjectId(CODE) }] : []),
  ],
})
  .populate('branch', 'name')
  .sort({ createdAt: -1 })
  .lean();

console.log('\n=== ORDERS ===');
for (const o of orders) {
  const line = (o.products || []).find((p) => String(p.code) === CODE || String(p.productId) === CODE);
  console.log(JSON.stringify({
    orderNumber: o.orderNumber,
    status: o.status,
    createdAt: o.createdAt,
    branch: o.branch?.name,
    clientName: o.clientName,
    qty: line?.quantity,
    price: line?.price,
    returns: (o.returns || []).length,
  }));
}

// Branch transfers
const ProductBranchTransfer = (await import('./src/DB/models/productBranchTransfer.model.js')).default;
const pids = products.map((p) => p._id);
const transfers = await ProductBranchTransfer.find({
  $or: [{ product: { $in: pids } }, { destinationProduct: { $in: pids } }],
})
  .populate('fromBranch toBranch', 'name createdAt')
  .populate('initiatedBy resolvedBy', 'name')
  .sort({ createdAt: -1 })
  .lean();

console.log('\n=== BRANCH TRANSFERS ===');
for (const t of transfers) {
  console.log(JSON.stringify({
    status: t.status,
    qty: t.quantity,
    from: t.fromBranch?.name,
    to: t.toBranch?.name,
    toBranchCreatedAt: t.toBranch?.createdAt,
    requestedAt: t.createdAt,
    resolvedAt: t.resolvedAt,
    initiatedBy: t.initiatedBy?.name,
    resolvedBy: t.resolvedBy?.name,
    destinationProductId: t.destinationProduct ? String(t.destinationProduct) : null,
  }));
}

for (const p of products) {
  console.log(`\n=== HISTORY for ${p.code} @ ${p.branch?.name || 'warehouse'} (${p._id}) ===`);
  const { events } = await buildProductHistoryEvents(p, { relatedProducts: products });
  for (const e of [...events].reverse()) {
    console.log(`${e.occurredAt} | ${e.type} | ${e.actorName || '-'} | ${e.summary}`);
    if (e.details && Object.keys(e.details).length) {
      const d = { ...e.details };
      delete d.before;
      delete d.after;
      if (Object.keys(d).length) console.log('  ', JSON.stringify(d));
    }
  }
}

console.log('\n=== SUMMARY ===');
console.log(`Rows with same code: ${products.length}`);
console.log(`Total visible stock: ${products.filter((p) => !p.removedWhenOutOfStock).reduce((s, p) => s + (p.stock || 0), 0)}`);
console.log(`Orders found: ${orders.length}`);
console.log(`Branch transfers: ${transfers.length}`);

await mongoose.disconnect();
