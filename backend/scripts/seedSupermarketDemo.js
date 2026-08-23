/**
 * Seed an Egyptian butcher demo (fridge sources, cut SKUs, clients, vendors, invoices).
 *
 * Usage:
 *   node scripts/seedSupermarketDemo.js          # seed if empty
 *   node scripts/seedSupermarketDemo.js --fresh  # wipe demo collections then seed
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';

import moment from 'moment-timezone';

import Branch from '../src/DB/models/branch.model.js';
import Category from '../src/DB/models/category.model.js';
import Client from '../src/DB/models/client.model.js';
import DailyExpense from '../src/DB/models/dailyExpense.model.js';
import Order from '../src/DB/models/order.model.js';
import Product from '../src/DB/models/product.model.js';
import StoreSettings from '../src/DB/models/storeSettings.model.js';
import User from '../src/DB/models/user.model.js';
import Vendor from '../src/DB/models/vendor.model.js';
import TreasuryLedgerEntry from '../src/DB/models/treasuryLedgerEntry.model.js';

import {
  DEMO_BRANCHES,
  DEMO_CATEGORIES,
  DEMO_CLIENTS,
  DEMO_STORE,
  DEMO_USERS,
  DEMO_VENDORS,
} from './supermarketDemoData.js';
import { pickProductImageUrl } from './productImageUrls.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const FRESH = process.argv.includes('--fresh');
const ORDER_COUNT = Number(process.env.SEED_ORDER_COUNT || 520);
/** Cairo calendar day that should show net loss in the profit report. */
const PROFIT_LOSS_DAY = Number(process.env.SEED_PROFIT_LOSS_DAY || 15);
const REPORT_TZ = 'Africa/Cairo';

const DEMO_COLLECTIONS = [
  'orders',
  'products',
  'categories',
  'clients',
  'vendors',
  'branches',
  'users',
  'storesettings',
  'auditlogs',
  'stockmovements',
  'notifications',
  'drawercloses',
  'productbookings',
  'productpurchaserequests',
  'productbranchtransfers',
  'purchasingrequests',
  'dailyexpenses',
  'treasuryledgerentries',
  'treasuryaccountopenings',
  'clientcashdrawerreceipts',
  'vendorcashdrawerreceipts',
  'vendorcashdrawerpayments',
];

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomPhone(baseIndex) {
  return `010${String(1000000 + baseIndex).slice(-8)}`;
}

async function clearDemoCollections() {
  const db = mongoose.connection.db;
  for (const name of DEMO_COLLECTIONS) {
    try {
      const exists = await db.listCollections({ name }).hasNext();
      if (exists) {
        await db.collection(name).deleteMany({});
        console.log(`  🗑  Cleared ${name}`);
      }
    } catch (e) {
      console.warn(`  ⚠️  Skip clear ${name}:`, e.message);
    }
  }
}

async function seedBranches() {
  const map = new Map();
  for (const b of DEMO_BRANCHES) {
    const doc = await Branch.create({
      name: b.name,
      storeAddress: b.storeAddress,
      rent: b.rent,
      employeesSalary: b.employeesSalary,
      branchInvoices: b.branchInvoices ?? 0,
      expenses: b.expenses ?? 0,
      openingDate: new Date(Date.now() - 180 * 86400000),
      salespeople: b.salespeople.map((name) => ({ name, active: true })),
      deliveryStaff: (b.deliveryStaff || []).map((name) => ({ name, active: true })),
    });
    map.set(b.key, doc);
  }
  return map;
}

async function seedUsers(branchMap) {
  const users = [];
  for (const u of DEMO_USERS) {
    const branchKey = u.branchKey;
    const branchDoc = branchKey ? branchMap.get(branchKey) : branchMap.get('maadi');
    const doc = await User.create({
      name: u.name,
      email: u.email,
      password: u.password,
      role: u.role,
      locale: u.locale,
      branch: branchDoc?._id,
      mustChangePassword: false,
    });
    users.push({ ...u, doc });
  }
  return users;
}

