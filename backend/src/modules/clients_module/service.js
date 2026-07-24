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
  computeClientCreditDueFromOrders,
  computeClientOwesUs,
  isClientCreditOrder,
  pointsEarnedForOrder,
} from "../../utils/client-order-utils.js";
import {
  buildClientNetBalanceMessage,
  buildClientSettlementPreview,
  computeTotalClientCreditOwed,
} from "../../utils/client-balance-summary.js";
import {
  buildTreasurySplitsFromPayment,
  cashAmountFromPaymentSplits,
  isPhysicalCashMethod,
  normalizePaymentFeeAllocations,
  normalizePaymentSplitsRaw,
  totalNetFromPaymentSplits,
} from "../../utils/deposit-payment-splits.js";
import {
  buildCashDrawerLedgerFields,
  recordClientCashDrawerReceipt,
} from "../../utils/client-cash-drawer.js";
import { resolveBranchForCashDrawer } from "../../utils/vendor-cash-drawer.js";
import {
  applyClientDeferredPayableSettlement,
  computeClientDeferredPayablesByClients,
  computeClientPayableBreakdown,
  payClientWithTreasury,
} from "../../utils/client-pay-treasury.js";

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
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
 * GET all clients (pagination + search + order stats + balances)
 * Query: balanceSide=debit|credit — net مدين (client) or دائن (store owes client)
 */
