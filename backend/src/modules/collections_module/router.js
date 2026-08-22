import express from "express";
import {
  listCollectionsDue,
  listCollectors,
  getCollectionsDashboard,
  hasInstallmentOrders,
  assignOrderCollector,
} from "./service.js";

const router = express.Router();

router.get("/dashboard", getCollectionsDashboard);
router.get("/due", listCollectionsDue);
router.get("/collectors", listCollectors);
router.get("/has-installments", hasInstallmentOrders);
router.patch("/orders/:orderId/collector", assignOrderCollector);

export default router;