async function seedStoreSettings() {
  await StoreSettings.deleteMany({});
  await StoreSettings.create({
    storeName: DEMO_STORE.storeName,
    storePhoneNumber: DEMO_STORE.storePhoneNumber,
    receiptLanguage: DEMO_STORE.receiptLanguage,
    weightSalesEnabled: DEMO_STORE.weightSalesEnabled,
    cutFromSourceEnabled: DEMO_STORE.cutFromSourceEnabled,
    deliveryOrdersEnabled: DEMO_STORE.deliveryOrdersEnabled,
    cashierPurchaseExchangeEnabled: DEMO_STORE.cashierPurchaseExchangeEnabled,
    returnExchangePolicy: 'اللحوم والدواجن الطازجة لا تُسترد بعد الخروج. الاسترجاع خلال ساعتين للمنتجات المغلقة فقط.',
    showReturnExchangePolicyOnReceipt: true,
    bookingPolicy: '',
    showBookingPolicyOnReceipt: false,
    paymentMethodsCatalog: [
      { key: 'cash', label: 'كاش', showIn: 'both', effectMode: 'instant', feePercent: 0 },
      { key: 'visa', label: 'فيزا / ماستركارد', showIn: 'sale', effectMode: 'instant', feePercent: 0 },
      { key: 'vodafone_cash', label: 'فودافون كاش', showIn: 'both', effectMode: 'instant', feePercent: 0 },
      { key: 'credit', label: 'بيع بالآجل', showIn: 'sale', effectMode: 'none', feePercent: 0 },
    ],
    purchaseTreasuryMethods: [
      { key: 'cash', label: 'كاش' },
      { key: 'bank_misr', label: 'بنك مصر' },
      { key: 'vodafone_cash', label: 'فودافون كاش' },
    ],
    moneyAccounts: [
      { key: 'cash', label: 'درج الكاش', kind: 'cash', enabled: true },
      { key: 'bank_misr', label: 'بنك مصر', kind: 'treasury', channel: 'bank', enabled: true },
      { key: 'vodafone_cash', label: 'فودافون كاش', kind: 'treasury', channel: 'wallet', enabled: true },
    ],
    paymentMethodAccountMap: [
      { method: 'cash', accountKey: 'cash', mode: 'instant' },
      { method: 'visa', accountKey: 'bank_misr', mode: 'instant' },
      { method: 'vodafone_cash', accountKey: 'vodafone_cash', mode: 'instant' },
    ],
  });
}

async function seedCategoriesAndProducts(branchMap) {
  const categoryByCode = new Map();
  const productsByBranch = new Map();
  const imageCounters = new Map();

  for (const branchKey of branchMap.keys()) {
    productsByBranch.set(branchKey, []);
  }

  let codeCounter = 1;
  for (const catDef of DEMO_CATEGORIES) {
    const category = await Category.create({
      name: catDef.name,
      code: catDef.code,
      sellByWeight: !!catDef.sellByWeight,
      weightUnit: catDef.weightUnit || 'kg',
      multiCodePerPiece: false,
      deleteProductWhenOutOfStock: false,
      showProductCodeOnInvoice: true,
      attributeDefs: [],
    });
    categoryByCode.set(catDef.code, category);

    for (const branchKey of branchMap.keys()) {
      const branch = branchMap.get(branchKey);
      const branchProducts = productsByBranch.get(branchKey);

      const sourceByKey = new Map();
      const createdRows = [];
      for (const p of catDef.products) {
        const code = `${catDef.code}-${String(codeCounter).padStart(3, '0')}`;
        codeCounter += 1;
        const imageIdx = imageCounters.get(catDef.code) || 0;
        imageCounters.set(catDef.code, imageIdx + 1);
        const product = await Product.create({
          name: p.name,
          code,
          price: p.price,
          netPrice: p.netPrice,
          stock: p.stock,
          discount: 0,
          category: category._id,
          branch: branch._id,
          inWarehouse: false,
          imageUrl: pickProductImageUrl(catDef.code, code, imageIdx),
        });
        createdRows.push({ product, def: p });
        if (p.isSource && p.sourceKey) {
          sourceByKey.set(p.sourceKey, product);
        }
        branchProducts.push({
          product,
          category,
          sellByWeight: !!catDef.sellByWeight,
          weightUnit: catDef.weightUnit || 'kg',
          isCut: !!(p.sourceKey && !p.isSource),
        });
      }
      for (const row of createdRows) {
        if (row.def.isSource || !row.def.sourceKey) continue;
        const src = sourceByKey.get(row.def.sourceKey);
        if (!src) continue;
        row.product.sourceProductId = src._id;
        await row.product.save();
      }
    }
  }

  return { categoryByCode, productsByBranch, imageCounters };
}

