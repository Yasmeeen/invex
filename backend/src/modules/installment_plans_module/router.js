import express from "express";
import {
  listInstallmentPlans,
  getInstallmentPlan,
  createInstallmentPlan,
  updateInstallmentPlan,
  deleteInstallmentPlan,
} from "./service.js";

const router = express.Router();

router.get("/", listInstallmentPlans);
router.get("/:id", getInstallmentPlan);
router.post("/", createInstallmentPlan);
router.put("/:id", updateInstallmentPlan);
router.delete("/:id", deleteInstallmentPlan);

export default router;
