import express from "express";
import {
  listCollectionsDue,
  listCollectors,
  getCollectionsDashboard,
} from "./service.js";

const router = express.Router();

router.get("/dashboard", getCollectionsDashboard);
router.get("/due", listCollectionsDue);
router.get("/collectors", listCollectors);

export default router;
