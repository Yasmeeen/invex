import mongoose from "mongoose";
import moment from "moment-timezone";
import Order from "../../DB/models/order.model.js";
import Client from "../../DB/models/client.model.js";
import User from "../../DB/models/user.model.js";
import { serializePastPromiseHistory } from "../../utils/promise-to-pay.js";

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function installmentRemaining(row) {
  if (!row || row.paid) return 0;
  return Math.max(0, round2((Number(row.amount) || 0) - (Number(row.paidAmount) || 0)));
}

function isUnassignedFilter(raw) {
  const s = String(raw || "")
    .trim()
    .toLowerCase();
  return s === "none" || s === "unassigned" || s === "unassigned_only";
}

/**
 * Invoice-level collector overrides client assignment.
 * @returns {{ id: string, name: string }}
 */
function resolveCollector(order, client) {
  const orderCol = order?.collectorId;
  if (orderCol) {
    return {
      id: String(orderCol._id || orderCol),
      name: String(orderCol.name || "").trim(),
    };
  }
  const clientCol = client?.collectorId;
  if (clientCol) {
    return {
      id: String(clientCol._id || clientCol),
      name: String(clientCol.name || "").trim(),
    };
  }
  return { id: "", name: "" };
}

/**
 * Build Mongo filter for installment orders by effective collector.
 * Effective = order.collectorId || client.collectorId.
 */
async function applyCollectorToOrderQuery(orderQuery, collectorIdRaw) {
  if (isUnassignedFilter(collectorIdRaw)) {
    const assignedClients = await Client.find({
      collectorId: { $ne: null },
    })
      .select("_id")
      .lean();
    const assignedClientIds = assignedClients.map((c) => c._id);
    orderQuery.$and = [
      ...(orderQuery.$and || []),
      {
        $or: [{ collectorId: null }, { collectorId: { $exists: false } }],
      },
      assignedClientIds.length
        ? {
            $or: [
              { clientId: { $nin: assignedClientIds } },
              { clientId: null },
              { clientId: { $exists: false } },
            ],
          }
        : {},
    ].filter((c) => Object.keys(c).length);
    return { mode: "unassigned" };
  }

  if (!collectorIdRaw || !mongoose.Types.ObjectId.isValid(String(collectorIdRaw))) {
    return { mode: "all" };
  }

  const collectorOid = new mongoose.Types.ObjectId(String(collectorIdRaw));
  const clients = await Client.find({ collectorId: collectorOid })
    .select("_id")
    .lean();
  const clientIds = clients.map((c) => c._id);

  orderQuery.$or = [
    { collectorId: collectorOid },
    {
      $and: [
        {
          $or: [{ collectorId: null }, { collectorId: { $exists: false } }],
        },
        ...(clientIds.length ? [{ clientId: { $in: clientIds } }] : [{ _id: null }]),
      ],
    },
  ];

  return { mode: "collector", collectorOid, clientIds };
}

async function loadClientsForOrders(orders) {
  const ids = [
    ...new Set(orders.map((o) => String(o.clientId || "")).filter(Boolean)),
  ].filter((id) => mongoose.Types.ObjectId.isValid(id));
  if (!ids.length) return new Map();
  const clients = await Client.find({ _id: { $in: ids } })
    .select("name phoneNumber collectorId")
    .populate("collectorId", "name role")
    .lean();
  return new Map(clients.map((c) => [String(c._id), c]));
}

const OPEN_INSTALLMENT_ORDER_QUERY = {
  partyType: { $in: [null, "client"] },
  paymentMethod: "installment",
  paymentStatus: { $in: ["unpaid", "partial"] },
  status: { $ne: "restored" },
  "installments.0": { $exists: true },
};

/**
 * Count open installment invoices (+ distinct clients) per effective collector.
 */