/** Central warehouse replenishment stock (packaged goods + bulk frozen). */
async function seedWarehouseProducts(categoryByCode, imageCounters) {
  let whCodeCounter = 1;
  let count = 0;

  for (const catDef of DEMO_CATEGORIES) {
    const category = categoryByCode.get(catDef.code);
    if (!category) continue;

    const pool = catDef.products.filter(
      (p) => p.isSource || (!p.sourceKey && Number(p.stock) > 0)
    );
    for (const p of pool) {
      const code = `WH-${catDef.code}-${String(whCodeCounter).padStart(3, '0')}`;
      whCodeCounter += 1;
      const imageIdx = imageCounters.get(catDef.code) || 0;
      imageCounters.set(catDef.code, imageIdx + 1);

      await Product.create({
        name: p.name,
        code,
        price: p.price,
        netPrice: p.netPrice,
        stock: Math.max(p.stock, Math.floor(Number(p.stock) * 2)),
        discount: 0,
        category: category._id,
        branch: null,
        inWarehouse: true,
        imageUrl: pickProductImageUrl(catDef.code, code, imageIdx),
      });
      count += 1;
    }
  }

  return count;
}

async function seedClients(branchMap) {
  const branchIds = [...branchMap.values()].map((b) => b._id);
  const docs = [];
  for (let i = 0; i < DEMO_CLIENTS.length; i++) {
    const c = DEMO_CLIENTS[i];
    const doc = await Client.create({
      name: c.name,
      phoneNumber: c.phone,
      address: c.address || '',
      branches: [pick(branchIds), ...(Math.random() > 0.6 ? [pick(branchIds)] : [])],
      creditBalance: 0,
      openingDebitBalance: Math.random() > 0.92 ? round2(rand(500, 3000)) : 0,
    });
    docs.push(doc);
  }
  return docs;
}

async function seedVendors(categoryByCode) {
  const docs = [];
  for (const v of DEMO_VENDORS) {
    const categories = v.categoryCodes
      .map((code) => categoryByCode.get(code)?._id)
      .filter(Boolean);
    const doc = await Vendor.create({
      nameOfcompany: v.nameOfcompany,
      name: v.name,
      phone: v.phone,
      email: v.email || '',
      address: 'القاهرة، مصر',
      transactionCurrency: 'EGP',
      paymentTerms: v.paymentTerms,
      categories,
      creditBalance: round2(rand(0, 15000)),
      buyerPrepaidBalance: 0,
      openingDebitBalance: 0,
    });
    docs.push(doc);
  }
  return docs;
}

function buildOrderLine(entry, { weakDay = false } = {}) {
  const { product, sellByWeight, weightUnit } = entry;
  const isWeight = sellByWeight;
  let quantity;
  if (isWeight) {
    const maxKg = weakDay ? 1.2 : 2.8;
    quantity = round2(rand(weakDay ? 0.2 : 0.4, maxKg));
    if (quantity < 0.15) quantity = 0.25;
  } else {
    quantity = Math.max(1, Math.floor(rand(weakDay ? 1 : 2, weakDay ? 3 : 8)));
  }
  const price = product.price;
  const lineTotal = round2(price * quantity);
  return {
    productId: product._id,
    name: product.name,
    code: product.code,
    quantity,
    saleUnit: isWeight ? 'weight' : 'piece',
    ...(isWeight ? { weightUnit: weightUnit || 'kg' } : {}),
    price,
    cost: product.netPrice,
    isApplyDiscount: false,
    showProductCodeOnInvoice: true,
    ...(product.sourceProductId ? { sourceProductId: product.sourceProductId } : {}),
    lineTotal,
    numberOfProducts: isWeight ? 1 : quantity,
  };
}

/** Calendar days from month start through today (Cairo). */
function listMonthDaysThroughToday() {
  const now = moment.tz(REPORT_TZ);
  const start = now.clone().startOf('month');
  const days = [];
  const daysInRange = now.diff(start, 'days') + 1;
  for (let d = 1; d <= daysInRange; d++) {
    const day = start.clone().date(d);
    if (day.isAfter(now, 'day')) continue;
    days.push(d);
  }
  return days;
}