export const getClients = async (req, res) => {
  try {
    const {
      page = 1,
      limit: limitQ,
      perPage,
      search = "",
      branch_id = "",
      balanceSide = "",
    } = req.query;
    const limit = Number(limitQ || perPage || 10) || 10;
    const skip = (Number(page) - 1) * limit;
    const sideFilter = String(balanceSide || "")
      .trim()
      .toLowerCase();

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
          lastOrderDate: { $max: "$orders.createdAt" },
          owesFromSales: {
            $reduce: {
              input: {
                $filter: {
                  input: "$orders",
                  as: "o",
                  cond: {
                    $and: [
                      {
                        $eq: [
                          { $toLower: { $ifNull: ["$$o.paymentMethod", ""] } },
                          "credit",
                        ],
                      },
                      { $in: ["$$o.paymentStatus", ["unpaid", "partial"]] },
                      { $ne: ["$$o.status", "restored"] },
                      {
                        $in: [
                          { $ifNull: ["$$o.partyType", null] },
                          [null, "client"],
                        ],
                      },
                    ],
                  },
                },
              },
              initialValue: 0,
              in: {
                $add: [
                  "$$value",
                  {
                    $max: [
                      0,
                      {
                        $subtract: [
                          { $ifNull: ["$$this.totalPrice", 0] },
                          { $ifNull: ["$$this.amountPaid", 0] },
                        ],
                      },
                    ],
                  },
                ],
              },
            },
          },
          prepaidBalance: { $ifNull: ["$creditBalance", 0] },
          openingDebit: { $ifNull: ["$openingDebitBalance", 0] },
        },
      },

      {
        $addFields: {
          clientOwesUs: {
            $round: [{ $add: ["$owesFromSales", "$openingDebit"] }, 2],
          },
        },
      },

      {
        $project: {
          name: 1,
          phoneNumber: 1,
          address: 1,
          createdAt: 1,
          branches: 1,
          numberOfOrders: 1,
          totalOrdersPrice: 1,
          lastOrderDate: 1,
          clientOwesUs: 1,
          prepaidBalance: 1,
        },
      },
    ];

    const matched = await Client.aggregate(pipeline);
    const deferredMap = await computeClientDeferredPayablesByClients(matched);

    let withBalances = matched.map((c) => {
      const prepaid = Math.round((Number(c.prepaidBalance) || 0) * 100) / 100;
      const deferred = deferredMap.get(String(c._id)) || 0;
      const weOweClient = computeTotalClientCreditOwed(prepaid, deferred);
      const clientOwesUs = Math.round((Number(c.clientOwesUs) || 0) * 100) / 100;
      const netAmount = Math.round((clientOwesUs - weOweClient) * 100) / 100;
      let balanceSide = "credit";
      if (clientOwesUs <= 0 && weOweClient <= 0) balanceSide = "none";
      else if (Math.abs(netAmount) < 0.001) balanceSide = "even";
      else if (netAmount > 0) balanceSide = "debit";
      return {
        ...c,
        prepaidBalance: prepaid,
        clientPayableDeferred: deferred,
        weOweClient,
        clientOwesUs,
        balanceSide,
        netAmount,
      };
    });

    if (sideFilter === "debit" || sideFilter === "credit") {
      withBalances = withBalances.filter((c) => c.balanceSide === sideFilter);
    }

    const total = withBalances.length;
    const pageRows = withBalances.slice(skip, skip + limit);

    const branchIds = [
      ...new Set(
        pageRows.flatMap((c) => (c.branches || []).map((b) => String(b)))
      ),
    ].filter((id) => mongoose.Types.ObjectId.isValid(id));
    const branchDocs = branchIds.length
      ? await Branch.find({ _id: { $in: branchIds } }).select("name").lean()
      : [];
    const branchNameById = new Map(
      branchDocs.map((b) => [String(b._id), b.name])
    );

    const clients = pageRows.map((c) => {
      const net = buildClientNetBalanceMessage(c.clientOwesUs, c.weOweClient);
      const { netAmount, prepaidBalance, clientPayableDeferred, branches, ...rest } =
        c;
      return {
        ...rest,
        branches: (branches || [])
          .map((b) => branchNameById.get(String(b)))
          .filter(Boolean),
        netBalanceMessage: net,
      };
    });
    const totalPages = Math.ceil(total / limit) || 0;
    const currentPage = Number(page);

    res.json({
      clients,
      meta: {
        currentPage,
        nextPage: currentPage < totalPages ? currentPage + 1 : null,
        prevPage: currentPage > 1 ? currentPage - 1 : null,
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
          phoneNumber: 1,
          address: 1,
          branches: 1,
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
    const { name, address, phoneNumber, phone, branches, branchs } = req.body;
    const phoneRaw = String(phoneNumber || phone || "").trim();

    if (!name) {
      return res.status(400).json({ error: "Client name is required" });
    }
    if (!phoneRaw) {
      return res.status(400).json({ error: "Client phone number is required" });
    }

    const branchIds = Array.isArray(branches)
      ? branches
      : Array.isArray(branchs)
        ? branchs
        : branchs
          ? [branchs]
          : [];

    if (branchIds.length) {
      const count = await Branch.countDocuments({ _id: { $in: branchIds } });
      if (count !== branchIds.length) {
        return res.status(404).json({ error: "One or more branches not found" });
      }
    }

    const client = await Client.create({
      name: String(name).trim(),
      phoneNumber: phoneRaw,
      address: String(address || "").trim(),
      branches: branchIds,
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
    const { name, address, phoneNumber, phone, branches, branchs } = req.body;

    const branchIds = Array.isArray(branches)
      ? branches
      : Array.isArray(branchs)
        ? branchs
        : branchs !== undefined
          ? branchs
            ? [branchs]
            : []
          : undefined;

    const update = {};
    if (name !== undefined) update.name = String(name).trim();
    if (address !== undefined) update.address = String(address || "").trim();
    if (phoneNumber !== undefined || phone !== undefined) {
      const phoneRaw = String(phoneNumber || phone || "").trim();
      if (!phoneRaw) {
        return res.status(400).json({ error: "Client phone number is required" });
      }
      const duplicate = await Client.findOne({
        phoneNumber: phoneRaw,
        _id: { $ne: req.params.id },
      });
      if (duplicate) {
        return res.status(409).json({ error: "Phone number already in use" });
      }
      update.phoneNumber = phoneRaw;
    }
    if (branchIds !== undefined) {
      if (branchIds.length) {
        const count = await Branch.countDocuments({ _id: { $in: branchIds } });
        if (count !== branchIds.length) {
          return res.status(404).json({ error: "One or more branches not found" });
        }
      }
      update.branches = branchIds;
    }

    const updatedClient = await Client.findByIdAndUpdate(req.params.id, update, {
      new: true,
    });

    if (!updatedClient) {
      return res.status(404).json({ error: "Client not found" });
    }

    res.json({
      message: "✅ Client updated",
      client: updatedClient,
    });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ error: "Phone number already in use" });
    }
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

    const owesFromSales = await computeClientCreditDueFromOrders(client._id);
    const owesFromOpeningBalance =
      Math.round((Number(client.openingDebitBalance) || 0) * 100) / 100;
    const clientOwesUs = Math.round((owesFromSales + owesFromOpeningBalance) * 100) / 100;
    const creditBalanceDue = clientOwesUs;
    const prepaidBalance = Math.round((Number(client.creditBalance) || 0) * 100) / 100;
    const payableBreakdown = await computeClientPayableBreakdown(
      client._id,
      client.phoneNumber
    );
    const weOweClient = computeTotalClientCreditOwed(
      prepaidBalance,
      payableBreakdown.deferred
    );
    const netBalanceMessage = buildClientNetBalanceMessage(clientOwesUs, weOweClient);
    const settlementPreview = buildClientSettlementPreview(clientOwesUs, weOweClient);
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
      clientOwesUs,
      creditBalanceDue,
      owesFromSales,
      owesFromOpeningBalance,
      weOweClient,
      prepaidBalance,
      clientPayable: weOweClient,
      clientPayableDeferred: payableBreakdown.deferred,
      canSettle: settlementPreview.canSettle,
      settlementPreview,
      netBalanceMessage,
      creditOrdersCount: creditOrders.length,
      orders: ordersWithMeta,
      creditOrders,
      purchases,
      purchasesCount: purchases.length,
      ledgerEntries: (client.ledgerEntries || []).slice().reverse(),
    });
  } catch (error) {
    console.error("❌ Error fetching client history:", error.message);
    res.status(500).json({ error: "Failed to fetch client history" });
  }
};