async function computeCollectorWorkload() {
  const orders = await Order.find(OPEN_INSTALLMENT_ORDER_QUERY)
    .select("clientId collectorId")
    .lean();
  const clientById = await loadClientsForOrders(orders);
  const byCollector = new Map();

  for (const order of orders) {
    const client = clientById.get(String(order.clientId)) || null;
    const { id } = resolveCollector(order, client);
    if (!id) continue;
    if (!byCollector.has(id)) {
      byCollector.set(id, {
        openOrdersCount: 0,
        clientIds: new Set(),
      });
    }
    const row = byCollector.get(id);
    row.openOrdersCount += 1;
    if (order.clientId) row.clientIds.add(String(order.clientId));
  }

  const result = new Map();
  for (const [id, row] of byCollector) {
    result.set(id, {
      openOrdersCount: row.openOrdersCount,
      openClientsCount: row.clientIds.size,
    });
  }
  return result;
}

/**
 * GET /api/collections/due
 * Query: collectorId (or "unassigned"), branchId, status=due|overdue|promised|all,
 *        from, to (dueDate), promiseFrom, promiseTo (promiseToPayAt),
 *        page, limit, sortBy=remaining|date, sortDir=asc|desc
 */
export const listCollectionsDue = async (req, res) => {
  try {
    const {
      collectorId = "",
      branchId = "",
      status = "all",
      from,
      to,
      promiseFrom,
      promiseTo,
      page = 1,
      limit = 50,
      sortBy = "",
      sortDir = "asc",
    } = req.query;

    const pageLimit = Math.max(1, Math.min(200, Number(limit) || 50));
    const skip = (Math.max(1, Number(page) || 1) - 1) * pageLimit;
    const statusKey = String(status || "all").trim().toLowerCase();

    const hasBranchFilter =
      branchId && mongoose.Types.ObjectId.isValid(String(branchId));

    const orderQuery = {
      ...OPEN_INSTALLMENT_ORDER_QUERY,
    };
    if (hasBranchFilter) {
      orderQuery.branch = new mongoose.Types.ObjectId(String(branchId));
    }

    const collectorFilter = await applyCollectorToOrderQuery(orderQuery, collectorId);
    if (
      collectorFilter.mode === "collector" &&
      !collectorFilter.clientIds.length &&
      // still may have order-level assigns; $or covers that
      true
    ) {
      // no early empty — order.collectorId may still match
    }

    const orders = await Order.find(orderQuery)
      .select(
        "orderNumber clientId clientName clientPhoneNumber totalPrice amountPaid paymentStatus installmentPlanSnapshot installments createdAt branch collectorId"
      )
      .populate("branch", "name")
      .populate("collectorId", "name role")
      .lean();

    const clientById = await loadClientsForOrders(orders);

    const timezone = "Africa/Cairo";
    const now = moment.tz(timezone);
    const todayEnd = now.clone().endOf("day");

    let fromDate = null;
    let toDate = null;
    let promiseFromDate = null;
    let promiseToDate = null;
    if (from) {
      fromDate = moment.tz(String(from).trim(), "YYYY-MM-DD", timezone).startOf("day");
    }
    if (to) {
      toDate = moment.tz(String(to).trim(), "YYYY-MM-DD", timezone).endOf("day");
    }
    if (promiseFrom) {
      promiseFromDate = moment
        .tz(String(promiseFrom).trim(), "YYYY-MM-DD", timezone)
        .startOf("day");
    }
    if (promiseTo) {
      promiseToDate = moment
        .tz(String(promiseTo).trim(), "YYYY-MM-DD", timezone)
        .endOf("day");
    }
    const hasPromiseDateFilter = !!(promiseFromDate || promiseToDate);

    const items = [];
    let dueCount = 0;
    let overdueCount = 0;
    let promisedCount = 0;
    let dueAmount = 0;

    for (const order of orders) {
      const client = clientById.get(String(order.clientId)) || null;
      const collector = resolveCollector(order, client);

      // Safety net for in-memory filter (e.g. stale client populate edge cases)
      if (collectorFilter.mode === "collector") {
        if (collector.id !== String(collectorFilter.collectorOid)) continue;
      } else if (collectorFilter.mode === "unassigned") {
        if (collector.id) continue;
      }

      for (const inst of order.installments || []) {
        const rem = installmentRemaining(inst);
        if (rem <= 0.001) continue;

        const due = inst.dueDate ? moment(inst.dueDate).tz(timezone) : null;
        const promise = inst.promiseToPayAt
          ? moment(inst.promiseToPayAt).tz(timezone)
          : null;

        let rowStatus = "due";
        if (promise && promise.isValid()) {
          rowStatus = "promised";
        } else if (due && due.isValid() && due.isBefore(todayEnd) && due.isBefore(now)) {
          if (due.clone().endOf("day").isBefore(now)) {
            rowStatus = "overdue";
          }
        }

        if (statusKey !== "all" && statusKey !== rowStatus) continue;

        // When filtering by promise date, ignore due-date range so follow-ups
        // on older overdue installments still appear.
        if (!hasPromiseDateFilter) {
          if (fromDate && (!due || !due.isValid() || due.isBefore(fromDate))) continue;
          if (toDate && (!due || !due.isValid() || due.isAfter(toDate))) continue;
        } else {
          if (!promise || !promise.isValid()) continue;
          if (promiseFromDate && promise.isBefore(promiseFromDate)) continue;
          if (promiseToDate && promise.isAfter(promiseToDate)) continue;
        }

        if (rowStatus === "overdue") overdueCount += 1;
        else if (rowStatus === "promised") promisedCount += 1;
        else dueCount += 1;
        dueAmount = round2(dueAmount + rem);

        let daysOverdue = 0;
        if (rowStatus === "overdue" && due && due.isValid()) {
          daysOverdue = Math.max(
            0,
            now.clone().startOf("day").diff(due.clone().startOf("day"), "days")
          );
        }

        items.push({
          orderId: order._id,
          orderNumber: order.orderNumber,
          clientId: order.clientId,
          clientName: order.clientName || client?.name || "",
          clientPhoneNumber: order.clientPhoneNumber || client?.phoneNumber || "",
          collectorId: collector.id || null,
          collectorName: collector.name || "",
          branchName: order.branch?.name || "",
          planName: order.installmentPlanSnapshot?.name || "",
          planMonths: order.installmentPlanSnapshot?.months || null,
          installmentId: inst._id,
          sequence: inst.sequence,
          dueDate: inst.dueDate,
          amount: round2(inst.amount),
          paidAmount: round2(inst.paidAmount),
          remaining: rem,
          promiseToPayAt: inst.promiseToPayAt || null,
          promiseToPayHistory: serializePastPromiseHistory(inst),
          note: inst.note || "",
          status: rowStatus,
          daysOverdue,
          orderRemaining: Math.max(
            0,
            round2((Number(order.totalPrice) || 0) - (Number(order.amountPaid) || 0))
          ),
        });
      }
    }

    const sortKey = String(sortBy || "").trim().toLowerCase();
    const dir = String(sortDir || "asc").trim().toLowerCase() === "desc" ? -1 : 1;

    items.sort((a, b) => {
      if (sortKey === "remaining") {
        const diff = (Number(a.remaining) || 0) - (Number(b.remaining) || 0);
        if (diff !== 0) return diff * dir;
      }
      const da = new Date(a.promiseToPayAt || a.dueDate || 0).getTime();
      const db = new Date(b.promiseToPayAt || b.dueDate || 0).getTime();
      return da - db;
    });

    const totalCount = items.length;
    const pageRows = items.slice(skip, skip + pageLimit);
    const totalPages = Math.ceil(totalCount / pageLimit) || 0;

    res.json({
      items: pageRows,
      meta: {
        currentPage: Number(page) || 1,
        nextPage: (Number(page) || 1) < totalPages ? (Number(page) || 1) + 1 : null,
        prevPage: (Number(page) || 1) > 1 ? (Number(page) || 1) - 1 : null,
        totalCount,
        totalPages,
      },
      summary: {
        dueCount,
        overdueCount,
        promisedCount,
        dueAmount,
      },
    });
  } catch (error) {
    console.error("❌ listCollectionsDue:", error.message);
    res.status(500).json({ error: "Failed to load collections" });
  }
};