/** Even slots for green days; a few weak slots for the loss day. */
function buildOrderDaySequence(orderCount) {
  const days = listMonthDaysThroughToday();
  const greenDays = days.filter((d) => d !== PROFIT_LOSS_DAY);
  const hasLossDay = days.includes(PROFIT_LOSS_DAY);
  const lossSlots = hasLossDay ? Math.max(4, Math.floor(orderCount * 0.025)) : 0;
  const greenSlots = orderCount - lossSlots;
  const seq = [];

  if (greenDays.length) {
    for (let i = 0; i < greenSlots; i++) {
      seq.push(greenDays[i % greenDays.length]);
    }
  } else {
    for (let i = 0; i < orderCount; i++) seq.push(days[i % days.length] || 1);
  }
  for (let i = 0; i < lossSlots; i++) seq.push(PROFIT_LOSS_DAY);

  // shuffle lightly so charts aren't perfectly flat by branch timing
  for (let i = seq.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [seq[i], seq[j]] = [seq[j], seq[i]];
  }
  return seq;
}

function makeCreatedAtOnDay(dayOfMonth, hour = null, minute = null) {
  const h = hour == null ? Math.floor(rand(8, 23)) : hour;
  const m = minute == null ? Math.floor(rand(0, 59)) : minute;
  const s = Math.floor(rand(0, 59));
  return moment
    .tz(REPORT_TZ)
    .startOf('month')
    .date(dayOfMonth)
    .hour(h)
    .minute(m)
    .second(s)
    .millisecond(0)
    .toDate();
}

async function seedOrders({ branchMap, productsByBranch, clients, users }) {
  const cashiers = users.filter((u) => u.role === 'Cashier');
  const branchWeights = { maadi: 0.45, nasr: 0.35, zayed: 0.2 };
  const daySequence = buildOrderDaySequence(ORDER_COUNT);

  const orders = [];
  let orderNumber = 1;

  for (let i = 0; i < ORDER_COUNT; i++) {
    const roll = Math.random();
    let branchKey = 'maadi';
    if (roll > branchWeights.maadi) {
      branchKey = roll > branchWeights.maadi + branchWeights.nasr ? 'zayed' : 'nasr';
    }

    const branch = branchMap.get(branchKey);
    const catalog = productsByBranch.get(branchKey) || [];
    const sellable = catalog.filter((e) => e.isCut);
    const pickPool = sellable.length ? sellable : catalog;
    if (!pickPool.length) continue;

    const dayOfMonth = daySequence[i] ?? listMonthDaysThroughToday()[0] ?? 1;
    const weakDay = dayOfMonth === PROFIT_LOSS_DAY;
    const lineCount = weakDay
      ? Math.max(1, Math.floor(rand(1, 3)))
      : Math.max(5, Math.floor(rand(6, 14)));

    const lines = [];
    const used = new Set();
    for (let l = 0; l < lineCount; l++) {
      let entry;
      let tries = 0;
      do {
        entry = pick(pickPool);
        tries += 1;
      } while (used.has(String(entry.product._id)) && tries < 12);
      used.add(String(entry.product._id));
      lines.push(buildOrderLine(entry, { weakDay }));
    }

    const subtotalPrice = round2(lines.reduce((s, ln) => s + ln.lineTotal, 0));
    const invoiceDiscountAmount =
      !weakDay && Math.random() > 0.92 ? round2(subtotalPrice * rand(0.01, 0.03)) : 0;
    const totalPrice = round2(subtotalPrice - invoiceDiscountAmount);
    const numberOfProducts = lines.reduce((s, ln) => s + ln.numberOfProducts, 0);

    const client = pick(clients);
    const cashier = pick(cashiers.length ? cashiers : users);
    const branchSalespeople = DEMO_BRANCHES.find((b) => b.key === branchKey)?.salespeople || [];
    const sellerName = pick(branchSalespeople);

    const payRoll = Math.random();
    let paymentMethod = 'cash';
    let amountPaid = totalPrice;
    let paymentStatus = 'paid';
    const payments = [];
    const createdAt = makeCreatedAtOnDay(dayOfMonth);

    if (payRoll > 0.82) {
      paymentMethod = 'visa';
      payments.push({
        amount: totalPrice,
        paidAt: createdAt,
        paidByUserId: cashier.doc._id,
        branch: branch._id,
        method: 'visa',
        countsTowardInvoice: true,
      });
    } else if (payRoll > 0.72) {
      paymentMethod = 'vodafone_cash';
      payments.push({
        amount: totalPrice,
        paidAt: createdAt,
        paidByUserId: cashier.doc._id,
        branch: branch._id,
        method: 'vodafone_cash',
        countsTowardInvoice: true,
      });
    } else if (payRoll > 0.62) {
      paymentMethod = 'credit';
      amountPaid = round2(totalPrice * rand(0.3, 0.7));
      paymentStatus = amountPaid >= totalPrice - 0.01 ? 'paid' : amountPaid > 0 ? 'partial' : 'unpaid';
      if (amountPaid > 0) {
        payments.push({
          amount: amountPaid,
          paidAt: createdAt,
          paidByUserId: cashier.doc._id,
          branch: branch._id,
          method: 'cash',
          countsTowardInvoice: true,
          note: 'دفعة أولى (آجل)',
        });
      }
    } else {
      payments.push({
        amount: totalPrice,
        paidAt: createdAt,
        paidByUserId: cashier.doc._id,
        branch: branch._id,
        method: 'cash',
        countsTowardInvoice: true,
      });
    }

    const orderProducts = lines.map(({ lineTotal, numberOfProducts: _n, ...rest }) => rest);

    orders.push({
      orderNumber: orderNumber++,
      partyType: 'client',
      clientId: client._id,
      clientName: client.name,
      clientPhoneNumber: client.phoneNumber,
      clientAddress: client.address || '',
      sellerName,
      paymentMethod,
      branch: branch._id,
      products: orderProducts,
      numberOfProducts,
      subtotalPrice,
      invoiceDiscountAmount,
      totalPrice,
      amountPaid,
      paymentStatus,
      payments,
      status: 'completed',
      createdAt,
      updatedAt: createdAt,
    });
  }

  orders.sort((a, b) => a.createdAt - b.createdAt);
  orders.forEach((o, idx) => {
    o.orderNumber = idx + 1;
  });

  await Order.insertMany(orders, { ordered: true });
  // Re-load so treasury backfill has real _ids
  const inserted = await Order.find({})
    .select('_id branch payments createdAt')
    .lean();
  return inserted;
}

