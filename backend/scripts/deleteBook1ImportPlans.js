/**
 * Delete installment plans created by Book1 import (name contains "استيراد").
 * Does not delete other plans. Existing sales keep installmentPlanSnapshot.
 *
 * Usage:
 *   node scripts/deleteBook1ImportPlans.js --dry-run
 *   node scripts/deleteBook1ImportPlans.js
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import InstallmentPlan from "../src/DB/models/installmentPlan.model.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  if (!process.env.MONGO_URI) {
    console.error("Missing MONGO_URI");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  const filter = { name: { $regex: "استيراد" } };
  const before = await InstallmentPlan.find(filter)
    .select("name months interestPercent enabled")
    .lean();

  console.log(`Found ${before.length} import plan(s):`);
  for (const p of before) {
    console.log(
      `  - ${p._id} | ${p.name} | ${p.months}m | interest=${p.interestPercent}% | enabled=${p.enabled}`
    );
  }

  if (!before.length) {
    console.log("Nothing to delete.");
    await mongoose.disconnect();
    return;
  }

  if (DRY_RUN) {
    console.log("Dry run — no deletes.");
    await mongoose.disconnect();
    return;
  }

  const result = await InstallmentPlan.deleteMany(filter);
  console.log(`Deleted: ${result.deletedCount}`);

  const remainingImport = await InstallmentPlan.countDocuments(filter);
  const remainingAll = await InstallmentPlan.find()
    .select("name months")
    .sort({ months: 1 })
    .lean();
  console.log(`Remaining with استيراد: ${remainingImport}`);
  console.log(`All remaining plans (${remainingAll.length}):`);
  for (const p of remainingAll) {
    console.log(`  - ${p.name} (${p.months}m)`);
  }

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch (_) {}
  process.exit(1);
});