/** POST set one-time opening debit (pre-system credit sales). */
export const setClientOpeningDebitBalance = async (req, res) => {
  try {
    const client = await Client.findById(req.params.id);
    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }

    const amount = Math.round((Number(req.body?.amount) || 0) * 100) / 100;
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: "Valid amount is required" });
    }

    const existing = Math.round((Number(client.openingDebitBalance) || 0) * 100) / 100;
    const alreadySet = (client.ledgerEntries || []).some((e) => e.type === "opening_debit");
    if (existing > 0 || alreadySet) {
      return res.status(400).json({
        error: "Opening debit balance already set",
        openingDebitBalance: existing,
      });
    }

    const uid = mongoose.Types.ObjectId.isValid(String(req.body?.userId || ""))
      ? new mongoose.Types.ObjectId(String(req.body.userId))
      : undefined;

    const note =
      String(req.body?.note || "Opening debit — pre-system credit sales").trim() ||
      "Opening debit — pre-system credit sales";

    client.openingDebitBalance = amount;
    client.ledgerEntries = client.ledgerEntries || [];
    client.ledgerEntries.push({
      type: "opening_debit",
      amount,
      note,
      affectsCashDrawer: false,
      createdAt: new Date(),
      createdByUserId: uid,
    });
    await client.save();

    const owesFromSales = await computeClientCreditDueFromOrders(client._id);
    const clientOwesUs = await computeClientOwesUs(client._id);

    res.json({
      message: "Opening debit balance set",
      openingDebitBalance: client.openingDebitBalance,
      owesFromOpeningBalance: client.openingDebitBalance,
      owesFromSales,
      clientOwesUs,
    });
  } catch (error) {
    console.error("❌ Error setting client opening debit:", error.message);
    res.status(500).json({ error: "Failed to set opening debit balance" });
  }
};