/** Mirror order payments into money-account ledger (cash / visa / wallets). */
async function seedTreasuryFromOrders(orders) {
  const methodToAccount = {
    cash: 'cash',
    visa: 'bank_misr',
    vodafone_cash: 'vodafone_cash',
  };
  const docs = [];
  for (const order of orders || []) {
    const branchId = order.branch;
    const orderId = order._id;
    if (!branchId || !orderId) continue;
    const payments = Array.isArray(order.payments) ? order.payments : [];
    for (const p of payments) {
      const method = String(p?.method || '').trim().toLowerCase();
      const amount = round2(p?.amount);
      if (!method || method === 'credit' || !(amount > 0)) continue;
      const accountKey = methodToAccount[method] || method;
      const when = p.paidAt instanceof Date ? p.paidAt : new Date(p.paidAt || order.createdAt || Date.now());
      docs.push({
        branch: branchId,
        accountKey,
        direction: 'in',
        amount,
        occurredAt: when,
        businessDate: moment(when).tz(REPORT_TZ).format('YYYY-MM-DD'),
        sourceType: 'order_payment',
        sourceId: orderId,
        note: method,
        createdBy: p.paidByUserId || null,
      });
    }
  }
  if (!docs.length) return 0;
  await TreasuryLedgerEntry.insertMany(docs, { ordered: false });
  return docs.length;
}

/**
 * Tiny operating costs on green days; one moderate hit on the 15th (only red day, month stays green).
 */
