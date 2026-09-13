/**
 * Import historical installment sales from docs/Book1.xlsx into elTyb DB.
 *
 * - Creates category + products (unique by name+cost, #2/#3 suffixes)
 * - Creates/reuses clients by phone (placeholder phones when missing)
 * - Creates installment orders with installmentSaleNumber = sheet "رقم العميل"
 * - Does NOT assign collectors
 * - Does NOT touch stock treasury / cashier sessions
 *
 * Usage:
 *   node scripts/importBook1Installments.js --dry-run
 *   node scripts/importBook1Installments.js
 *
 * Optional env:
 *   IMPORT_BRANCH_ID=<mongo ObjectId>
 *   BOOK1_XLSX_PATH=<absolute path>  (default: ../../docs/Book1.xlsx)
 */
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import XLSX from "xlsx";

import Branch from "../src/DB/models/branch.model.js";
import Category from "../src/DB/models/category.model.js";
import Client from "../src/DB/models/client.model.js";
import Product from "../src/DB/models/product.model.js";
import Order from "../src/DB/models/order.model.js";
import InstallmentPlan from "../src/DB/models/installmentPlan.model.js";
import {
  buildSaleInstallmentSchedule,
  allocateInstallmentProfitShares,
  orderLineTradingProfit,
} from "../src/utils/sale-installments.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const IMPORT_TAG = "book1-import";
const CATEGORY_NAME = "استيراد تقسيط Book1";
const CATEGORY_CODE = "B1IMP";
const DRY_RUN = process.argv.includes("--dry-run");

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function addMonths(base, months) {
  const d = new Date(base);
  d.setHours(12, 0, 0, 0);
  d.setMonth(d.getMonth() + months);
  return d;
}

function parseDueDate(raw) {
  if (raw == null || raw === "") return null;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    const d = new Date(raw);
    d.setHours(12, 0, 0, 0);
    return d;
  }
  if (typeof raw === "number" && Number.isFinite(raw)) {
    // Excel serial date
    const parsed = XLSX.SSF.parse_date_code(raw);
    if (parsed) {
      return new Date(parsed.y, parsed.m - 1, parsed.d, 12, 0, 0, 0);
    }
  }
  const s = String(raw).trim();
  // DD/MM/YYYY
  const m1 = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m1) {
    return new Date(Number(m1[3]), Number(m1[2]) - 1, Number(m1[1]), 12, 0, 0, 0);
  }
  // YYYY-MM-DD
  const m2 = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m2) {
    return new Date(Number(m2[1]), Number(m2[2]) - 1, Number(m2[3]), 12, 0, 0, 0);
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    d.setHours(12, 0, 0, 0);
    return d;
  }
  return null;
}

function normalizePhone(raw, saleNumber) {
  if (raw == null || raw === 0 || raw === "0" || String(raw).trim() === "") {
    return {
      phone: `0199${String(saleNumber).padStart(7, "0")}`.slice(0, 11),
      placeholder: true,
    };
  }
  let s = String(raw).replace(/#/g, "").replace(/\s+/g, "").trim();
  s = s.replace(/[^\d+]/g, "");
  if (!s || s === "0") {
    return {
      phone: `0199${String(saleNumber).padStart(7, "0")}`.slice(0, 11),
      placeholder: true,
    };
  }
  return { phone: s, placeholder: false };
}

function cleanProductName(name) {
  return String(name || "")
    .replace(/\\/g, "/")
    .replace(/\s+/g, " ")
    .trim();
}

function readSheetRows(xlsxPath) {
  const wb = XLSX.readFile(xlsxPath, { cellDates: true });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: true });

  const mapped = [];
  for (const row of rows) {
    const saleNumber = Number(
      row["رقم العميل"] ?? row["رقم العميل "] ?? row["رقم_العميل"]
    );
    if (!Number.isFinite(saleNumber) || saleNumber <= 0) continue;

    const clientName = String(
      row["اسم العميل"] ?? row["اسم العميل  "] ?? ""
    ).trim();
    const phoneRaw = row["رقم التلفون 1"] ?? row["رقم التلفون"] ?? null;
    const cost = round2(row["سعر التكلفة"]);
    const downPayment = round2(row["المقدم"]);
    const financed = round2(row["سعر التمويل"]);
    const salePrice = round2(row["سعر البيع بالقسط"]);
    const installmentAmount = round2(row["قيمة القسط"]);
    const totalInstallments = Math.max(
      1,
      Math.floor(Number(row["اجمالى عدد الاقساط"]) || 1)
    );
    const remainingInstallments = Math.max(
      0,
      Math.floor(Number(row["عدد الاقساط المتبقيه"]) || 0)
    );
    const amountDue = round2(row["اجمالى المبلغ المستحق"]);
    const extra = round2(row["اضافى"] ?? row["اضافى "]);
    const nextDueDate = parseDueDate(
      row["تاريخ استحقاق القسط"] ?? row["تاريخ الاستحقاق"]
    );
    const collector = String(row["المحصل"] ?? "").trim();
    const productName = cleanProductName(
      row["اسم المنتج"] ?? row["اسم المنتج "] ?? ""
    );

    mapped.push({
      saleNumber,
      clientName,
      phoneRaw,
      cost,
      downPayment,
      financed,
      salePrice,
      installmentAmount,
      totalInstallments,
      remainingInstallments,
      amountDue,
      extra,
      nextDueDate,
      collector,
      productName: productName || `منتج مستورد #${saleNumber}`,
    });
  }
  return mapped;
}

