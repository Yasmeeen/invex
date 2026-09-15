/**
 * Assign collectors on Book1-imported installment orders from docs/Book1.xlsx.
 *
 * Maps sheet "المحصل" → User (Collector / Co Admin / Super Admin).
 * Sets order.collectorId; then client.collectorId when the client has a single
 * distinct collector across their Book1 orders.
 *
 * Usage:
 *   node scripts/assignBook1Collectors.js --dry-run
 *   node scripts/assignBook1Collectors.js
 *
 * Optional:
 *   BOOK1_XLSX_PATH=<absolute path>
 */
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import XLSX from "xlsx";

import Client from "../src/DB/models/client.model.js";
import Order from "../src/DB/models/order.model.js";
import User from "../src/DB/models/user.model.js";
import { isAssignableCollectorRole } from "../src/modules/collections_module/service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const DRY_RUN = process.argv.includes("--dry-run");

/** Sheet label → canonical user name in DB */
const COLLECTOR_ALIASES = {
  هاني: "هاني",
  عصام: "عصام",
  "الشيخ عصام": "عصام",
  "نور الدين": "نور الدين",
  زياد: "زياد الطيب",
  "زياد الطيب": "زياد الطيب",
  // حسين الطيب → زياد الطيب (same collector account)
  حسين: "زياد الطيب",
  "حسين الطيب": "زياد الطيب",
};