/**
 * GET collectors (users with role Collector) for assign pickers.
 * Query: withWorkload=1 → include openOrdersCount / openClientsCount
 */
export const listCollectors = async (req, res) => {
  try {
    const withWorkload =
      String(req.query.withWorkload || "").trim() === "1" ||
      String(req.query.withWorkload || "").toLowerCase() === "true";

    const users = await User.find({ role: "Collector" })
      .select("name email role branch")
      .populate("branch", "name")
      .sort({ name: 1 })
      .lean();

    if (!withWorkload) {
      return res.json({ collectors: users });
    }

    const workload = await computeCollectorWorkload();
    const collectors = users.map((u) => {
      const w = workload.get(String(u._id)) || {
        openOrdersCount: 0,
        openClientsCount: 0,
      };
      return {
        ...u,
        openOrdersCount: w.openOrdersCount,
        openClientsCount: w.openClientsCount,
      };
    });
    collectors.sort(
      (a, b) =>
        (Number(a.openOrdersCount) || 0) - (Number(b.openOrdersCount) || 0) ||
        String(a.name || "").localeCompare(String(b.name || ""), "ar")
    );
    res.json({ collectors });
  } catch (error) {
    console.error("❌ listCollectors:", error.message);
    res.status(500).json({ error: "Failed to list collectors" });
  }
};