async function seedDailyExpenses({ branchMap, users }) {
  const recorder = users.find((u) => u.role === 'Super Admin') || users[0];
  if (!recorder?.doc?._id) return 0;

  const days = listMonthDaysThroughToday();
  const docs = [];
  const branchList = [...branchMap.values()];

  // ~28k total — enough to sink day 15 without wiping the month
  const lossAmounts = [10000, 9500, 8500];
  for (let i = 0; i < branchList.length; i++) {
    if (!days.includes(PROFIT_LOSS_DAY)) break;
    const branch = branchList[i];
    const amount = lossAmounts[i] ?? 8000;
    const createdAt = makeCreatedAtOnDay(PROFIT_LOSS_DAY, 11, 30 + i * 5);
    docs.push({
      branch: branch._id,
      amount,
      expenseType: 'صيانة طارئة / تلف بضاعة',
      notes: `مصروف استثنائي يوم ${PROFIT_LOSS_DAY} لإظهار يوم خسارة واحد في تقرير الأرباح`,
      recordedBy: recorder.doc._id,
      expenseTreasuryKey: 'cash',
      expenseTreasuryLabel: 'نقدي',
      expenseTreasurySplits: [{ key: 'cash', label: 'نقدي', amount }],
      createdAt,
      updatedAt: createdAt,
    });
  }

  for (const d of days) {
    if (d === PROFIT_LOSS_DAY) continue;
    const branch = pick(branchList);
    const amount = round2(rand(80, 280));
    const createdAt = makeCreatedAtOnDay(d, 10, Math.floor(rand(0, 50)));
    docs.push({
      branch: branch._id,
      amount,
      expenseType: pick(['نثريات', 'نظافة', 'مياه', 'تعبئة وتغليف']),
      notes: 'مصروف يومي تشغيلي',
      recordedBy: recorder.doc._id,
      expenseTreasuryKey: 'cash',
      expenseTreasuryLabel: 'نقدي',
      expenseTreasurySplits: [{ key: 'cash', label: 'نقدي', amount }],
      createdAt,
      updatedAt: createdAt,
    });
  }

  await DailyExpense.insertMany(docs, { ordered: true });
  return docs.length;
}

async function main() {
  const uri = String(process.env.MONGO_URI || '').trim();
  if (!uri) {
    console.error('❌ MONGO_URI missing in backend/.env');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log('✅ Connected to MongoDB');

  if (FRESH) {
    console.log('🔄 --fresh: clearing demo collections…');
    await clearDemoCollections();
  } else {
    const existing = await Category.countDocuments();
    if (existing > 0) {
      console.error('❌ Database already has categories. Pass --fresh to reset and re-seed.');
      await mongoose.disconnect();
      process.exit(1);
    }
  }

  console.log('📦 Seeding branches…');
  const branchMap = await seedBranches();

  console.log('👤 Seeding users…');
  const users = await seedUsers(branchMap);

  console.log('⚙️  Seeding store settings…');
  await seedStoreSettings();

  console.log('🏷️  Seeding categories & products…');
  const { categoryByCode, productsByBranch, imageCounters } =
    await seedCategoriesAndProducts(branchMap);
  const productCount = await Product.countDocuments();
  const categoryCount = await Category.countDocuments();

  console.log('🏭 Seeding central warehouse stock…');
  const warehouseCount = await seedWarehouseProducts(categoryByCode, imageCounters);

  console.log('🧑 Seeding clients…');
  const clients = await seedClients(branchMap);

  console.log('🏭 Seeding vendors…');
  const vendors = await seedVendors(categoryByCode);

  console.log(
    `🧾 Seeding ${ORDER_COUNT} invoices (current month in ${REPORT_TZ}; loss day ${PROFIT_LOSS_DAY})…`
  );
  const seededOrders = await seedOrders({ branchMap, productsByBranch, clients, users });
  const orderCount = seededOrders.length;

  console.log('📒 Seeding treasury ledger from order payments…');
  const ledgerCount = await seedTreasuryFromOrders(seededOrders);

  console.log(`💸 Seeding daily expenses (large hit on day ${PROFIT_LOSS_DAY})…`);
  const expenseCount = await seedDailyExpenses({ branchMap, users });

  console.log('\n✅ Demo butcher shop seeded successfully!\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Store:      ${DEMO_STORE.storeName}`);
  console.log(`  Branches:   ${branchMap.size}`);
  console.log(`  Categories: ${categoryCount}`);
  console.log(`  Products:   ${productCount} (branches + warehouse)`);
  console.log(`  Warehouse:  ${warehouseCount} SKUs`);
  console.log(`  Clients:    ${clients.length}`);
  console.log(`  Vendors:    ${vendors.length}`);
  console.log(`  Invoices:   ${orderCount}`);
  console.log(`  Ledger:     ${ledgerCount}`);
  console.log(`  Expenses:   ${expenseCount}`);
  console.log(`  Profit:     green days except ${PROFIT_LOSS_DAY} of current month`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('\n  Login credentials:');
  for (const u of DEMO_USERS) {
    console.log(`    ${u.email}  /  ${u.password}  (${u.role})`);
  }
  console.log('\n  Weight sales: ENABLED · cut-from-source: ENABLED (قطعيات تسحب من الثلاجة)');
  console.log('');

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('❌ Seed failed:', err);
  try {
    await mongoose.disconnect();
  } catch (_) {
    /* ignore */
  }
  process.exit(1);
});
