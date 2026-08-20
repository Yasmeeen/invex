import mongoose from "mongoose";
import moment from "moment-timezone";
import Order from "../../DB/models/order.model.js";
import Client from "../../DB/models/client.model.js";
import User from "../../DB/models/user.model.js";

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function installmentRemaining(row) {
  if (!row || row.paid) return 0;
  return Math.max(0, round2((Number(row.amount) || 0) - (Number(row.paidAmount) || 0)));
}

/**
 * GET /api/collections/due
 * Query: collectorId, status=due|overdue|promised|all, from, to, page, limit
 * Admin sees all (optional collectorId filter). Collector should pass own id.
 */
export const listCollectionsDue = async (req, res) => {
  try {
    const {
      collectorId = "",
      status = "all",
      from,
      to,
      page = 1,
      limit = 50,
    } = req.query;

    const pageLimit = Math.max(1, Math.min(200, Number(limit) || 50));
    const skip = (Math.max(1, Number(page) || 1) - 1) * pageLimit;
    const statusKey = String(status || "all").trim().toLowerCase();

    let clientFilter = {};
    const hasCollectorFilter =
      collectorId && mongoose.Types.ObjectId.isValid(String(collectorId));
    if (hasCollectorFilter) {
      clientFilter.collectorId = new mongoose.Types.ObjectId(String(collectorId));
    }

    let clients = [];
    let clientIds = [];
    let clientById = new Map();

    if (hasCollectorFilter) {
      clients = await Client.find(clientFilter)
        .select("name phoneNumber collectorId")
        .populate("collectorId", "name role")
        .lean();
      clientIds = clients.map((c) => c._id);
      clientById = new Map(clients.map((c) => [String(c._id), c]));
      if (!clientIds.length) {
        return res.json({
          items: [],
          meta: { currentPage: Number(page) || 1, totalCount: 0, totalPages: 0 },
          summary: { dueCount: 0, overdueCount: 0, promisedCount: 0, dueAmount: 0 },
        });
      }
    }

    const orderQuery = {
      partyType: { $in: [null, "client"] },
      paymentMethod: "installment",
      paymentStatus: { $in: ["unpaid", "partial"] },
      status: { $ne: "restored" },
      "installments.0": { $exists: true },
    };
    if (hasCollectorFilter) {
      orderQuery.clientId = { $in: clientIds };
    }

    const orders = await Order.find(orderQuery)
      .select(
        "orderNumber clientId clientName clientPhoneNumber totalPrice amountPaid paymentStatus installmentPlanSnapshot installments createdAt branch"
      )
      .populate("branch", "name")
      .lean();

    if (!hasCollectorFilter) {
      const ids = [
        ...new Set(orders.map((o) => String(o.clientId || "")).filter(Boolean)),
      ].filter((id) => mongoose.Types.ObjectId.isValid(id));
      if (ids.length) {
        clients = await Client.find({ _id: { $in: ids } })
          .select("name phoneNumber collectorId")
          .populate("collectorId", "name role")
          .lean();
        clientById = new Map(clients.map((c) => [String(c._id), c]));
      }
    }

    const timezone = "Africa/Cairo";
    const now = moment.tz(timezone);
    const todayEnd = now.clone().endOf("day");

    let fromDate = null;
    let toDate = null;
    if (from) {
      fromDate = moment.tz(String(from).trim(), "YYYY-MM-DD", timezone).startOf("day");
    }
    if (to) {
      toDate = moment.tz(String(to).trim(), "YYYY-MM-DD", timezone).endOf("day");
    }

    const items = [];
    let dueCount = 0;
    let overdueCount = 0;
    let promisedCount = 0;
    let dueAmount = 0;

    for (const order of orders) {
      const client = clientById.get(String(order.clientId)) || null;
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
          // overdue if due date day has passed
          if (due.clone().endOf("day").isBefore(now)) {
            rowStatus = "overdue";
          }
        }

        if (statusKey !== "all" && statusKey !== rowStatus) continue;

        const compareDate = promise?.isValid() ? promise : due;
        if (fromDate && compareDate && compareDate.isBefore(fromDate)) continue;
        if (toDate && compareDate && compareDate.isAfter(toDate)) continue;

        if (rowStatus === "overdue") overdueCount += 1;
        else if (rowStatus === "promised") promisedCount += 1;
        else dueCount += 1;
        dueAmount = round2(dueAmount + rem);

        items.push({
          orderId: order._id,
          orderNumber: order.orderNumber,
          clientId: order.clientId,
          clientName: order.clientName || client?.name || "",
          clientPhoneNumber: order.clientPhoneNumber || client?.phoneNumber || "",
          collectorId: client?.collectorId?._id || client?.collectorId || null,
          collectorName: client?.collectorId?.name || "",
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
          note: inst.note || "",
          status: rowStatus,
          orderRemaining: Math.max(
            0,
            round2((Number(order.totalPrice) || 0) - (Number(order.amountPaid) || 0))
          ),
        });
      }
    }

    items.sort((a, b) => {
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

/** GET collectors (users with role Collector) for assign pickers. */
export const listCollectors = async (req, res) => {
  try {
    const users = await User.find({ role: "Collector" })
      .select("name email role branch")
      .populate("branch", "name")
      .sort({ name: 1 })
      .lean();
    res.json({ collectors: users });
  } catch (error) {
    console.error("❌ listCollectors:", error.message);
    res.status(500).json({ error: "Failed to list collectors" });
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
 * Query: collectorId, branchId, from, to, status
 * Admin: all installments (+ optional filters). Collector: pass own collectorId.
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

    const hasCollectorFilter =
      collectorId && mongoose.Types.ObjectId.isValid(String(collectorId));
    const hasBranchFilter =
      branchId && mongoose.Types.ObjectId.isValid(String(branchId));

    let clientFilter = {};
    if (hasCollectorFilter) {
      clientFilter.collectorId = new mongoose.Types.ObjectId(String(collectorId));
    }

    let clients = [];
    let clientIds = [];
    let clientById = new Map();

    if (hasCollectorFilter) {
      clients = await Client.find(clientFilter)
        .select("name phoneNumber collectorId")
        .populate("collectorId", "name role")
        .lean();
      clientIds = clients.map((c) => c._id);
      clientById = new Map(clients.map((c) => [String(c._id), c]));
      if (!clientIds.length) {
        return res.json({
          summary: {
            totalInstallments: 0,
            collected: 0,
            overdue: 0,
            dueSoon: 0,
            collectionRate: 0,
          },
          collectors: [],
          monthly: { target: 0, collected: 0, series: [] },
          overdueItems: [],
          promisesToday: { count: 0, items: [] },
        });
      }
    }

    const orderQuery = {
      partyType: { $in: [null, "client"] },
      paymentMethod: "installment",
      status: { $ne: "restored" },
      "installments.0": { $exists: true },
    };
    if (hasCollectorFilter) {
      orderQuery.clientId = { $in: clientIds };
    }
    if (hasBranchFilter) {
      orderQuery.branch = new mongoose.Types.ObjectId(String(branchId));
    }

    const orders = await Order.find(orderQuery)
      .select(
        "orderNumber clientId clientName clientPhoneNumber totalPrice amountPaid paymentStatus installmentPlanSnapshot installments createdAt branch"
      )
      .populate("branch", "name")
      .lean();

    if (!hasCollectorFilter) {
      const ids = [
        ...new Set(orders.map((o) => String(o.clientId || "")).filter(Boolean)),
      ].filter((id) => mongoose.Types.ObjectId.isValid(id));
      if (ids.length) {
        clients = await Client.find({ _id: { $in: ids } })
          .select("name phoneNumber collectorId")
          .populate("collectorId", "name role")
          .lean();
        clientById = new Map(clients.map((c) => [String(c._id), c]));
      }
    }

    const allCollectors = await User.find({ role: "Collector" })
      .select("name")
      .sort({ name: 1 })
      .lean();
    const collectorStats = new Map();
    for (const c of allCollectors) {
      collectorStats.set(String(c._id), {
        collectorId: String(c._id),
        collectorName: c.name || "",
        target: 0,
        collected: 0,
        overdue: 0,
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
      const colId = String(client?.collectorId?._id || client?.collectorId || "");
      const colName = client?.collectorId?.name || "";
      if (colId && !collectorStats.has(colId)) {
        collectorStats.set(colId, {
          collectorId: colId,
          collectorName: colName,
          target: 0,
          collected: 0,
          overdue: 0,
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
              collectorName: colName,
              installmentId: inst._id,
              sequence: inst.sequence,
              promiseToPayAt: inst.promiseToPayAt,
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
              status: itemStatus,
            });
          }
        }
      }
    }

    overdueItems.sort((a, b) => b.daysOverdue - a.daysOverdue);

    let collectorsPerf = [...collectorStats.values()]
      .filter((c) => !hasCollectorFilter || c.collectorId === String(collectorId))
      .map((c) => {
        const rate =
          c.target > 0 ? Math.round((c.collected / c.target) * 1000) / 10 : 0;
        return {
          ...c,
          collectionRate: rate,
          status: performanceStatus(rate),
        };
      });

    if (!hasCollectorFilter) {
      collectorsPerf = collectorsPerf.filter(
        (c) => c.target > 0 || c.collected > 0 || c.overdue > 0
      );
    }
    collectorsPerf.sort((a, b) => b.collectionRate - a.collectionRate);

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

    res.json({
      summary: {
        totalInstallments,
        collected,
        overdue,
        dueSoon,
        collectionRate,
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
