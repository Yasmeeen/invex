import Client from "../../DB/models/client.model.js";
import Order from "../../DB/models/order.model.js";
import Branch from "../../DB/models/branch.model.js";
import mongoose from "mongoose";

/** Digits only (for comparing Egyptian mobile formats). */
function digitsOnly(s) {
  return String(s || "").replace(/\D/g, "");
}

/**
 * Build possible DB values for the same logical phone (0XX…, +20…, 20…, 10 digits).
 */
function buildPhoneSearchCandidates(raw) {
  const decoded = decodeURIComponent(String(raw || "").trim());
  const d = digitsOnly(decoded);
  const set = new Set([decoded, d].filter(Boolean));
  if (d.length >= 10) {
    const last10 = d.slice(-10);
    set.add(last10);
    set.add(`0${last10}`);
    set.add(`20${last10}`);
    set.add(`+20${last10}`);
    set.add(`0020${last10}`);
    if (d.startsWith("20") && d.length >= 12) {
      set.add(`0${d.slice(2)}`);
    }
  }
  return [...set].filter(Boolean);
}

/**
 * GET client by phone (cashier / lookup). Must match stored phoneNumber flexibly.
 */
export const getClientByPhone = async (req, res) => {
  try {
    const param = req.params.phone;
    if (!param) {
      return res.status(400).json({ error: "Phone is required" });
    }

    const candidates = buildPhoneSearchCandidates(param);
    const last10 = digitsOnly(param).slice(-10);

    let client = await Client.findOne({
      phoneNumber: { $in: candidates },
    });

    // Fallback: last 10 digits match (handles spacing/format differences)
    if (!client && last10 && last10.length === 10) {
      client = await Client.findOne({
        phoneNumber: { $regex: new RegExp(`${last10}$`) },
      });
    }

    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }

    res.json({
      _id: client._id,
      name: client.name,
      address: client.address,
      phoneNumber: client.phoneNumber,
    });
  } catch (error) {
    console.error("❌ Error fetching client by phone:", error.message);
    res.status(500).json({ error: "Failed to fetch client" });
  }
};

/**
 * GET all clients (pagination + search + order stats)
 */
export const getClients = async (req, res) => {
  try {
    const { page = 1, limit = 10, search = "", branch_id = "" } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const matchStage = {};
    if (search) {
      matchStage.phoneNumber = { $regex: search, $options: "i" };
    }
    if (branch_id && mongoose.Types.ObjectId.isValid(String(branch_id))) {
      const branchOid = new mongoose.Types.ObjectId(String(branch_id));
      const clientIdsFromOrders = await Order.distinct("clientId", {
        branch: branchOid,
        clientId: { $exists: true, $ne: null },
      });
      matchStage.$or = [
        { branches: branchOid },
        { _id: { $in: clientIdsFromOrders } },
      ];
    }

    const pipeline = [
      { $match: matchStage },

      // Join orders
      {
        $lookup: {
          from: "orders",
          localField: "_id",
          foreignField: "clientId",
          as: "orders",
        },
      },

      // Calculate stats + last order date
      {
        $addFields: {
          numberOfOrders: { $size: "$orders" },
          totalOrdersPrice: { $sum: "$orders.totalPrice" },
          lastOrderDate: { $max: "$orders.createdAt" },
        },
      },

      // Join branches to get branch name
      {
        $lookup: {
          from: "branches",          // collection name in DB
          localField: "branches",    // array of ObjectId in Client
          foreignField: "_id",
          as: "branchDetails",       // new field with branch info
        },
      },

      // Pagination
      { $skip: skip },
      { $limit: Number(limit) },

      // Clean response
      {
        $project: {
          name: 1,
          phoneNumber: 1,
          address: 1,
          createdAt: 1,
          numberOfOrders: 1,
          totalOrdersPrice: 1,
          lastOrderDate: 1,
          branches: "$branchDetails.name", // return only branch names
        },
      },
    ];

    const [clients, total] = await Promise.all([
      Client.aggregate(pipeline),
      Client.countDocuments(matchStage),
    ]);

    const totalPages = Math.ceil(total / limit);

    res.json({
      clients,
      meta: {
        currentPage: Number(page),
        nextPage: page < totalPages ? Number(page) + 1 : null,
        prevPage: page > 1 ? Number(page) - 1 : null,
        totalCount: total,
        totalPages,
      },
    });
  } catch (error) {
    console.error("❌ Error fetching clients:", error.message);
    res.status(500).json({ error: "Failed to fetch clients" });
  }
};


/**
 * GET client by ID (with stats)
 */
export const getClientById = async (req, res) => {
  try {
    const clientId = new mongoose.Types.ObjectId(req.params.id);

    const client = await Client.aggregate([
      { $match: { _id: clientId } },
      {
        $lookup: {
          from: "orders",
          localField: "_id",
          foreignField: "clientId",
          as: "orders",
        },
      },
      {
        $addFields: {
          numberOfOrders: { $size: "$orders" },
          totalOrdersPrice: { $sum: "$orders.totalPrice" },
        },
      },
      {
        $project: {
          name: 1,
          address: 1,
          branchs: 1,
          createdAt: 1,
          numberOfOrders: 1,
          totalOrdersPrice: 1,
        },
      },
    ]);

    if (!client.length) {
      return res.status(404).json({ error: "Client not found" });
    }

    res.json(client[0]);
  } catch (error) {
    console.error("❌ Error fetching client:", error.message);
    res.status(500).json({ error: "Failed to fetch client" });
  }
};

/**
 * CREATE client
 */
export const createClient = async (req, res) => {
  try {
    const { name, address, branchs } = req.body;

    if (!name) {
      return res.status(400).json({ error: "Client name is required" });
    }

    // Validate branches if provided
    if (branchs?.length) {
      const count = await Branch.countDocuments({ _id: { $in: branchs } });
      if (count !== branchs.length) {
        return res.status(404).json({ error: "One or more branches not found" });
      }
    }

    const client = await Client.create({
      name,
      address,
      branchs,
    });

    res.status(201).json({
      message: "✅ Client created",
      client,
    });
  } catch (error) {
    console.error("❌ Error creating client:", error.message);
    res.status(500).json({ error: "Failed to create client" });
  }
};

/**
 * UPDATE client
 */
export const updateClient = async (req, res) => {
  try {
    const { name, address, branchs } = req.body;

    const updatedClient = await Client.findByIdAndUpdate(
      req.params.id,
      { name, address, branchs },
      { new: true }
    );

    if (!updatedClient) {
      return res.status(404).json({ error: "Client not found" });
    }

    res.json({
      message: "✅ Client updated",
      client: updatedClient,
    });
  } catch (error) {
    console.error("❌ Error updating client:", error.message);
    res.status(500).json({ error: "Failed to update client" });
  }
};

/**
 * DELETE client
 */
export const deleteClient = async (req, res) => {
  try {
    const client = await Client.findByIdAndDelete(req.params.id);

    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }

    res.json({ message: "✅ Client deleted" });
  } catch (error) {
    console.error("❌ Error deleting client:", error.message);
    res.status(500).json({ error: "Failed to delete client" });
  }
};