/** POST net settlement between client debt and credit (prepaid + deferred purchases). */
export const settleClientBalances = async (req, res) => {
  try {
    const client = await Client.findById(req.params.id);
    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }

    const clientOwesUs = await computeClientOwesUs(client._id);
    const prepaidBefore = Math.round((Number(client.creditBalance) || 0) * 100) / 100;
    const payableBefore = await computeClientPayableBreakdown(
      client._id,
      client.phoneNumber
    );
    const totalCreditBefore = computeTotalClientCreditOwed(
      prepaidBefore,
      payableBefore.deferred
    );
    const settleAmount = Math.min(clientOwesUs, totalCreditBefore);

    if (settleAmount <= 0) {
      return res.status(400).json({
        error: "No overlapping balances to settle",
        clientOwesUs,
        weOweClient: totalCreditBefore,
        prepaidBalance: prepaidBefore,
        clientPayableDeferred: payableBefore.deferred,
      });
    }

    let remaining = settleAmount;
    const unpaidOrders = await Order.find({
      clientId: client._id,
      partyType: { $in: [null, "client"] },
      paymentMethod: "credit",
      paymentStatus: { $in: ["unpaid", "partial"] },
      status: { $ne: "restored" },
    }).sort({ createdAt: 1 });

    const uid = mongoose.Types.ObjectId.isValid(String(req.body?.userId || ""))
      ? new mongoose.Types.ObjectId(String(req.body.userId))
      : undefined;

    for (const order of unpaidOrders) {
      if (remaining <= 0) break;
      const orderRem = orderAmountRemaining(order);
      if (orderRem <= 0) continue;

      const apply = Math.min(remaining, orderRem);
      order.payments = order.payments || [];
      order.payments.push({
        amount: apply,
        paidAt: new Date(),
        paidByUserId: uid,
        method: "settlement",
        note: "Balance settlement (netting)",
      });
      const paid = Number(order.amountPaid) || 0;
      order.amountPaid = Math.round((paid + apply) * 100) / 100;
      const total = Number(order.totalPrice) || 0;
      order.paymentStatus =
        order.amountPaid >= total - 0.001
          ? "paid"
          : order.amountPaid > 0
            ? "partial"
            : "unpaid";
      await order.save();
      remaining = Math.round((remaining - apply) * 100) / 100;
    }

    if (remaining > 0) {
      const openingBefore =
        Math.round((Number(client.openingDebitBalance) || 0) * 100) / 100;
      const fromOpening = Math.min(remaining, openingBefore);
      client.openingDebitBalance = Math.round((openingBefore - fromOpening) * 100) / 100;
      remaining = Math.round((remaining - fromOpening) * 100) / 100;
    }

    let creditToReduce = settleAmount;
    const fromPrepaid = Math.min(creditToReduce, prepaidBefore);
    client.creditBalance = Math.round((prepaidBefore - fromPrepaid) * 100) / 100;
    creditToReduce = Math.round((creditToReduce - fromPrepaid) * 100) / 100;

    if (creditToReduce > 0) {
      await applyClientDeferredPayableSettlement(
        client._id,
        client.phoneNumber,
        creditToReduce
      );
    }

    client.ledgerEntries = client.ledgerEntries || [];
    client.ledgerEntries.push({
      type: "settlement",
      amount: settleAmount,
      note: String(req.body?.note || "Balance settlement").trim(),
      affectsCashDrawer: false,
      createdAt: new Date(),
      createdByUserId: uid,
    });
    await client.save();

    const newOwesFromSales = await computeClientCreditDueFromOrders(client._id);
    const newOwesFromOpening =
      Math.round((Number(client.openingDebitBalance) || 0) * 100) / 100;
    const newClientOwesUs = await computeClientOwesUs(client._id);
    const newPrepaid = Math.round((Number(client.creditBalance) || 0) * 100) / 100;
    const newPayable = await computeClientPayableBreakdown(
      client._id,
      client.phoneNumber
    );
    const newWeOwe = computeTotalClientCreditOwed(newPrepaid, newPayable.deferred);
    const netBalanceMessage = buildClientNetBalanceMessage(newClientOwesUs, newWeOwe);
    const settlementPreview = buildClientSettlementPreview(newClientOwesUs, newWeOwe);

    res.json({
      message: "Balances settled",
      settled: settleAmount,
      clientOwesUs: newClientOwesUs,
      owesFromSales: newOwesFromSales,
      owesFromOpeningBalance: newOwesFromOpening,
      weOweClient: newWeOwe,
      prepaidBalance: newPrepaid,
      clientPayable: newWeOwe,
      clientPayableDeferred: newPayable.deferred,
      netBalanceMessage,
      settlementPreview,
    });
  } catch (error) {
    console.error("❌ Error settling client balances:", error.message);
    res.status(500).json({ error: "Failed to settle balances" });
  }
};

