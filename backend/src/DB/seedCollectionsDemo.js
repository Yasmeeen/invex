/**
 * Seed rich collections-dashboard demo data:
 * collectors, clients assigned to them, installment plans, and varied installment invoices
 * (overdue / due soon / promised today / partially collected).
 *
 * Idempotent: removes previous rows tagged with DEMO_TAG / DEMO_PHONE_PREFIX first.
 *
 * Run: node src/DB/seedCollectionsDemo.js
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import User from "./models/user.model.js";
import Client from "./models/client.model.js";
import Branch from "./models/branch.model.js";
import Product from "./models/product.model.js";
import Order from "./models/order.model.js";
import InstallmentPlan from "./models/installmentPlan.model.js";
import { buildSaleInstallmentSchedule } from "../utils/sale-installments.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../../.env") });

const DEMO_TAG = "collections-demo-seed";
const DEMO_PHONE_PREFIX = "0155";
const DEMO_PASSWORD = "Demo@123";

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function addDays(base, days) {
  const d = new Date(base);
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d;
}

function addMonths(base, months) {
  const d = new Date(base);
  d.setHours(12, 0, 0, 0);
  d.setMonth(d.getMonth() + months);
  return d;
}

const COLLECTORS = [
  { name: "أحمد محمد", email: "ahmed.collector@invex.demo" },
  { name: "سارة أحمد", email: "sara.collector@invex.demo" },
  { name: "كريم حسن", email: "karim.collector@invex.demo" },
  { name: "نور الدين", email: "nour.collector@invex.demo" },
];

const CLIENT_NAMES = [
  "شركة النور للتجارة",
  "مؤسسة الأمل",
  "محمود السيد",
  "ياسمين فؤاد",
  "شركة التقنية الحديثة",
  "عمر خالد",
  "هبة عبدالله",
  "مجموعة الشرق",
  "فاطمة حسين",
  "أحمد سمير",
  "شركة الرواد",
  "ليلى منصور",
  "يوسف إبراهيم",
  "ندى كمال",
  "مؤسسة البركة",
  "طارق شوقي",
];

async function cleanupDemo() {
  const demoClients = await Client.find({
    phoneNumber: { $regex: `^${DEMO_PHONE_PREFIX}` },
  })
    .select("_id")
    .lean();
  const clientIds = demoClients.map((c) => c._id);
  if (clientIds.length) {
    const delOrders = await Order.deleteMany({
      $or: [{ clientId: { $in: clientIds } }, { sellerName: DEMO_TAG }],
    });
    const delClients = await Client.deleteMany({ _id: { $in: clientIds } });
    console.log(
      `🧹 Removed demo clients=${delClients.deletedCount}, orders=${delOrders.deletedCount}`
    );
  } else {
    const delOrders = await Order.deleteMany({ sellerName: DEMO_TAG });
    console.log(`🧹 Removed orphan demo orders=${delOrders.deletedCount}`);
  }

  const delUsers = await User.deleteMany({
    email: { $in: COLLECTORS.map((c) => c.email) },
  });
  console.log(`🧹 Removed demo collectors=${delUsers.deletedCount}`);
}

async function ensurePlans() {
  const defs = [
    { name: "نظام ٦ شهور", months: 6, interestPercent: 8, sortOrder: 1 },
    { name: "نظام تقسيط ١٢ شهر", months: 12, interestPercent: 10, sortOrder: 2 },
    { name: "نظام ٢٤ شهر", months: 24, interestPercent: 12, sortOrder: 3 },
  ];
  const plans = [];
  for (const def of defs) {
    let plan = await InstallmentPlan.findOne({ months: def.months });
    if (!plan) {
      plan = await InstallmentPlan.create({ ...def, enabled: true });
      console.log(`➕ Created plan: ${plan.name}`);
    } else {
      plan.enabled = true;
      if (!plan.name) plan.name = def.name;
      await plan.save();
    }
    plans.push(plan);
  }
  return plans;
}

async function ensureCollectors() {
  const created = [];
  for (const c of COLLECTORS) {
    let user = await User.findOne({ email: c.email });
    if (!user) {
      user = await User.create({
        name: c.name,
        email: c.email,
        password: DEMO_PASSWORD,
        role: "Collector",
        locale: "ar",
        mustChangePassword: false,
      });
      console.log(`➕ Collector: ${c.name} <${c.email}>`);
    } else {
      user.name = c.name;
      user.role = "Collector";
      user.password = DEMO_PASSWORD;
      user.mustChangePassword = false;
      await user.save();
      console.log(`↻ Updated collector: ${c.name}`);
    }
    created.push(user);
  }

  // Also keep any existing real collectors in the pool for assignment variety
  const existing = await User.find({ role: "Collector" }).sort({ name: 1 });
  const byId = new Map();
  for (const u of [...created, ...existing]) {
    byId.set(String(u._id), u);
  }
  return [...byId.values()];
}

function buildScenarioInstallments(plan, principal, scenario, now) {
  const startDate = addMonths(now, scenario.startMonthsAgo);
  const built = buildSaleInstallmentSchedule({
    principal,
    interestPercent: plan.interestPercent,
    months: plan.months,
    startDate,
  });

  const installments = built.installments.map((row) => ({ ...row }));
  let amountPaidOnInstallments = 0;

  // Pay first N fully
  for (let i = 0; i < (scenario.paidCount || 0); i++) {
    const row = installments[i];
    if (!row) break;
    row.paid = true;
    row.paidAmount = round2(row.amount);
    // Keep paidAt on/before due date so it stays inside dashboard date filters
    row.paidAt = addDays(row.dueDate, 0);
    row.paymentMethod = "cash";
    amountPaidOnInstallments = round2(amountPaidOnInstallments + row.amount);
  }

  // Partial payment on next
  if (scenario.partialNext && installments[scenario.paidCount || 0]) {
    const row = installments[scenario.paidCount || 0];
    const partial = round2(row.amount * 0.4);
    row.paid = false;
    row.paidAmount = partial;
    row.paidAt = addDays(now, -3);
    row.paymentMethod = "cash";
    amountPaidOnInstallments = round2(amountPaidOnInstallments + partial);
  }

  // Force overdue on specific unpaid rows by shifting due dates into the past
  for (const idx of scenario.forceOverdueIndexes || []) {
    const row = installments[idx];
    if (!row || row.paid) continue;
    row.dueDate = addDays(now, scenario.overdueDays?.[idx] ?? -18);
  }

  // Due soon
  for (const idx of scenario.forceDueSoonIndexes || []) {
    const row = installments[idx];
    if (!row || row.paid) continue;
    row.dueDate = addDays(now, scenario.dueSoonDays?.[idx] ?? 3);
  }

  // Promise today
  for (const idx of scenario.promiseIndexes || []) {
    const row = installments[idx];
    if (!row || row.paid) continue;
    const hour = 10 + (idx % 6);
    const promise = new Date(now);
    promise.setHours(hour, 30, 0, 0);
    row.promiseToPayAt = promise;
    // keep due date overdue or soon so it still shows in collections
    if (!scenario.forceOverdueIndexes?.includes(idx) && !scenario.forceDueSoonIndexes?.includes(idx)) {
      row.dueDate = addDays(now, -5);
    }
  }

  return { ...built, installments, amountPaidOnInstallments };
}

async function main() {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI missing in .env");
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log("✅ Connected");

  await cleanupDemo();

  const branches = await Branch.find().sort({ createdAt: 1 }).lean();
  if (!branches.length) throw new Error("No branches found");

  const product = await Product.findOne().lean();
  if (!product) throw new Error("No products found — create at least one product first");

  const plans = await ensurePlans();
  const collectors = await ensureCollectors();
  const demoCollectors = COLLECTORS.map((def) =>
    collectors.find((c) => c.email === def.email)
  ).filter(Boolean);
  const assignCollectors =
    demoCollectors.length >= 4 ? demoCollectors : collectors.slice(0, 4);

  const now = new Date();
  const clients = [];

  for (let i = 0; i < CLIENT_NAMES.length; i++) {
    const collector = assignCollectors[i % assignCollectors.length];
    const branch = branches[i % branches.length];
    const phone = `${DEMO_PHONE_PREFIX}${String(1000000 + i).slice(-7)}`;
    const client = await Client.create({
      name: CLIENT_NAMES[i],
      phoneNumber: phone,
      address: `عنوان تجريبي ${i + 1} — ${branch.name}`,
      branches: [branch._id],
      collectorId: collector._id,
    });
    clients.push({ client, collector, branch });
    console.log(
      `👤 ${client.name} → محصّل: ${collector.name} | فرع: ${branch.name}`
    );
  }

  const lastOrder = await Order.findOne().sort({ orderNumber: -1 }).lean();
  let nextOrderNumber = Number(lastOrder?.orderNumber || 0) + 1;

  /**
   * Scenario packs per collector so dashboard performance badges vary:
   * excellent ≥90, good ≥75, follow_up ≥60, low <60
   * Window used by dashboard default filters ≈ last 3 months → today.
   */
  const scenariosByCollectorTier = [
    // 0 أحمد → ممتاز (~100% / ~95%)
    [
      {
        label: "excellent-paid",
        planMonths: 6,
        principal: 18000,
        downPayment: 3000,
        startMonthsAgo: -3,
        paidCount: 4,
        forceDueSoonIndexes: [4],
        dueSoonDays: { 4: 12 },
      },
      {
        label: "excellent-almost",
        planMonths: 12,
        principal: 22000,
        downPayment: 4000,
        startMonthsAgo: -3,
        paidCount: 4,
        forceDueSoonIndexes: [4],
        dueSoonDays: { 4: 10 },
      },
    ],
    // 1 سارة → جيد (~78%)
    [
      {
        label: "good-solid",
        planMonths: 6,
        principal: 15000,
        downPayment: 2500,
        startMonthsAgo: -3,
        paidCount: 3,
        forceOverdueIndexes: [3],
        overdueDays: { 3: -8 },
        forceDueSoonIndexes: [4],
        dueSoonDays: { 4: 5 },
      },
      {
        label: "good-partial",
        planMonths: 12,
        principal: 20000,
        downPayment: 3500,
        startMonthsAgo: -3,
        paidCount: 3,
        partialNext: true,
        forceDueSoonIndexes: [4],
        dueSoonDays: { 4: 3 },
      },
    ],
    // 2 كريم → يحتاج متابعة (~65%)
    [
      {
        label: "followup-mixed",
        planMonths: 6,
        principal: 14000,
        downPayment: 2000,
        startMonthsAgo: -3,
        paidCount: 3,
        forceOverdueIndexes: [3],
        overdueDays: { 3: -10 },
        promiseIndexes: [3],
        forceDueSoonIndexes: [4],
        dueSoonDays: { 4: 5 },
      },
      {
        label: "followup-overdue",
        planMonths: 12,
        principal: 18000,
        downPayment: 3000,
        startMonthsAgo: -3,
        paidCount: 2,
        partialNext: true,
        forceOverdueIndexes: [3],
        overdueDays: { 3: -7 },
        promiseIndexes: [3],
        forceDueSoonIndexes: [4],
        dueSoonDays: { 4: 4 },
      },
    ],
    // 3 نور → أداء منخفض (~28%)
    [
      {
        label: "low-heavy-overdue",
        planMonths: 6,
        principal: 16000,
        downPayment: 1500,
        startMonthsAgo: -3,
        paidCount: 1,
        forceOverdueIndexes: [1, 2, 3],
        overdueDays: { 1: -19, 2: -12, 3: -6 },
        promiseIndexes: [1, 2],
      },
      {
        label: "low-late",
        planMonths: 12,
        principal: 24000,
        downPayment: 2000,
        startMonthsAgo: -3,
        paidCount: 1,
        forceOverdueIndexes: [1, 2, 3],
        overdueDays: { 1: -18, 2: -11, 3: -5 },
        promiseIndexes: [1],
        forceDueSoonIndexes: [4],
        dueSoonDays: { 4: 3 },
      },
    ],
  ];

  let createdOrders = 0;

  // 2 orders per client; scenario pack follows the assigned collector tier
  for (let i = 0; i < clients.length; i++) {
    const collectorIdx = i % assignCollectors.length;
    const tierScenarios =
      scenariosByCollectorTier[collectorIdx % scenariosByCollectorTier.length];
    for (let s = 0; s < 2; s++) {
      const scenario = tierScenarios[s % tierScenarios.length];
      const plan =
        plans.find((p) => p.months === scenario.planMonths) || plans[0];
      const { client, collector, branch } = clients[i];
      const principal = round2(scenario.principal + (i % 5) * 500);
      const downPayment = round2(scenario.downPayment);

      const built = buildScenarioInstallments(plan, principal, scenario, now);
      const financedTotal = built.totalDue;
      const linePrice = round2(downPayment + financedTotal);
      const amountPaid = round2(downPayment + built.amountPaidOnInstallments);
      const paymentStatus =
        amountPaid <= 0.001
          ? "unpaid"
          : amountPaid + 0.001 >= linePrice
            ? "paid"
            : "partial";

      const order = await Order.create({
        partyType: "client",
        clientId: client._id,
        clientName: client.name,
        clientPhoneNumber: client.phoneNumber,
        clientAddress: client.address || "",
        sellerName: DEMO_TAG,
        paymentMethod: "installment",
        branch: branch._id,
        numberOfProducts: 1,
        subtotalPrice: linePrice,
        invoiceDiscountAmount: 0,
        totalPrice: linePrice,
        amountPaid,
        paymentStatus,
        payments: [
          {
            amount: downPayment,
            paidAt: addMonths(now, scenario.startMonthsAgo),
            method: "cash",
            countsTowardInvoice: true,
            note: "مقدم (ديمو)",
          },
        ],
        installmentPlanId: plan._id,
        installmentPlanSnapshot: {
          name: plan.name,
          months: plan.months,
          interestPercent: plan.interestPercent,
        },
        installmentStartDate: built.installments[0]?.dueDate,
        installmentPrincipal: built.principal,
        installmentInterestAmount: built.interestAmount,
        installments: built.installments,
        products: [
          {
            productId: product._id,
            name: product.name || "منتج تجريبي",
            code: product.code || `DEMO-${i}`,
            quantity: 1,
            price: linePrice,
            cost: Number(product.cost) || 0,
          },
        ],
        status: "completed",
        orderNumber: nextOrderNumber++,
      });

      createdOrders += 1;
      console.log(
        `🧾 #${order.orderNumber} ${client.name} | ${plan.name} | ${scenario.label} | محصّل ${collector.name}`
      );
    }
  }

  // Keep non-demo clients untouched so collector performance tiers stay clear for demos.
  const reassigned = 0;

  console.log("\n======== Collections demo ready ========");
  console.log(`Collectors (password ${DEMO_PASSWORD}):`);
  for (const c of assignCollectors.filter((u) =>
    COLLECTORS.some((d) => d.email === u.email)
  )) {
    console.log(`  • ${c.name}  |  ${c.email}`);
  }
  console.log(`Demo clients: ${clients.length}`);
  console.log(`Demo installment orders: ${createdOrders}`);
  console.log(`Existing clients assigned to collectors: ${reassigned}`);
  console.log("Open Home → لوحة التحصيلات  (admin)");
  console.log("Login as a collector → /collections (their clients only)");
  console.log("========================================\n");

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error("❌ seedCollectionsDemo failed:", err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
