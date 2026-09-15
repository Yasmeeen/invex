/**
 * Fix Book1 installment due dates that were shifted -1 day by xlsx cellDates TZ bug.
 *
 * Re-reads docs/Book1.xlsx with Excel serials (DD/MM semantics via SSF) and rebuilds
 * dueDate for each installment from sheet "تاريخ استحقاق القسط", preserving paid flags.
 * paidAt is only moved when it still equals the old dueDate (import-generated).
 *
 * Usage:
 *   node scripts/fixBook1InstallmentDates.js --dry-run
 *   node scripts/fixBook1InstallmentDates.js
 */
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import XLSX from "xlsx";

import Order from "../src/DB/models/order.model.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const DRY_RUN = process.argv.includes("--dry-run");

function addMonths(base, months) {
  const d = new Date(base);
  d.setHours(12, 0, 0, 0);
  d.setMonth(d.getMonth() + months);
  return d;
}

function parseDueDate(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const parsed = XLSX.SSF.parse_date_code(raw);
    if (parsed) {
      return new Date(parsed.y, parsed.m - 1, parsed.d, 12, 0, 0, 0);
    }
  }
  const s = String(raw).trim();
  const m1 = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m1) {
    return new Date(Number(m1[3]), Number(m1[2]) - 1, Number(m1[1]), 12, 0, 0, 0);
  }
  const m2 = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m2) {
    return new Date(Number(m2[1]), Number(m2[2]) - 1, Number(m2[3]), 12, 0, 0, 0);
  }
  return null;
}

function sameCalendarDay(a, b) {
  if (!a || !b) return false;
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

function ymd(d) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}

function readSheetNextDue(xlsxPath) {
  const wb = XLSX.readFile(xlsxPath, { cellDates: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: true });
  const map = new Map();
  for (const row of rows) {
    const saleNumber = Number(row["رقم العميل"] ?? row["رقم العميل "]);
    if (!Number.isFinite(saleNumber) || saleNumber <= 0) continue;
    const nextDue = parseDueDate(
      row["تاريخ استحقاق القسط"] ?? row["تاريخ الاستحقاق"]
    );
    const remaining = Math.max(
      0,
      Math.floor(Number(row["عدد الاقساط المتبقيه"]) || 0)
    );
    const total = Math.max(
      1,
      Math.floor(Number(row["اجمالى عدد الاقساط"]) || 1)
    );
    map.set(saleNumber, { nextDue, remaining, total, paidCount: Math.max(0, total - remaining) });
  }
  return map;
}

async function main() {
  const xlsxPath =
    process.env.BOOK1_XLSX_PATH ||
    path.join(__dirname, "..", "..", "docs", "Book1.xlsx");
  if (!fs.existsSync(xlsxPath)) throw new Error(`Excel not found: ${xlsxPath}`);

  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGO_URI missing");

  await mongoose.connect(uri);
  console.log(DRY_RUN ? "🔎 DRY RUN" : "✍️  LIVE fix");
  console.log(`📄 ${xlsxPath}`);

  const sheet = readSheetNextDue(xlsxPath);
  const saleNumbers = [...sheet.keys()];
  const orders = await Order.find({
    paymentMethod: "installment",
    installmentSaleNumber: { $in: saleNumbers },
  }).select("installmentSaleNumber installments");

  let updated = 0;
  let skippedNoDate = 0;
  let skippedNoChange = 0;
  let missingOrder = saleNumbers.length;
  const samples = [];

  const found = new Set();
  const ops = [];

  for (const order of orders) {
    const sn = Number(order.installmentSaleNumber);
    found.add(sn);
    const meta = sheet.get(sn);
    if (!meta?.nextDue) {
      skippedNoDate += 1;
      continue;
    }

    const installments = Array.isArray(order.installments)
      ? order.installments.map((i) => (i.toObject ? i.toObject() : { ...i }))
      : [];
    if (!installments.length) {
      skippedNoDate += 1;
      continue;
    }

    // Prefer paid flags on the order; fall back to sheet paidCount
    let paidCount = installments.filter((i) => i.paid).length;
    if (paidCount === 0 && meta.paidCount > 0) paidCount = meta.paidCount;
    // If more paid than sheet said (manual payments), keep paidCount from DB
    paidCount = Math.min(paidCount, installments.length);

    const nextDue = meta.nextDue;
    // Anchor: first unpaid (or last if all paid) should land on sheet nextDue
    // when there are remaining installments; if all paid, shift schedule so
    // last installment is on nextDue (rare for Book1 open books).
    const anchorIndex =
      paidCount < installments.length ? paidCount : installments.length - 1;

    const newDates = installments.map((_, i) =>
      addMonths(nextDue, i - anchorIndex)
    );

    let changed = false;
    for (let i = 0; i < installments.length; i++) {
      const oldDue = installments[i].dueDate;
      const newDue = newDates[i];
      if (!sameCalendarDay(oldDue, newDue)) {
        changed = true;
        if (
          installments[i].paidAt &&
          sameCalendarDay(installments[i].paidAt, oldDue)
        ) {
          installments[i].paidAt = new Date(newDue);
        }
        installments[i].dueDate = new Date(newDue);
      }
    }

    if (!changed) {
      skippedNoChange += 1;
      continue;
    }

    updated += 1;
    if (samples.length < 5 || sn === 1361) {
      samples.push({
        sale: sn,
        sheetNextDue: ymd(nextDue),
        paidCount,
        beforeFirstUnpaid: ymd(
          order.installments[anchorIndex]?.dueDate || order.installments[0]?.dueDate
        ),
        afterFirstUnpaid: ymd(installments[anchorIndex]?.dueDate),
      });
    }

    if (!DRY_RUN) {
      ops.push({
        updateOne: {
          filter: { _id: order._id },
          update: { $set: { installments } },
        },
      });
    }
  }

  missingOrder = saleNumbers.length - found.size;

  if (!DRY_RUN && ops.length) {
    const CHUNK = 100;
    for (let i = 0; i < ops.length; i += CHUNK) {
      await Order.bulkWrite(ops.slice(i, i + CHUNK), { ordered: false });
    }
  }

  console.log("\n—— Summary ——");
  console.log(`Sheet sales:     ${saleNumbers.length}`);
  console.log(`Orders found:    ${found.size}`);
  console.log(`Orders updated:  ${updated}`);
  console.log(`No change:       ${skippedNoChange}`);
  console.log(`No date/empty:   ${skippedNoDate}`);
  console.log(`Missing orders:  ${missingOrder}`);
  console.log("\nSamples:");
  for (const s of samples.sort((a, b) => (a.sale === 1361 ? -1 : b.sale === 1361 ? 1 : 0))) {
    console.log(
      `  #${s.sale} sheet=${s.sheetNextDue} paid=${s.paidCount} unpaidDue ${s.beforeFirstUnpaid} → ${s.afterFirstUnpaid}`
    );
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
