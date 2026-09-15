/**
 * Merge Book1 clients that share the same name into one client.
 *
 * Import keyed clients by phone, so missing phones created one client per sale
 * (placeholder 0199…). Same name with/without phone should be one person.
 *
 * Also reassigns Book1 orders to the client matching the sheet name (fixes
 * phone-collision across different names, e.g. sale 961).
 *
 * Usage:
 *   node scripts/mergeBook1ClientsByName.js --dry-run
 *   node scripts/mergeBook1ClientsByName.js
 */
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import XLSX from "xlsx";

import Client from "../src/DB/models/client.model.js";
import Order from "../src/DB/models/order.model.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const DRY_RUN = process.argv.includes("--dry-run");
const SALE_MIN = 753;
const SALE_MAX = 1727;

function normName(s) {
  return String(s ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .toLowerCase();
}

function isPlaceholderPhone(phone) {
  const p = String(phone || "").trim();
  return !p || p === "0" || p.startsWith("0199");
}

function cleanPhone(raw) {
  if (raw == null || raw === 0 || raw === "0" || String(raw).trim() === "") {
    return null;
  }
  let s = String(raw).replace(/#/g, "").replace(/\s+/g, "").trim();
  s = s.replace(/[^\d+]/g, "");
  if (!s || s === "0") return null;
  return s;
}

function readSheet(xlsxPath) {
  const wb = XLSX.readFile(xlsxPath, { cellDates: false });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {
    defval: null,
    raw: true,
  });
  const bySale = new Map();
  for (const row of rows) {
    const saleNumber = Number(row["رقم العميل"] ?? row["رقم العميل "]);
    if (!Number.isFinite(saleNumber) || saleNumber <= 0) continue;
    const name = String(row["اسم العميل"] ?? row["اسم العميل  "] ?? "")
      .replace(/\s+/g, " ")
      .trim();
    const phone = cleanPhone(row["رقم التلفون 1"] ?? row["رقم التلفون"]);
    bySale.set(saleNumber, { name, phone, key: normName(name) });
  }
  return bySale;
}

async function main() {
  const xlsxPath =
    process.env.BOOK1_XLSX_PATH ||
    path.join(__dirname, "..", "..", "docs", "Book1.xlsx");
  if (!fs.existsSync(xlsxPath)) throw new Error(`Excel not found: ${xlsxPath}`);

  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGO_URI missing");

  await mongoose.connect(uri);
  console.log(DRY_RUN ? "🔎 DRY RUN" : "✍️  LIVE merge");

  const sheet = readSheet(xlsxPath);
  const orders = await Order.find({
    paymentMethod: "installment",
    installmentSaleNumber: { $gte: SALE_MIN, $lte: SALE_MAX },
  }).select(
    "_id installmentSaleNumber clientId clientName clientPhoneNumber"
  );

  /** key → { displayName, phones:Set, saleNumbers:[], orderIds:[], clientIds:Set } */
  const groups = new Map();

  for (const order of orders) {
    const sn = Number(order.installmentSaleNumber);
    const sheetRow = sheet.get(sn);
    const name = sheetRow?.name || order.clientName || "";
    const key = sheetRow?.key || normName(name);
    if (!key) continue;

    if (!groups.has(key)) {
      groups.set(key, {
        displayName: name,
        phones: new Set(),
        saleNumbers: [],
        orderIds: [],
        clientIds: new Set(),
      });
    }
    const g = groups.get(key);
    if (name && name.length >= g.displayName.length) g.displayName = name;
    if (sheetRow?.phone) g.phones.add(sheetRow.phone);
    g.saleNumbers.push(sn);
    g.orderIds.push(order._id);
    if (order.clientId) g.clientIds.add(String(order.clientId));
  }

  // Also pull any DB clients whose name matches a group (even if no order left odd)
  const allClients = await Client.find({}).select(
    "name phoneNumber additionalPhoneNumbers branches collectorId"
  );
  const clientsById = new Map(allClients.map((c) => [String(c._id), c]));
  const phoneOwner = new Map();
  for (const c of allClients) {
    phoneOwner.set(String(c.phoneNumber || "").trim(), String(c._id));
  }

  for (const c of allClients) {
    const key = normName(c.name);
    if (!groups.has(key)) continue;
    groups.get(key).clientIds.add(String(c._id));
  }

  const mergeGroups = [...groups.entries()].filter(
    ([, g]) => g.clientIds.size > 1 || g.saleNumbers.length > 1
  );

  let groupsMerged = 0;
  let ordersMoved = 0;
  let clientsDeleted = 0;
  const samples = [];

  for (const [, g] of mergeGroups) {
    const memberIds = [...g.clientIds];
    const members = memberIds
      .map((id) => clientsById.get(id))
      .filter(Boolean);

    // Skip if already a single client owning all these sales
    const orderClientIds = new Set();
    for (const oid of g.orderIds) {
      const o = orders.find((x) => String(x._id) === String(oid));
      if (o?.clientId) orderClientIds.add(String(o.clientId));
    }
    const needsMerge =
      orderClientIds.size > 1 ||
      members.length > 1 ||
      [...orderClientIds].some((id) => {
        const c = clientsById.get(id);
        return c && normName(c.name) !== normName(g.displayName);
      });

    if (!needsMerge && members.length <= 1) continue;

    // Score keeper: real phone matching sheet > any real phone > most book1 sales > oldest id
    const salesByClient = new Map();
    for (const o of orders) {
      if (!g.saleNumbers.includes(Number(o.installmentSaleNumber))) continue;
      const cid = String(o.clientId || "");
      salesByClient.set(cid, (salesByClient.get(cid) || 0) + 1);
    }

    const sheetPhones = [...g.phones];
    function score(c) {
      if (!c) return -1e9;
      const phone = String(c.phoneNumber || "").trim();
      let s = 0;
      if (!isPlaceholderPhone(phone)) s += 1000;
      if (sheetPhones.includes(phone)) s += 500;
      if (normName(c.name) === normName(g.displayName)) s += 200;
      s += (salesByClient.get(String(c._id)) || 0) * 10;
      return s;
    }

    // Candidates: members + any client owning a sheet phone for this name
    // (but only if that client's name matches OR we're taking phone-only match carefully)
    let candidates = [...members];
    for (const ph of sheetPhones) {
      const ownerId = phoneOwner.get(ph);
      const owner = ownerId ? clientsById.get(ownerId) : null;
      if (owner && !candidates.find((c) => String(c._id) === String(owner._id))) {
        // Only pull phone-owner into this group if name matches this group
        // OR they currently hold orders that sheet says belong here
        const holdsOurSale = orders.some(
          (o) =>
            String(o.clientId) === String(owner._id) &&
            g.saleNumbers.includes(Number(o.installmentSaleNumber))
        );
        if (normName(owner.name) === normName(g.displayName) || holdsOurSale) {
          candidates.push(owner);
        }
      }
    }

    if (!candidates.length) continue;

    candidates.sort((a, b) => score(b) - score(a));
    let keeper = candidates[0];

    // Prefer creating/keeping name match: if top candidate has wrong name but a
    // same-name member exists, use same-name member as keeper.
    const sameName = candidates.filter(
      (c) => normName(c.name) === normName(g.displayName)
    );
    if (sameName.length) {
      sameName.sort((a, b) => score(b) - score(a));
      keeper = sameName[0];
    }

    // Choose primary phone for keeper
    let primaryPhone = String(keeper.phoneNumber || "").trim();
    const extraPhones = new Set(
      (keeper.additionalPhoneNumbers || []).map((p) => String(p).trim()).filter(Boolean)
    );

    for (const ph of sheetPhones) {
      const ownerId = phoneOwner.get(ph);
      if (!ownerId || ownerId === String(keeper._id)) {
        if (isPlaceholderPhone(primaryPhone)) {
          primaryPhone = ph;
        } else if (ph !== primaryPhone) {
          extraPhones.add(ph);
        }
      } else {
        // Phone owned by someone else (different person sharing number in sheet)
        extraPhones.add(ph);
      }
    }

    // Gather loser clients (same name or only hold our sales that will move)
    const losers = [];
    for (const c of candidates) {
      if (String(c._id) === String(keeper._id)) continue;
      if (normName(c.name) === normName(g.displayName)) {
        losers.push(c);
        continue;
      }
      // Wrong-name client that currently holds some of our sheet sales only —
      // don't delete them, just move our sales away (e.g. محمد حسن holding 961)
    }

    const ordersToMove = orders.filter((o) =>
      g.saleNumbers.includes(Number(o.installmentSaleNumber))
    );

    const beforeClients = [...new Set(ordersToMove.map((o) => String(o.clientId)))];

    if (
      beforeClients.length === 1 &&
      beforeClients[0] === String(keeper._id) &&
      losers.length === 0 &&
      primaryPhone === String(keeper.phoneNumber || "").trim()
    ) {
      continue;
    }

    groupsMerged += 1;
    if (samples.length < 15 || normName(g.displayName).includes("هشام")) {
      samples.push({
        name: g.displayName,
        sales: g.saleNumbers.sort((a, b) => a - b),
        fromClients: beforeClients.length,
        keeperPhone: primaryPhone,
        losers: losers.length,
      });
    }

    if (DRY_RUN) {
      ordersMoved += ordersToMove.filter(
        (o) => String(o.clientId) !== String(keeper._id)
      ).length;
      clientsDeleted += losers.length;
      continue;
    }

    // Update keeper phone / name / extras
    const phoneClash =
      primaryPhone !== String(keeper.phoneNumber || "").trim() &&
      phoneOwner.has(primaryPhone) &&
      phoneOwner.get(primaryPhone) !== String(keeper._id);

    if (!phoneClash && primaryPhone) {
      keeper.phoneNumber = primaryPhone;
    }
    keeper.name = g.displayName;
    const extras = [...extraPhones].filter(
      (p) => p && p !== String(keeper.phoneNumber || "").trim()
    );
    keeper.additionalPhoneNumbers = [
      ...new Set([...(keeper.additionalPhoneNumbers || []), ...extras]),
    ];

    // Merge branches & collector from losers
    for (const loser of losers) {
      for (const b of loser.branches || []) {
        if (!keeper.branches) keeper.branches = [];
        if (![...keeper.branches].some((x) => String(x) === String(b))) {
          keeper.branches.push(b);
        }
      }
      if (!keeper.collectorId && loser.collectorId) {
        keeper.collectorId = loser.collectorId;
      }
      for (const p of loser.additionalPhoneNumbers || []) {
        if (p && p !== keeper.phoneNumber) {
          keeper.additionalPhoneNumbers.push(p);
        }
      }
      if (
        loser.phoneNumber &&
        !isPlaceholderPhone(loser.phoneNumber) &&
        loser.phoneNumber !== keeper.phoneNumber
      ) {
        keeper.additionalPhoneNumbers.push(loser.phoneNumber);
      }
    }
    keeper.additionalPhoneNumbers = [
      ...new Set(
        (keeper.additionalPhoneNumbers || []).map((p) => String(p).trim()).filter(Boolean)
      ),
    ];

    await keeper.save();
    phoneOwner.set(String(keeper.phoneNumber).trim(), String(keeper._id));
    clientsById.set(String(keeper._id), keeper);

    for (const o of ordersToMove) {
      if (String(o.clientId) !== String(keeper._id)) ordersMoved += 1;
      await Order.updateOne(
        { _id: o._id },
        {
          $set: {
            clientId: keeper._id,
            clientName: g.displayName,
            clientPhoneNumber: keeper.phoneNumber,
          },
        }
      );
      o.clientId = keeper._id;
    }

    for (const loser of losers) {
      const stillHas = await Order.countDocuments({ clientId: loser._id });
      if (stillHas === 0) {
        await Client.deleteOne({ _id: loser._id });
        clientsDeleted += 1;
        clientsById.delete(String(loser._id));
        if (phoneOwner.get(String(loser.phoneNumber || "").trim()) === String(loser._id)) {
          phoneOwner.delete(String(loser.phoneNumber || "").trim());
        }
      }
    }
  }

  console.log("\n—— Summary ——");
  console.log(`Name groups touched: ${groupsMerged}`);
  console.log(`Orders reassigned:   ${ordersMoved}`);
  console.log(`Clients deleted:     ${clientsDeleted}`);
  console.log("\nSamples:");
  for (const s of samples) {
    console.log(
      `  ${s.name} · sales [${s.sales.join(",")}] · from ${s.fromClients} clients → phone ${s.keeperPhone} · delete ${s.losers}`
    );
  }

  // Verify هشام
  const hesham = await Client.find({ name: /هشام.*جوي/ }).lean();
  console.log("\n=== مستر هشام جويكس after ===");
  for (const c of hesham) {
    const sales = await Order.find({ clientId: c._id })
      .select("installmentSaleNumber")
      .lean();
    console.log({
      id: String(c._id),
      name: c.name,
      phone: c.phoneNumber,
      extra: c.additionalPhoneNumbers,
      sales: sales.map((o) => o.installmentSaleNumber).sort((a, b) => a - b),
    });
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