/**
 * PATCH /api/collections/orders/:orderId/collector
 * Body: { collectorId: string | null }
 * Assigns (or clears) collector on an installment invoice.
 */
export const assignOrderCollector = async (req, res) => {
  try {
    const { orderId } = req.params;
    if (!orderId || !mongoose.Types.ObjectId.isValid(String(orderId))) {
      return res.status(400).json({ error: "Invalid order id" });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }
    if (String(order.paymentMethod || "").toLowerCase() !== "installment") {
      return res.status(400).json({ error: "Only installment invoices can be assigned" });
    }
    if (String(order.status || "") === "restored") {
      return res.status(400).json({ error: "Cannot assign a restored invoice" });
    }

    const raw = req.body?.collectorId;
    if (raw === null || raw === undefined || raw === "") {
      order.collectorId = null;
    } else if (!mongoose.Types.ObjectId.isValid(String(raw))) {
      return res.status(400).json({ error: "Invalid collector id" });
    } else {
      const user = await User.findById(String(raw)).select("name role").lean();
      if (!user || user.role !== "Collector") {
        return res.status(400).json({ error: "User is not a collector" });
      }
      order.collectorId = user._id;
    }

    await order.save();

    const populated = await Order.findById(order._id)
      .select("orderNumber collectorId clientId paymentMethod paymentStatus")
      .populate("collectorId", "name role")
      .lean();

    const collector = populated?.collectorId;
    res.json({
      orderId: populated._id,
      orderNumber: populated.orderNumber,
      collectorId: collector?._id || collector || null,
      collectorName: collector?.name || "",
    });
  } catch (error) {
    console.error("❌ assignOrderCollector:", error.message);
    res.status(500).json({ error: "Failed to assign collector" });
  }
};

function performanceStatus(rate) {
  if (rate >= 90) return "excellent";
  if (rate >= 75) return "good";
  if (rate >= 60) return "follow_up";
  return "low";
}

function daysOverdue(due, now) {
  if (!due || !due.isValid()) return 0;
  const end = due.clone().endOf("day");
  if (!end.isBefore(now)) return 0;
  return Math.max(1, now.clone().startOf("day").diff(due.clone().startOf("day"), "days"));
}

/**
 * GET /api/collections/dashboard
 * Query: collectorId (or "unassigned"), branchId, from, to, status
 */