async function ensureCategory() {
  let cat = await Category.findOne({ code: CATEGORY_CODE });
  if (!cat) {
    cat = await Category.findOne({ name: CATEGORY_NAME });
  }
  if (!cat) {
    console.log(`➕ Category will be created: ${CATEGORY_NAME}`);
    if (DRY_RUN) {
      return {
        _id: new mongoose.Types.ObjectId(),
        name: CATEGORY_NAME,
        code: CATEGORY_CODE,
        __dry: true,
      };
    }
    cat = await Category.create({
      name: CATEGORY_NAME,
      code: CATEGORY_CODE,
      multiCodePerPiece: false,
      sellByWeight: false,
      deleteProductWhenOutOfStock: false,
      showProductCodeOnInvoice: true,
      productsCount: 0,
      totalItems: 0,
    });
    console.log(`➕ Category created: ${cat.name}`);
  } else {
    console.log(`↻ Category exists: ${cat.name}`);
  }
  return cat;
}

async function ensurePlan(months) {
  let plan = await InstallmentPlan.findOne({ months });
  if (!plan) {
    if (DRY_RUN) {
      return {
        _id: new mongoose.Types.ObjectId(),
        name: `نظام ${months} شهر (استيراد)`,
        months,
        interestPercent: 0,
        enabled: true,
        __dry: true,
      };
    }
    plan = await InstallmentPlan.create({
      name: `نظام ${months} شهر (استيراد)`,
      months,
      interestPercent: 0,
      enabled: true,
      sortOrder: months,
    });
    console.log(`➕ Plan: ${plan.name}`);
  }
  return plan;
}

function buildProductDisplayNames(rows) {
  /** key: `${name}|${cost}` → { baseName, cost, displayName } */
  const byKey = new Map();
  /** baseName → list of costs in first-seen order */
  const costsByName = new Map();

  for (const r of rows) {
    const name = r.productName;
    const cost = round2(r.cost);
    const key = `${name}|${cost}`;
    if (byKey.has(key)) continue;

    if (!costsByName.has(name)) costsByName.set(name, []);
    const list = costsByName.get(name);
    list.push(cost);
    const idx = list.length; // 1-based
    const displayName = idx === 1 ? name : `${name} #${idx}`;
    byKey.set(key, { baseName: name, cost, displayName, index: idx });
  }
  return byKey;
}

