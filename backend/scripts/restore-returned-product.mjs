/**
 * One-off: recreate a product that was hard-deleted on sale and not restored on return.
 * Usage: node scripts/restore-returned-product.mjs NIP-359956460648547
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

import Product from '../src/DB/models/product.model.js';
import Order from '../src/DB/models/order.model.js';
import StockMovement from '../src/DB/models/stockMovement.model.js';
import { restoreProductStockForReturn } from '../src/utils/order-return.js';

const code = String(process.argv[2] || '').trim();
if (!code) {
  console.error('Usage: node scripts/restore-returned-product.mjs <PRODUCT_CODE>');
  process.exit(1);
}

const uri = String(process.env.MONGO_URI || '').trim();
if (!uri) {
  console.error('MONGO_URI missing');
  process.exit(1);
}

await mongoose.connect(uri);

const existing = await Product.findOne({ code });
if (existing && !existing.removedWhenOutOfStock && Number(existing.stock) > 0) {
  console.log('Product already in stock:', {
    _id: String(existing._id),
    stock: existing.stock,
    code: existing.code,
  });
  await mongoose.disconnect();
  process.exit(0);
}

const order = await Order.findOne({ 'products.code': code }).sort({ createdAt: -1 });
if (!order) {
  console.error('No order found for code', code);
  await mongoose.disconnect();
  process.exit(1);
}

const line = (order.products || []).find((p) => String(p.code) === code);
if (!line) {
  console.error('Line not found on order', order.orderNumber);
  await mongoose.disconnect();
  process.exit(1);
}

const fromHistory = (order.returns || []).flatMap((ret) =>
  (ret.items || [])
    .filter((it) => String(it.productId) === String(line.productId))
    .map((it) => Math.floor(Number(it.quantity) || 0))
);
const returnedQty = Math.max(
  Math.floor(Number(line.returnedQuantity) || 0),
  ...fromHistory,
  0
);

const qtyToRestore = returnedQty > 0 ? returnedQty : Math.floor(Number(line.quantity) || 1);

console.log({
  orderNumber: order.orderNumber,
  status: order.status,
  productId: String(line.productId),
  name: line.name,
  returnedQty,
  qtyToRestore,
  existing: existing
    ? { _id: String(existing._id), stock: existing.stock, removed: existing.removedWhenOutOfStock }
    : null,
});

if (existing?.removedWhenOutOfStock) {
  existing.stock = Math.max(0, (Number(existing.stock) || 0) + qtyToRestore);
  existing.removedWhenOutOfStock = false;
  await existing.save();
  console.log('Unhid soft-removed product, stock=', existing.stock);
} else if (!existing) {
  // Product missing: restore as if return qty is being put back (idempotent recreate)
  // Temporarily zero returnedQuantity awareness — restoreProductStockForReturn just adds qty
  const product = await restoreProductStockForReturn(order, line, qtyToRestore);
  console.log('Recreated product:', {
    _id: String(product._id),
    code: product.code,
    stock: product.stock,
    category: String(product.category),
    branch: product.branch ? String(product.branch) : null,
  });

  const alreadyLogged = await StockMovement.findOne({
    movementType: 'return',
    productId: product._id,
    referenceId: order._id,
  });
  if (!alreadyLogged) {
    await StockMovement.create({
      movementType: 'return',
      productId: product._id,
      productName: product.name,
      branchId: order.branch || null,
      fromBranchId: null,
      toBranchId: order.branch || null,
      quantity: qtyToRestore,
      unitPrice: Number(line.price) || 0,
      totalValue: Math.round(qtyToRestore * (Number(line.price) || 0) * 100) / 100,
      referenceType: 'order',
      referenceId: order._id,
      notes: `Manual stock restore after return order #${order.orderNumber}`,
    });
    console.log('Logged return stock movement');
  }
} else {
  existing.stock = Math.max(0, (Number(existing.stock) || 0) + qtyToRestore);
  existing.removedWhenOutOfStock = false;
  await existing.save();
  console.log('Incremented existing stock to', existing.stock);
}

await mongoose.disconnect();
console.log('Done');
