import InstallmentPlan from "../../DB/models/installmentPlan.model.js";
import mongoose from "mongoose";

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function serialize(doc) {
  if (!doc) return null;
  const o = doc.toObject ? doc.toObject() : doc;
  return {
    _id: o._id,
    name: o.name,
    months: o.months,
    interestPercent: o.interestPercent,
    enabled: o.enabled !== false,
    sortOrder: o.sortOrder || 0,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  };
}

function parseBody(body = {}) {
  const name = String(body.name || "").trim();
  const months = Math.floor(Number(body.months));
  const interestPercent = round2(body.interestPercent);
  const enabled = body.enabled === undefined ? true : Boolean(body.enabled);
  const sortOrder = Number.isFinite(Number(body.sortOrder))
    ? Math.floor(Number(body.sortOrder))
    : 0;

  if (!name) {
    const err = new Error("Plan name is required");
    err.status = 400;
    throw err;
  }
  if (!Number.isFinite(months) || months < 1 || months > 120) {
    const err = new Error("Months must be between 1 and 120");
    err.status = 400;
    throw err;
  }
  if (!Number.isFinite(interestPercent) || interestPercent < 0 || interestPercent > 500) {
    const err = new Error("Interest percent must be between 0 and 500");
    err.status = 400;
    throw err;
  }

  return { name, months, interestPercent, enabled, sortOrder };
}

/** GET / — list plans (query: enabledOnly=true) */
export const listInstallmentPlans = async (req, res) => {
  try {
    const enabledOnly =
      String(req.query.enabledOnly || "").toLowerCase() === "true" ||
      String(req.query.enabledOnly || "") === "1";
    const filter = enabledOnly ? { enabled: true } : {};
    const rows = await InstallmentPlan.find(filter)
      .sort({ sortOrder: 1, months: 1, name: 1 })
      .lean();
    res.json({ plans: rows.map(serialize) });
  } catch (error) {
    console.error("❌ listInstallmentPlans:", error.message);
    res.status(500).json({ error: "Failed to list installment plans" });
  }
};

/** GET /:id */
export const getInstallmentPlan = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(String(req.params.id))) {
      return res.status(400).json({ error: "Invalid plan id" });
    }
    const plan = await InstallmentPlan.findById(req.params.id).lean();
    if (!plan) {
      return res.status(404).json({ error: "Installment plan not found" });
    }
    res.json({ plan: serialize(plan) });
  } catch (error) {
    console.error("❌ getInstallmentPlan:", error.message);
    res.status(500).json({ error: "Failed to fetch installment plan" });
  }
};

/** POST / */
export const createInstallmentPlan = async (req, res) => {
  try {
    const data = parseBody(req.body);
    const plan = await InstallmentPlan.create(data);
    res.status(201).json({ message: "Installment plan created", plan: serialize(plan) });
  } catch (error) {
    const status = error.status || 500;
    if (status !== 500) {
      return res.status(status).json({ error: error.message });
    }
    console.error("❌ createInstallmentPlan:", error.message);
    res.status(500).json({ error: "Failed to create installment plan" });
  }
};

/** PUT /:id */
export const updateInstallmentPlan = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(String(req.params.id))) {
      return res.status(400).json({ error: "Invalid plan id" });
    }
    const data = parseBody(req.body);
    const plan = await InstallmentPlan.findByIdAndUpdate(req.params.id, data, {
      new: true,
      runValidators: true,
    });
    if (!plan) {
      return res.status(404).json({ error: "Installment plan not found" });
    }
    res.json({ message: "Installment plan updated", plan: serialize(plan) });
  } catch (error) {
    const status = error.status || 500;
    if (status !== 500) {
      return res.status(status).json({ error: error.message });
    }
    console.error("❌ updateInstallmentPlan:", error.message);
    res.status(500).json({ error: "Failed to update installment plan" });
  }
};

/** DELETE /:id — soft-disable if used later; for now hard delete when unused */
export const deleteInstallmentPlan = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(String(req.params.id))) {
      return res.status(400).json({ error: "Invalid plan id" });
    }
    const plan = await InstallmentPlan.findByIdAndDelete(req.params.id);
    if (!plan) {
      return res.status(404).json({ error: "Installment plan not found" });
    }
    res.json({ message: "Installment plan deleted" });
  } catch (error) {
    console.error("❌ deleteInstallmentPlan:", error.message);
    res.status(500).json({ error: "Failed to delete installment plan" });
  }
};