async function ensureProducts(rows, category, branchId) {
  const defs = buildProductDisplayNames(rows);
  const productByKey = new Map();
  let created = 0;
  let reused = 0;
  let codeSeq = 1;

  console.log(`📦 Preparing ${defs.size} unique products (name+cost)...`);

  // Load existing B1 products / codes in one query
  const existing = await Product.find({
    $or: [
      { code: { $regex: /^B1-\d+/ } },
      { category: category.__dry ? null : category._id, branch: branchId },
      { addedBy: IMPORT_TAG },
    ].filter((c) => {
      // drop null category clause for dry new category
      if (c.category === null) return false;
      return true;
    }),
  })
    .select("_id name code netPrice price stock category branch")
    .lean();

  const byNameBranch = new Map();
  for (const p of existing) {
    byNameBranch.set(`${p.name}|${String(p.branch)}`, p);
    const m = /^B1-(\d+)$/.exec(String(p.code || ""));
    if (m) codeSeq = Math.max(codeSeq, Number(m[1]) + 1);
  }

  const toInsert = [];

  for (const [key, def] of defs) {
    const existingHit =
      byNameBranch.get(`${def.displayName}|${String(branchId)}`) ||
      existing.find(
        (p) =>
          p.name === def.displayName &&
          round2(p.netPrice) === def.cost &&
          String(p.branch) === String(branchId)
      );

    if (existingHit) {
      reused += 1;
      productByKey.set(key, existingHit);
      continue;
    }

    const sample = rows.find(
      (r) => r.productName === def.baseName && round2(r.cost) === def.cost
    );
    const price = round2(sample?.salePrice || def.cost || 0);
    const code = `B1-${String(codeSeq++).padStart(4, "0")}`;

    const doc = {
      name: def.displayName,
      code,
      price: Math.max(0, price),
      netPrice: Math.max(0, def.cost),
      stock: 0,
      category: category._id,
      branch: branchId,
      inWarehouse: false,
      listedOnEcommerce: false,
      addedBy: IMPORT_TAG,
    };

    if (DRY_RUN) {
      productByKey.set(key, { _id: new mongoose.Types.ObjectId(), ...doc, __dry: true });
      created += 1;
      continue;
    }

    toInsert.push({ key, doc });
  }

  if (!DRY_RUN && toInsert.length) {
    const inserted = await Product.insertMany(
      toInsert.map((t) => t.doc),
      { ordered: false }
    );
    for (let i = 0; i < inserted.length; i++) {
      productByKey.set(toInsert[i].key, inserted[i]);
    }
    created = inserted.length;

    const count = await Product.countDocuments({ category: category._id });
    await Category.updateOne(
      { _id: category._id },
      { $set: { productsCount: count, totalItems: 0 } }
    );
  }

  console.log(`📦 Products: created=${created}, reused=${reused}, unique=${defs.size}`);
  return productByKey;
}

async function ensureClient({ name, phone, branchId, clientCache }) {
  if (clientCache.has(phone)) return clientCache.get(phone);

  let client = null;
  if (!DRY_RUN) {
    client = await Client.findOne({ phoneNumber: phone });
  }

  if (!client) {
    if (DRY_RUN) {
      client = {
        _id: new mongoose.Types.ObjectId(),
        name: name || phone,
        phoneNumber: phone,
        address: "",
        branches: [branchId],
        __dry: true,
      };
    } else {
      client = await Client.create({
        name: name || phone,
        phoneNumber: phone,
        address: "",
        branches: [branchId],
        source: "store",
      });
    }
  } else if (!DRY_RUN) {
    const hasBranch = (client.branches || []).some(
      (b) => String(b) === String(branchId)
    );
    if (!hasBranch) {
      client.branches = [...(client.branches || []), branchId];
      await client.save();
    }
    if (name && (!client.name || client.name === client.phoneNumber)) {
      client.name = name;
      await client.save();
    }
  }

  clientCache.set(phone, client);
  return client;
}

function buildOrderInstallments(row) {
  const months = row.totalInstallments;
  const remaining = Math.min(months, Math.max(0, row.remainingInstallments));
  const paidCount = Math.max(0, months - remaining);
  const monthly = round2(row.installmentAmount);
  const principal = round2(row.financed > 0 ? row.financed : row.salePrice);
  const saleTotal =
    round2(row.salePrice) > 0
      ? round2(row.salePrice)
      : round2(monthly * months);

  let nextDue = row.nextDueDate;
  if (!nextDue) {
    // Fallback: assume next due is today for first unpaid (or last paid + 1 month)
    nextDue = new Date();
    nextDue.setHours(12, 0, 0, 0);
  }

  // First unpaid installment (index paidCount) should fall on nextDue
  const startDate = addMonths(nextDue, -paidCount);

  const built = buildSaleInstallmentSchedule({
    principal,
    interestPercent: 0,
    months,
    startDate,
    monthlyAmountOverride: monthly > 0 ? monthly : undefined,
  });

  // If saleTotal differs from built.totalDue slightly, rebuild with override that matches sheet
  if (monthly > 0 && Math.abs(built.totalDue - saleTotal) > 0.5) {
    // Prefer equal monthly from sheet; last row absorbs to saleTotal
    const installments = [];
    let allocated = 0;
    for (let i = 0; i < months; i++) {
      const due = addMonths(startDate, i);
      const amount =
        i === months - 1 ? round2(saleTotal - allocated) : monthly;
      allocated = round2(allocated + amount);
      installments.push({
        sequence: i + 1,
        dueDate: due,
        amount,
        paid: false,
        paidAmount: 0,
        profitShare: 0,
        recognizedProfit: 0,
        paymentMethod: "",
        note: "",
      });
    }
    built.installments = installments;
    built.totalDue = saleTotal;
  }

  // Force-align unpaid due dates so first unpaid matches sheet next due
  const installments = built.installments.map((r) => ({ ...r }));
  if (paidCount < installments.length && nextDue) {
    const shiftMs =
      nextDue.getTime() - new Date(installments[paidCount].dueDate).getTime();
    if (Math.abs(shiftMs) > 12 * 60 * 60 * 1000) {
      for (let i = paidCount; i < installments.length; i++) {
        installments[i].dueDate = new Date(
          new Date(installments[i].dueDate).getTime() + shiftMs
        );
      }
      // Also shift paid ones to keep monthly spacing
      for (let i = 0; i < paidCount; i++) {
        installments[i].dueDate = addMonths(nextDue, -(paidCount - i));
      }
    } else {
      installments[paidCount].dueDate = new Date(nextDue);
    }
  }

  let amountPaidOnInstallments = 0;
  for (let i = 0; i < paidCount; i++) {
    const rowInst = installments[i];
    if (!rowInst) break;
    rowInst.paid = true;
    rowInst.paidAmount = round2(rowInst.amount);
    rowInst.paidAt = new Date(rowInst.dueDate);
    rowInst.paymentMethod = "cash";
    amountPaidOnInstallments = round2(
      amountPaidOnInstallments + rowInst.amount
    );
  }

  return {
    installments,
    principal,
    interestAmount: round2(Math.max(0, saleTotal - principal)),
    totalDue: saleTotal,
    amountPaidOnInstallments,
    paidCount,
    remaining,
    startDate: installments[0]?.dueDate || startDate,
  };
}

