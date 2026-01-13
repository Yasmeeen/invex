import express from "express";
const router = express.Router();

import {
  getClients,
  getClientById,
  createClient,
  updateClient,
  deleteClient,
} from "./service.js";

// GET all clients (pagination + search)
router.get("/", getClients);

// GET client by ID
router.get("/:id", getClientById);

// CREATE client
router.post("/create", createClient);

// UPDATE client
router.put("/update/:id", updateClient);

// DELETE client
router.delete("/delete/:id", deleteClient);

export default router;