export const getCollectionsDashboard = async (req, res) => {
  try {
    const {
      collectorId = "",
      branchId = "",
      status = "all",
      from,
      to,
    } = req.query;

    const timezone = "Africa/Cairo";
    const now = moment.tz(timezone);
    const todayStart = now.clone().startOf("day");
    const todayEnd = now.clone().endOf("day");
    const soonEnd = now.clone().add(7, "days").endOf("day");
    const statusKey = String(status || "all").trim().toLowerCase();

    let fromDate = null;
    let toDate = null;
    if (from) {
      fromDate = moment.tz(String(from).trim(), "YYYY-MM-DD", timezone).startOf("day");
    }
    if (to) {
      toDate = moment.tz(String(to).trim(), "YYYY-MM-DD", timezone).endOf("day");
    }

    const hasBranchFilter =
      branchId && mongoose.Types.ObjectId.isValid(String(branchId));
    const hasCollectorFilter =
      collectorId &&
      (isUnassignedFilter(collectorId) ||
        mongoose.Types.ObjectId.isValid(String(collectorId)));

    const orderQuery = {
      partyType: { $in: [null, "client"] },
      paymentMethod: "installment",
      status: { $ne: "restored" },
      "installments.0": { $exists: true },
    };
    if (hasBranchFilter) {
      orderQuery.branch = new mongoose.Types.ObjectId(String(branchId));
    }

    const collectorFilter = hasCollectorFilter
      ? await applyCollectorToOrderQuery(orderQuery, collectorId)
      : { mode: "all" };

    const orders = await Order.find(orderQuery)
      .select(
        "orderNumber clientId clientName clientPhoneNumber totalPrice amountPaid paymentStatus installmentPlanSnapshot installments createdAt branch collectorId"
      )
      .populate("branch", "name")
      .populate("collectorId", "name role")
      .lean();

    const clientById = await loadClientsForOrders(orders);
    const workload = await computeCollectorWorkload();

    const allCollectors = await User.find({ role: "Collector" })
      .select("name")
      .sort({ name: 1 })
      .lean();
    const collectorStats = new Map();
    for (const c of allCollectors) {
      const id = String(c._id);
      const w = workload.get(id) || { openOrdersCount: 0, openClientsCount: 0 };
      collectorStats.set(id, {
        collectorId: id,
        collectorName: c.name || "",
        target: 0,
        collected: 0,
        overdue: 0,
        openOrdersCount: w.openOrdersCount,
        openClientsCount: w.openClientsCount,
      });
    }

    let totalInstallments = 0;
    let collected = 0;
    let overdue = 0;
    let dueSoon = 0;

    const overdueItems = [];
    const promisesTodayItems = [];
    let promisesTodayCount = 0;

    const monthKeys = [];
    const monthCursor = (fromDate && fromDate.isValid()
      ? fromDate.clone()
      : now.clone().subtract(7, "months")
    ).startOf("month");
    const monthEnd = (toDate && toDate.isValid() ? toDate.clone() : now.clone()).endOf("month");
    const cursor = monthCursor.clone();
    while (cursor.isSameOrBefore(monthEnd) && monthKeys.length < 12) {
      monthKeys.push(cursor.format("YYYY-MM"));
      cursor.add(1, "month");
    }
    const monthlyMap = new Map(
      monthKeys.map((k) => [k, { key: k, target: 0, collected: 0 }])
    );

    const inDateRange = (m) => {
      if (!m || !m.isValid()) return !fromDate && !toDate;
      if (fromDate && m.isBefore(fromDate)) return false;
      if (toDate && m.isAfter(toDate)) return false;
      return true;
    };

    for (const order of orders) {
      const client = clientById.get(String(order.clientId)) || null;
      const collector = resolveCollector(order, client);

      if (collectorFilter.mode === "collector") {
        if (collector.id !== String(collectorFilter.collectorOid)) continue;
      } else if (collectorFilter.mode === "unassigned") {
        if (collector.id) continue;
      }

      const colId = collector.id;
      const colName = collector.name;
      if (colId && !collectorStats.has(colId)) {
        const w = workload.get(colId) || { openOrdersCount: 0, openClientsCount: 0 };
        collectorStats.set(colId, {
          collectorId: colId,
          collectorName: colName,
          target: 0,
          collected: 0,
          overdue: 0,
          openOrdersCount: w.openOrdersCount,
          openClientsCount: w.openClientsCount,
        });
      }
      const colStat = colId ? collectorStats.get(colId) : null;

      for (const inst of order.installments || []) {
        const amount = round2(inst.amount);
        const paidAmt = round2(inst.paidAmount || (inst.paid ? amount : 0));
        const rem = installmentRemaining({
          ...inst,
          paidAmount: paidAmt,
          paid: !!inst.paid || paidAmt >= amount - 0.001,
        });
        const due = inst.dueDate ? moment(inst.dueDate).tz(timezone) : null;
        const promise = inst.promiseToPayAt
          ? moment(inst.promiseToPayAt).tz(timezone)
          : null;
        const paidAt = inst.paidAt ? moment(inst.paidAt).tz(timezone) : null;

        let rowStatus = "due";
        if (promise && promise.isValid() && rem > 0.001) {
          rowStatus = "promised";
        } else if (due && due.isValid() && due.clone().endOf("day").isBefore(now) && rem > 0.001) {
          rowStatus = "overdue";
        } else if (inst.paid || rem <= 0.001) {
          rowStatus = "paid";
        }

        const dueInRange = inDateRange(due);
        const paidInRange = inDateRange(paidAt);

        if (dueInRange) {
          totalInstallments = round2(totalInstallments + amount);
          if (colStat) colStat.target = round2(colStat.target + amount);
          if (due && due.isValid()) {
            const mk = due.format("YYYY-MM");
            if (monthlyMap.has(mk)) {
              monthlyMap.get(mk).target = round2(monthlyMap.get(mk).target + amount);
            }
          }
        }

        if (paidAmt > 0 && (paidInRange || (!paidAt && dueInRange))) {
          const creditPaid = paidAt && paidAt.isValid() ? paidInRange : dueInRange;
          if (creditPaid) {
            collected = round2(collected + paidAmt);
            if (colStat) colStat.collected = round2(colStat.collected + paidAmt);
            if (paidAt && paidAt.isValid()) {
              const mk = paidAt.format("YYYY-MM");
              if (monthlyMap.has(mk)) {
                monthlyMap.get(mk).collected = round2(
                  monthlyMap.get(mk).collected + paidAmt
                );
              }
            } else if (due && due.isValid()) {
              const mk = due.format("YYYY-MM");
              if (monthlyMap.has(mk)) {
                monthlyMap.get(mk).collected = round2(
                  monthlyMap.get(mk).collected + paidAmt
                );
              }
            }
          }
        }

        if (rem > 0.001 && dueInRange) {
          if (rowStatus === "overdue") {
            overdue = round2(overdue + rem);
            if (colStat) colStat.overdue = round2(colStat.overdue + rem);
          } else if (
            due &&
            due.isValid() &&
            due.isSameOrAfter(todayStart) &&
            due.isSameOrBefore(soonEnd)
          ) {
            dueSoon = round2(dueSoon + rem);
          }
        }

        if (
          rem > 0.001 &&
          promise &&
          promise.isValid() &&
          promise.isSameOrAfter(todayStart) &&
          promise.isSameOrBefore(todayEnd)
        ) {
          promisesTodayCount += 1;
          if (promisesTodayItems.length < 50) {
            promisesTodayItems.push({
              orderId: order._id,
              orderNumber: order.orderNumber,
              clientId: order.clientId,
              clientName: order.clientName || client?.name || "",
              collectorId: colId || null,
              collectorName: colName,
              installmentId: inst._id,
              sequence: inst.sequence,
              promiseToPayAt: inst.promiseToPayAt,
              promiseToPayHistory: serializePastPromiseHistory(inst),
              remaining: rem,
            });
          }
        }

        if (rowStatus === "overdue" && rem > 0.001 && dueInRange) {
          const days = daysOverdue(due, now);
          const itemStatus = days >= 14 ? "severe" : "overdue";
          const statusOk =
            statusKey === "all" ||
            statusKey === "overdue" ||
            statusKey === itemStatus;
          if (statusOk) {
            overdueItems.push({
              orderId: order._id,
              orderNumber: order.orderNumber,
              clientId: order.clientId,
              clientName: order.clientName || client?.name || "",
              clientPhoneNumber: order.clientPhoneNumber || client?.phoneNumber || "",
              collectorId: colId || null,
              collectorName: colName,
              branchName: order.branch?.name || "",
              installmentId: inst._id,
              sequence: inst.sequence,
              dueDate: inst.dueDate,
              daysOverdue: days,
              remaining: rem,
              promiseToPayAt: inst.promiseToPayAt || null,
              promiseToPayHistory: serializePastPromiseHistory(inst),
              status: itemStatus,
            });
          }
        }
      }
    }

    overdueItems.sort((a, b) => b.daysOverdue - a.daysOverdue);

    let collectorsPerf = [...collectorStats.values()]
      .filter((c) => {
        if (collectorFilter.mode === "collector") {
          return c.collectorId === String(collectorFilter.collectorOid);
        }
        return true;
      })
      .map((c) => {
        const rate =
          c.target > 0 ? Math.round((c.collected / c.target) * 1000) / 10 : 0;
        return {
          ...c,
          collectionRate: rate,
          status: performanceStatus(rate),
        };
      });

    if (collectorFilter.mode !== "collector") {
      collectorsPerf = collectorsPerf.filter(
        (c) =>
          c.target > 0 ||
          c.collected > 0 ||
          c.overdue > 0 ||
          c.openOrdersCount > 0
      );
    }
    // Least-loaded collectors first so admins can balance new invoices
    collectorsPerf.sort(
      (a, b) =>
        (Number(a.openOrdersCount) || 0) - (Number(b.openOrdersCount) || 0) ||
        b.collectionRate - a.collectionRate
    );

    const monthlySeries = monthKeys.map((k) => {
      const row = monthlyMap.get(k);
      const label = moment.tz(k + "-01", "YYYY-MM-DD", timezone).format("MMM");
      return {
        key: k,
        label,
        target: row?.target || 0,
        collected: row?.collected || 0,
      };
    });
    const monthlyTarget = round2(monthlySeries.reduce((s, r) => s + r.target, 0));
    const monthlyCollected = round2(
      monthlySeries.reduce((s, r) => s + r.collected, 0)
    );

    const collectionRate =
      totalInstallments > 0
        ? Math.round((collected / totalInstallments) * 1000) / 10
        : 0;

    let unassignedOrdersCount = 0;
    {
      const openOrders = await Order.find({
        ...OPEN_INSTALLMENT_ORDER_QUERY,
        ...(hasBranchFilter
          ? { branch: new mongoose.Types.ObjectId(String(branchId)) }
          : {}),
      })
        .select("clientId collectorId")
        .lean();
      const map = await loadClientsForOrders(openOrders);
      for (const o of openOrders) {
        const c = map.get(String(o.clientId)) || null;
        if (!resolveCollector(o, c).id) unassignedOrdersCount += 1;
      }
    }

    res.json({
      summary: {
        totalInstallments,
        collected,
        overdue,
        dueSoon,
        collectionRate,
        unassignedOrdersCount,
      },
      collectors: collectorsPerf,
      monthly: {
        target: monthlyTarget,
        collected: monthlyCollected,
        series: monthlySeries,
      },
      overdueItems: overdueItems.slice(0, 100),
      promisesToday: {
        count: promisesTodayCount,
        items: promisesTodayItems,
      },
    });
  } catch (error) {
    console.error("❌ getCollectionsDashboard:", error.message);
    res.status(500).json({ error: "Failed to load collections dashboard" });
  }
};

/**
 * GET /api/collections/has-installments
 */
export const hasInstallmentOrders = async (req, res) => {
  try {
    const found = await Order.exists({
      partyType: { $in: [null, "client"] },
      paymentMethod: "installment",
      status: { $ne: "restored" },
      "installments.0": { $exists: true },
    });
    res.json({ hasInstallments: !!found });
  } catch (error) {
    console.error("❌ hasInstallmentOrders:", error.message);
    res.status(500).json({ error: "Failed to check installment usage" });
  }
};
