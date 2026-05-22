import Client from "../../DB/models/client.model.js";
import Order from "../../DB/models/order.model.js";
import ProductPurchaseRequest from "../../DB/models/productPurchaseRequest.model.js";
import {
  deferredDeskPurchaseRemaining,
  deskPurchaseLineTotal,
} from "../../utils/desk-purchase-deferred.js";
import { purchaseHasDeferredTreasury } from "../../utils/purchase-treasury-splits.js";
import Branch from "../../DB/models/branch.model.js";
import mongoose from "mongoose";
import { buildPhoneSearchCandidates, digitsOnly } from "../../utils/phone-utils.js";
import { orderAmountRemaining } from "../../utils/vendor-balance-utils.js";
import {
  computeClientCreditDue,
  isClientCreditOrder,
  pointsEarnedForOrder,
} from "../../utils/client-order-utils.js";

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
 * GET client account history: sales orders, purchases from client, loyalty points, pay-later balance.
 */
export const getClientHistory = async (req, res) => {
  try {
    const clientId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(String(clientId))) {
      return res.status(400).json({ error: "Invalid client id" });
    }

    const client = await Client.findById(clientId).lean();
    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }

    const orders = await Order.find({
      clientId: client._id,
      partyType: { $ne: "supplier" },
    })
      .select(
        "orderNumber totalPrice amountPaid paymentMethod paymentStatus status createdAt branch sellerName"
      )
      .populate("branch", "name")
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    let totalPointsEarned = 0;
    const ordersWithMeta = orders.map((o) => {
      const remaining = isClientCreditOrder(o) ? orderAmountRemaining(o) : 0;
      const pointsEarned = pointsEarnedForOrder(o);
      totalPointsEarned += pointsEarned;
      return {
        ...o,
        remaining,
        pointsEarned,
        isPayLater: isClientCreditOrder(o),
      };
    });

    const creditBalanceDue = await computeClientCreditDue(client._id);
    const creditOrders = ordersWithMeta.filter(
      (o) => o.isPayLater && o.remaining > 0 && o.status !== "restored"
    );

    const phoneCandidates = buildPhoneSearchCandidates(client.phoneNumber);
    const purchaseMatchOr = [
      { "productPayload.acquiredFrom.clientId": client._id },
    ];
    if (phoneCandidates.length) {
      purchaseMatchOr.push({
        "productPayload.acquiredFrom.phone": { $in: phoneCandidates },
        $or: [
          { "productPayload.acquiredFrom.partyType": "client" },
          { "productPayload.acquiredFrom.partyType": { $exists: false } },
          { "productPayload.acquiredFrom.partyType": null },
        ],
      });
    }

    const purchaseRows = await ProductPurchaseRequest.find({ $or: purchaseMatchOr })
      .select(
        "status quantity purchaseTreasuryKey purchaseTreasuryLabel productPayload createdAt branch createdBy"
      )
      .populate("branch", "name")
      .populate("createdBy", "name")
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    const purchases = purchaseRows.map((p) => {
      const pp = p.productPayload || {};
      const qty = Math.max(1, Math.floor(Number(p.quantity) || 1));
      const unitNet = Math.round((Number(pp.netPrice) || 0) * 100) / 100;
      const lineTotal = deskPurchaseLineTotal(p);
      const isDeferred = purchaseHasDeferredTreasury(p);
      const remaining = isDeferred ? deferredDeskPurchaseRemaining(p) : 0;
      const paid =
        isDeferred && p.status === "approved"
          ? Math.round((lineTotal - remaining) * 100) / 100
          : isDeferred
            ? 0
            : lineTotal;
      return {
        _id: p._id,
        status: p.status,
        createdAt: p.createdAt,
        branch: p.branch,
        productName: pp.name || "",
        productCode: pp.code || "",
        quantity: qty,
        unitNetPrice: unitNet,
        lineTotal,
        totalPaid: paid,
        remaining,
        isDeferredPurchase: isDeferred,
        purchaseTreasuryKey: p.purchaseTreasuryKey,
        purchaseTreasuryLabel: p.purchaseTreasuryLabel || "",
        purchaseTreasurySplits: p.purchaseTreasurySplits || [],
        createdByName: p.createdBy?.name || "",
      };
    });

    res.json({
      client: {
        _id: client._id,
        name: client.name,
        phoneNumber: client.phoneNumber,
        address: client.address,
      },
      totalPointsEarned,
      creditBalanceDue,
      creditOrdersCount: creditOrders.length,
      orders: ordersWithMeta,
      creditOrders,
      purchases,
      purchasesCount: purchases.length,
    });
  } catch (error) {
    console.error("❌ Error fetching client history:", error.message);
    res.status(500).json({ error: "Failed to fetch client history" });
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