function normalizeLabel(raw) {
  return String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function readSheetAssignments(xlsxPath) {
  const wb = XLSX.readFile(xlsxPath, { cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: true });
  const out = [];
  for (const row of rows) {
    const saleNumber = Number(
      row["رقم العميل"] ?? row["رقم العميل "] ?? row["رقم_العميل"]
    );
    if (!Number.isFinite(saleNumber) || saleNumber <= 0) continue;
    const collectorLabel = normalizeLabel(row["المحصل"]);
    out.push({ saleNumber, collectorLabel });
  }
  return out;
}

async function main() {
  const xlsxPath =
    process.env.BOOK1_XLSX_PATH ||
    path.join(__dirname, "..", "..", "docs", "Book1.xlsx");
  if (!fs.existsSync(xlsxPath)) {
    throw new Error(`Excel file not found: ${xlsxPath}`);
  }

  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGO_URI missing");

  await mongoose.connect(uri);
  console.log(DRY_RUN ? "🔎 DRY RUN" : "✍️  LIVE assign");
  console.log(`📄 ${xlsxPath}`);

  const rows = readSheetAssignments(xlsxPath);
  const users = await User.find({}).select("name email role").lean();
  const usersByName = new Map(
    users.map((u) => [normalizeLabel(u.name), u]).filter(([k]) => k)
  );

  const saleNumbers = rows.map((r) => r.saleNumber);
  const orders = await Order.find({
    paymentMethod: "installment",
    installmentSaleNumber: { $in: saleNumbers },
  })
    .select("_id collectorId clientId installmentSaleNumber")
    .lean();

  const orderBySale = new Map(
    orders.map((o) => [Number(o.installmentSaleNumber), o])
  );

  const stats = {
    sheetRows: rows.length,
    updatedOrders: 0,
    alreadySet: 0,
    unchangedSame: 0,
    orderMissing: 0,
    skippedNoLabel: 0,
    skippedUnmapped: 0,
    skippedBadRole: 0,
    byCollector: new Map(),
    unmappedLabels: new Map(),
  };

  /** clientId → Map(collectorId → count) */
  const clientCollectorVotes = new Map();
  /** orderId → new collector ObjectId */
  const orderUpdates = [];

  for (const { saleNumber, collectorLabel } of rows) {
    if (!collectorLabel) {
      stats.skippedNoLabel += 1;
      continue;
    }

    const canonical = COLLECTOR_ALIASES[collectorLabel];
    if (!canonical) {
      stats.skippedUnmapped += 1;
      stats.unmappedLabels.set(
        collectorLabel,
        (stats.unmappedLabels.get(collectorLabel) || 0) + 1
      );
      continue;
    }

    const user = usersByName.get(canonical);
    if (!user) {
      const key = `${collectorLabel}→${canonical}(missing user)`;
      stats.skippedUnmapped += 1;
      stats.unmappedLabels.set(key, (stats.unmappedLabels.get(key) || 0) + 1);
      continue;
    }
    if (!isAssignableCollectorRole(user.role)) {
      stats.skippedBadRole += 1;
      console.warn(
        `⚠️  ${user.name} role=${user.role} not assignable — sale #${saleNumber}`
      );
      continue;
    }

    const order = orderBySale.get(saleNumber);
    if (!order) {
      stats.orderMissing += 1;
      continue;
    }

    const current = order.collectorId ? String(order.collectorId) : null;
    const next = String(user._id);

    if (current === next) {
      stats.unchangedSame += 1;
    } else {
      if (current) stats.alreadySet += 1;
      orderUpdates.push({ orderId: order._id, collectorId: user._id });
      stats.updatedOrders += 1;
    }

    const label = `${user.name} (${user.role})`;
    stats.byCollector.set(label, (stats.byCollector.get(label) || 0) + 1);

    if (order.clientId) {
      const cid = String(order.clientId);
      if (!clientCollectorVotes.has(cid)) clientCollectorVotes.set(cid, new Map());
      const votes = clientCollectorVotes.get(cid);
      votes.set(next, (votes.get(next) || 0) + 1);
    }
  }

  if (!DRY_RUN && orderUpdates.length) {
    const ops = orderUpdates.map(({ orderId, collectorId }) => ({
      updateOne: {
        filter: { _id: orderId },
        update: { $set: { collectorId } },
      },
    }));
    // bulkWrite in chunks
    const CHUNK = 200;
    for (let i = 0; i < ops.length; i += CHUNK) {
      await Order.bulkWrite(ops.slice(i, i + CHUNK), { ordered: false });
    }
  }

  let clientsUpdated = 0;
  let clientsSkippedMixed = 0;
  const clientOps = [];
  for (const [clientId, votes] of clientCollectorVotes) {
    const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1]);
    if (ranked.length !== 1) {
      clientsSkippedMixed += 1;
      continue;
    }
    const [collectorId] = ranked[0];
    clientsUpdated += 1;
    clientOps.push({
      updateOne: {
        filter: { _id: new mongoose.Types.ObjectId(clientId) },
        update: {
          $set: { collectorId: new mongoose.Types.ObjectId(collectorId) },
        },
      },
    });
  }

  if (!DRY_RUN && clientOps.length) {
    const CHUNK = 200;
    for (let i = 0; i < clientOps.length; i += CHUNK) {
      await Client.bulkWrite(clientOps.slice(i, i + CHUNK), { ordered: false });
    }
  }

  console.log("\n—— Summary ——");
  console.log(`Sheet rows:           ${stats.sheetRows}`);
  console.log(`Orders updated:       ${stats.updatedOrders}`);
  console.log(`Already same:         ${stats.unchangedSame}`);
  console.log(`Overwrote previous:   ${stats.alreadySet}`);
  console.log(`Order missing:        ${stats.orderMissing}`);
  console.log(`No label:             ${stats.skippedNoLabel}`);
  console.log(`Unmapped / skipped:   ${stats.skippedUnmapped}`);
  console.log(`Bad role:             ${stats.skippedBadRole}`);
  console.log(`Clients updated:      ${clientsUpdated}`);
  console.log(`Clients mixed (skip): ${clientsSkippedMixed}`);
  console.log("\nBy collector:");
  for (const [name, n] of [...stats.byCollector.entries()].sort(
    (a, b) => b[1] - a[1]
  )) {
    console.log(`  ${n}  ${name}`);
  }
  if (stats.unmappedLabels.size) {
    console.log("\nUnmapped labels (left unassigned):");
    for (const [name, n] of [...stats.unmappedLabels.entries()].sort(
      (a, b) => b[1] - a[1]
    )) {
      console.log(`  ${n}  ${name}`);
    }
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