async function main() {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI missing in .env");
  }

  const xlsxPath =
    process.env.BOOK1_XLSX_PATH ||
    path.join(__dirname, "..", "..", "docs", "Book1.xlsx");
  if (!fs.existsSync(xlsxPath)) {
    throw new Error(`Excel file not found: ${xlsxPath}`);
  }

  console.log(DRY_RUN ? "🔎 DRY RUN — no writes" : "🚀 LIVE IMPORT");
  console.log(`📄 File: ${xlsxPath}`);

  await mongoose.connect(process.env.MONGO_URI);
  console.log("✅ Connected");

  let branch;
  if (process.env.IMPORT_BRANCH_ID) {
    branch = await Branch.findById(process.env.IMPORT_BRANCH_ID);
    if (!branch) throw new Error(`Branch not found: ${process.env.IMPORT_BRANCH_ID}`);
  } else {
    branch = await Branch.findOne().sort({ createdAt: 1 });
    if (!branch) throw new Error("No branches found — create a branch first");
  }
  console.log(`🏪 Branch: ${branch.name} (${branch._id})`);

  const rows = readSheetRows(xlsxPath);
  console.log(`📊 Sheet rows: ${rows.length}`);

  const category = await ensureCategory();
  const productByKey = await ensureProducts(rows, category, branch._id);

  const lastOrder = await Order.findOne().sort({ orderNumber: -1 }).lean();
  let nextOrderNumber = Number(lastOrder?.orderNumber || 0) + 1;

  const existingSaleNumbers = new Set(
    (
      await Order.find({
        installmentSaleNumber: { $in: rows.map((r) => r.saleNumber) },
      })
        .select("installmentSaleNumber")
        .lean()
    ).map((o) => Number(o.installmentSaleNumber))
  );

  const planCache = new Map();
  const clientCache = new Map();

  const stats = {
    created: 0,
    skippedExisting: 0,
    placeholderPhones: 0,
    dueMismatch: [],
    missingDueDate: [],
    collectorsSeen: new Map(),
    errors: [],
  };

  for (const row of rows) {
    try {
      if (existingSaleNumbers.has(row.saleNumber)) {
        stats.skippedExisting += 1;
        continue;
      }

      const expectedDue = round2(row.remainingInstallments * row.installmentAmount);
      if (
        row.remainingInstallments > 0 &&
        row.installmentAmount > 0 &&
        Math.abs(expectedDue - row.amountDue) > 1
      ) {
        stats.dueMismatch.push({
          saleNumber: row.saleNumber,
          expectedDue,
          amountDue: row.amountDue,
        });
      }
      if (!row.nextDueDate) {
        stats.missingDueDate.push(row.saleNumber);
      }

      const { phone, placeholder } = normalizePhone(row.phoneRaw, row.saleNumber);
      if (placeholder) stats.placeholderPhones += 1;

      const client = await ensureClient({
        name: row.clientName || `عميل ${row.saleNumber}`,
        phone,
        branchId: branch._id,
        clientCache,
      });

      const productKey = `${row.productName}|${round2(row.cost)}`;
      const product = productByKey.get(productKey);
      if (!product) {
        throw new Error(`Product missing for key ${productKey}`);
      }

      if (!planCache.has(row.totalInstallments)) {
        planCache.set(
          row.totalInstallments,
          await ensurePlan(row.totalInstallments)
        );
      }
      const plan = planCache.get(row.totalInstallments);

      const sched = buildOrderInstallments(row);
      const downPayment = round2(row.downPayment);
      const linePrice = round2(downPayment + sched.totalDue);
      const amountPaid = round2(downPayment + sched.amountPaidOnInstallments);
      const paymentStatus =
        amountPaid <= 0.001
          ? "unpaid"
          : amountPaid + 0.001 >= linePrice
            ? "paid"
            : "partial";

      const products = [
        {
          productId: product._id,
          name: product.name,
          code: product.code,
          quantity: 1,
          price: linePrice,
          cost: round2(row.cost),
        },
      ];

      const totalProfit = orderLineTradingProfit(products);
      allocateInstallmentProfitShares(sched.installments, totalProfit);
      for (const inst of sched.installments) {
        if (inst.paid) {
          inst.recognizedProfit = round2(inst.profitShare || 0);
        }
      }

      const collectorLabel = row.collector || "(فارغ)";
      stats.collectorsSeen.set(
        collectorLabel,
        (stats.collectorsSeen.get(collectorLabel) || 0) + 1
      );

      const orderDoc = {
        partyType: "client",
        clientId: client._id,
        clientName: client.name,
        clientPhoneNumber: client.phoneNumber,
        clientAddress: client.address || "",
        sellerName: IMPORT_TAG,
        paymentMethod: "installment",
        branch: branch._id,
        numberOfProducts: 1,
        subtotalPrice: linePrice,
        invoiceDiscountAmount: 0,
        totalPrice: linePrice,
        amountPaid,
        paymentStatus,
        payments:
          downPayment > 0
            ? [
                {
                  amount: downPayment,
                  paidAt: sched.startDate,
                  method: "cash",
                  countsTowardInvoice: true,
                  note: "مقدم (استيراد Book1)",
                },
              ]
            : [],
        installmentPlanId: plan._id,
        installmentPlanSnapshot: {
          name: plan.name,
          months: plan.months,
          interestPercent: plan.interestPercent || 0,
        },
        installmentStartDate: sched.startDate,
        installmentPrincipal: sched.principal,
        installmentInterestAmount: sched.interestAmount,
        installmentSurchargeAmount: round2(row.extra),
        installmentTotalProfit: totalProfit,
        installments: sched.installments,
        products,
        status: "completed",
        orderNumber: nextOrderNumber,
        installmentSaleNumber: row.saleNumber,
      };

      if (!DRY_RUN) {
        await Order.create(orderDoc);
      }

      nextOrderNumber += 1;
      stats.created += 1;
      existingSaleNumbers.add(row.saleNumber);

      if (stats.created <= 5 || stats.created % 100 === 0) {
        console.log(
          `🧾 #${row.saleNumber} · ${client.name} · ${product.name} · paid ${sched.paidCount}/${row.totalInstallments}`
        );
      }
    } catch (err) {
      stats.errors.push({
        saleNumber: row.saleNumber,
        message: err?.message || String(err),
      });
      console.error(`❌ #${row.saleNumber}:`, err?.message || err);
    }
  }

  console.log("\n======== Book1 import summary ========");
  console.log(`Mode: ${DRY_RUN ? "DRY-RUN" : "LIVE"}`);
  console.log(`Orders created: ${stats.created}`);
  console.log(`Skipped (already exist): ${stats.skippedExisting}`);
  console.log(`Placeholder phones: ${stats.placeholderPhones}`);
  console.log(`Due mismatches (rem*inst ≠ due): ${stats.dueMismatch.length}`);
  if (stats.dueMismatch.length) {
    console.log(
      "  ",
      stats.dueMismatch
        .slice(0, 10)
        .map((d) => `#${d.saleNumber}`)
        .join(", ")
    );
  }
  console.log(`Missing next due date: ${stats.missingDueDate.length}`);
  console.log("Collectors in sheet (for later manual assign):");
  for (const [name, n] of [...stats.collectorsSeen.entries()].sort(
    (a, b) => b[1] - a[1]
  )) {
    console.log(`  ${n}\t${name}`);
  }
  console.log(`Errors: ${stats.errors.length}`);
  if (stats.errors.length) {
    for (const e of stats.errors.slice(0, 20)) {
      console.log(`  #${e.saleNumber}: ${e.message}`);
    }
  }
  console.log("======================================\n");

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error("❌ importBook1Installments failed:", err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
