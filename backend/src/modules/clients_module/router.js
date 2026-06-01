import express from "express";
const router = express.Router();

import {
  getClients,
  getClientById,
  getClientByPhone,
  getClientHistory,
  addClientDeposit,
  payClient,
  setClientOpeningDebitBalance,
  settleClientBalances,
  createClient,
  updateClient,
  deleteClient,
} from "./service.js";

// GET all clients (pagination + search)
router.get("/", getClients);

// GET client by phone — must be before "/:id"
router.get("/by-phone/:phone", getClientByPhone);

// GET client history (orders, points, pay-later)
router.get("/:id/history", getClientHistory);

// POST prepaid deposit
router.post("/:id/deposit", addClientDeposit);
router.post("/:id/pay-client", payClient);
router.post("/:id/opening-debit-balance", setClientOpeningDebitBalance);
router.post("/:id/settle", settleClientBalances);

// GET client by ID
router.get("/:id", getClientById);

// CREATE client
router.post("/create", createClient);

// UPDATE client
router.put("/update/:id", updateClient);

// DELETE client
router.delete("/delete/:id", deleteClient);

export default router;