/** POST pay client (purchase treasuries) — deferred purchases + prepaid refund. */
export const payClient = async (req, res) => {
  try {
    const { paymentTreasurySplits: splitsRaw } = req.body || {};
    if (!Array.isArray(splitsRaw) || !splitsRaw.length) {
      return res.status(400).json({ error: "Payment treasury splits are required" });
    }

    const client = await Client.findById(req.params.id);
    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }

    const result = await payClientWithTreasury(client, {
      userId: req.body?.userId,
      branchId: req.body?.branchId,
      note: req.body?.note,
      paymentTreasurySplits: splitsRaw,
    });

    const payableBreakdown = await computeClientPayableBreakdown(
      client._id,
      client.phoneNumber
    );
    const owesFromSales = await computeClientCreditDueFromOrders(client._id);
    const owesFromOpeningBalance =
      Math.round((Number(client.openingDebitBalance) || 0) * 100) / 100;
    const clientOwesUs = Math.round((owesFromSales + owesFromOpeningBalance) * 100) / 100;
    const prepaidBalance = round2(result.prepaidBalance);
    const weOweClient = computeTotalClientCreditOwed(
      prepaidBalance,
      payableBreakdown.deferred
    );

    res.json({
      message: "Client payment recorded",
      ...result,
      clientOwesUs,
      weOweClient,
      prepaidBalance,
      clientPayable: weOweClient,
      clientPayableDeferred: payableBreakdown.deferred,
    });
  } catch (error) {
    const msg = error?.message || "Failed to record client payment";
    const status =
      msg.includes("exceeds") ||
      msg.includes("required") ||
      msg.includes("Invalid") ||
      msg.includes("Treasury") ||
      msg.includes("Deferred") ||
      msg.includes("Could not apply")
        ? 400
        : 500;
    console.error("❌ Error paying client:", error.message);
    res.status(status).json({ error: msg });
  }
};

/** POST add prepaid deposit (client money held at store). */
export const addClientDeposit = async (req, res) => {
  try {
    const client = await Client.findById(req.params.id);
    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }

    const splitsRaw = req.body?.paymentSplits ?? req.body?.paymentMethodSplits;
    let splits = normalizePaymentSplitsRaw(splitsRaw);
    const feeAllocations = normalizePaymentFeeAllocations(req.body?.paymentFeeAllocations);

    if (!splits.length) {
      const amount = Number(req.body?.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ error: "Valid amount is required" });
      }
      splits = [{ method: "cash", amount: Math.round(amount * 100) / 100 }];
    }

    const applied = totalNetFromPaymentSplits(splits);
    if (applied <= 0) {
      return res.status(400).json({ error: "Valid amount is required" });
    }

    client.creditBalance =
      Math.round(((Number(client.creditBalance) || 0) + applied) * 100) / 100;

    const uid = mongoose.Types.ObjectId.isValid(String(req.body?.userId || ""))
      ? new mongoose.Types.ObjectId(String(req.body.userId))
      : undefined;

    const branchId = await resolveBranchForCashDrawer({
      userId: req.body?.userId,
      branchId: req.body?.branchId,
    });

    const note = String(req.body?.note || "Client prepaid deposit").trim();
    const treasuryAudit = buildTreasurySplitsFromPayment(splits, feeAllocations);
    const cashDrawerAmount = cashAmountFromPaymentSplits(splits, feeAllocations);

    client.ledgerEntries = client.ledgerEntries || [];
    for (const s of splits) {
      const splitNote = `${note}${splits.length > 1 ? ` — ${s.method}` : ""}`;
      client.ledgerEntries.push({
        type: "deposit",
        amount: s.amount,
        paymentMethod: s.method,
        note: splitNote,
        createdAt: new Date(),
        createdByUserId: uid,
        ...buildCashDrawerLedgerFields({
          fromCashDrawer: isPhysicalCashMethod(s.method),
          branchId: isPhysicalCashMethod(s.method) ? branchId : undefined,
        }),
      });
    }
    await client.save();

    if (cashDrawerAmount > 0) {
      await recordClientCashDrawerReceipt({
        branchId: req.body?.branchId,
        userId: req.body?.userId,
        clientId: client._id,
        amount: cashDrawerAmount,
        paymentType: "deposit",
        note,
        paymentTreasurySplits: treasuryAudit,
      });
    }

    res.json({
      message: "Deposit recorded",
      prepaidBalance: client.creditBalance,
      cashDrawerAmount,
      paymentTreasurySplits: treasuryAudit,
    });
  } catch (error) {
    console.error("❌ Error adding client deposit:", error.message);
    res.status(500).json({ error: "Failed to record deposit" });
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
