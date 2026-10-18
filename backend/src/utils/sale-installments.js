import { onInstallmentPaymentForPromises } from "./promise-to-pay.js";

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * Trading profit on order lines (after interest/markup baked into prices).
 * Matches paper: total installment profit = Σ(price×qty) − Σ(cost×qty).
 */
export function orderLineTradingProfit(products) {
  return round2(
    (products || []).reduce((sum, p) => {
      const qty = Number(p.quantity) || 0;
      const rev = (Number(p.price) || 0) * qty;
      const cost = (Number(p.cost) || 0) * qty;
      return sum + (rev - cost);
    }, 0)
  );
}

/**
 * Split total installment profit across schedule rows (last row absorbs rounding).
 * Mutates installments in place; initializes recognizedProfit to 0 when missing.
 */
export function allocateInstallmentProfitShares(installments, totalProfit) {
  const rows = installments || [];
  const n = rows.length;
  if (!n) return 0;
  const total = round2(Math.max(0, Number(totalProfit) || 0));
  const base = Math.floor((total / n) * 100) / 100;
  let allocated = 0;
  for (let i = 0; i < n; i++) {
    const share = i === n - 1 ? round2(total - allocated) : base;
    rows[i].profitShare = share;
    if (rows[i].recognizedProfit == null || Number.isNaN(Number(rows[i].recognizedProfit))) {
      rows[i].recognizedProfit = 0;
    }
    allocated = round2(allocated + share);
  }
  return total;
}

/**
 * Ensure legacy installment orders have profitShare / recognizedProfit.
 * recognizedProfit for already-paid amounts is approximated from paidAmount/amount.
 */
export function ensureInstallmentProfitShares(order) {
  const installments = order?.installments || [];
  if (!installments.length) return 0;

  const needsShare = installments.some(
    (r) => r.profitShare == null || Number.isNaN(Number(r.profitShare))
  );
  let total;
  if (needsShare) {
    total = orderLineTradingProfit(order.products);
    allocateInstallmentProfitShares(installments, total);
    if (order.installmentTotalProfit == null) {
      order.installmentTotalProfit = total;
    }
  } else {
    total = round2(
      installments.reduce((s, r) => s + (Number(r.profitShare) || 0), 0)
    );
    if (order.installmentTotalProfit == null) {
      order.installmentTotalProfit = total;
    }
  }

  for (const row of installments) {
    const amount = round2(row.amount);
    const paid = round2(row.paidAmount);
    const share = round2(row.profitShare);
    if (row.recognizedProfit == null || Number.isNaN(Number(row.recognizedProfit))) {
      row.recognizedProfit =
        amount > 0.001 && paid > 0.001
          ? round2(share * Math.min(1, paid / amount))
          : 0;
    }
  }
  return total;
}

/**
 * Build equal monthly installment schedule for a customer sale.
 * Last installment absorbs rounding remainder so sum === totalDue.
 * Call allocateInstallmentProfitShares after line prices include interest.
 */
function buildInstallmentRows({ months, startDate, totalDue, monthlyBase }) {
  const m = Math.max(1, Math.floor(Number(months) || 1));
  const dueTotal = round2(totalDue);
  const base = round2(monthlyBase);
  const start = startDate ? new Date(startDate) : new Date();
  if (Number.isNaN(start.getTime())) {
    throw new Error("Invalid installment start date");
  }

  const rows = [];
  let allocated = 0;
  for (let i = 0; i < m; i++) {
    const due = new Date(start);
    due.setMonth(due.getMonth() + i);
    const amount =
      i === m - 1 ? round2(dueTotal - allocated) : base;
    allocated = round2(allocated + amount);
    rows.push({
      sequence: i + 1,
      dueDate: due,
      amount,
      paid: false,
      paidAmount: 0,
      profitShare: 0,
      recognizedProfit: 0,
      paymentMethod: "",
      note: "",
    });
  }

  return rows;
}

export function buildSaleInstallmentSchedule({
  principal,
  interestPercent,
  months,
  startDate,
  monthlyAmountOverride,
}) {
  const m = Math.max(1, Math.floor(Number(months) || 1));
  const p = round2(principal);
  const rate = Math.max(0, Number(interestPercent) || 0) / 100;
  const interestAmount = round2(p * rate);
  const defaultTotalDue = round2(p + interestAmount);
  const defaultMonthlyBase = Math.floor((defaultTotalDue / m) * 100) / 100;

  const override = round2(monthlyAmountOverride);
  const hasOverride =
    Number.isFinite(override) &&
    override > 0 &&
    Math.abs(override - defaultMonthlyBase) > 0.004;

  if (!hasOverride) {
    return {
      principal: p,
      interestAmount,
      totalDue: defaultTotalDue,
      adjustmentAmount: 0,
      installments: buildInstallmentRows({
        months: m,
        startDate,
        totalDue: defaultTotalDue,
        monthlyBase: defaultMonthlyBase,
      }),
    };
  }

  const customTotalDue = round2(override * m);
  const adjustmentAmount = round2(customTotalDue - defaultTotalDue);

  return {
    principal: p,
    interestAmount,
    totalDue: customTotalDue,
    adjustmentAmount,
    installments: buildInstallmentRows({
      months: m,
      startDate,
      totalDue: customTotalDue,
      monthlyBase: override,
    }),
  };
}

function installmentRemaining(row) {
  if (!row || row.paid) return 0;
  const amount = round2(row.amount);
  const paidAmount = round2(row.paidAmount);
  return Math.max(0, round2(amount - paidAmount));
}

/** Count unpaid installment rows (partial counts as unpaid). */
export function countUnpaidInstallments(installments) {
  return (installments || []).filter((r) => installmentRemaining(r) > 0.001).length;
}

/**
 * Apply a payment onto installment rows (mutates array in place).
 * Recognizes installment profit proportionally: profitShare × (delta / amount).
 * If installmentId is set, prefer that row first, then FIFO by sequence.
 */
export function applyPaymentToInstallments(installments, appliedAmount, meta = {}) {
  let left = round2(appliedAmount);
  if (left <= 0 || !Array.isArray(installments) || !installments.length) {
    return {
      applied: 0,
      installmentProfit: 0,
      remainingInstallments: countUnpaidInstallments(installments),
    };
  }

  const paidAt = meta.paidAt ? new Date(meta.paidAt) : new Date();
  const method = String(meta.paymentMethod || "").trim();
  const uid = meta.paidByUserId || undefined;
  const preferId = meta.installmentId ? String(meta.installmentId) : "";

  const orderIdx = installments
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => installmentRemaining(row) > 0.001)
    .sort((a, b) => {
      if (preferId) {
        const aMatch = String(a.row._id || "") === preferId ? 0 : 1;
        const bMatch = String(b.row._id || "") === preferId ? 0 : 1;
        if (aMatch !== bMatch) return aMatch - bMatch;
      }
      return (a.row.sequence || 0) - (b.row.sequence || 0);
    });

  let applied = 0;
  let installmentProfit = 0;
  for (const { row } of orderIdx) {
    if (left <= 0) break;
    const rem = installmentRemaining(row);
    const take = Math.min(rem, left);
    const amount = round2(row.amount);
    const share = round2(row.profitShare);
    const prevRecognized = round2(row.recognizedProfit);

    row.paidAmount = round2((Number(row.paidAmount) || 0) + take);
    if (row.paidAmount >= amount - 0.001) {
      row.paid = true;
      row.paidAmount = amount;
    } else {
      row.paid = false;
    }

    const targetRecognized =
      row.paid || amount <= 0.001
        ? share
        : round2(share * (row.paidAmount / amount));
    const deltaProfit = round2(targetRecognized - prevRecognized);
    row.recognizedProfit = targetRecognized;
    installmentProfit = round2(installmentProfit + Math.max(0, deltaProfit));

    row.paidAt = paidAt;
    if (method) row.paymentMethod = method;
    if (uid) row.paidByUserId = uid;
    onInstallmentPaymentForPromises(row, { userId: uid, now: paidAt || new Date() });
    left = round2(left - take);
    applied = round2(applied + take);
  }

  return {
    applied,
    installmentProfit,
    remainingInstallments: countUnpaidInstallments(installments),
  };
}

function installmentRowRemaining(row) {
  return installmentRemaining(row);
}

/**
 * Spread `total` across weights. Last bucket absorbs rounding.
 * `capAtWeight` keeps each share within its weight (cash vs installment remaining).
 */
function allocateAcross(weights, total, { capAtWeight = false } = {}) {
  const n = weights.length;
  const out = new Array(n).fill(0);
  const sum = round2(weights.reduce((s, w) => s + Math.max(0, Number(w) || 0), 0));
  const target = round2(total);
  if (!n || target === 0) return out;
  if (sum <= 0) {
    out[n - 1] = target;
    return out;
  }
  if (capAtWeight && target >= sum - 0.001) return weights.map((w) => round2(Math.max(0, w)));

  let allocated = 0;
  for (let i = 0; i < n; i++) {
    const cap = round2(Math.max(0, Number(weights[i]) || 0));
    if (i === n - 1) {
      const rest = round2(target - allocated);
      out[i] = capAtWeight ? round2(Math.min(cap, Math.max(0, rest))) : rest;
      break;
    }
    const share = round2((target * cap) / sum);
    const take = capAtWeight ? round2(Math.min(cap, Math.max(0, share))) : share;
    out[i] = take;
    allocated = round2(allocated + take);
  }
  if (capAtWeight) {
    let left = round2(target - out.reduce((s, n) => s + n, 0));
    for (let i = 0; i < n && left > 0.001; i++) {
      const room = round2(Math.max(0, Number(weights[i]) || 0) - out[i]);
      if (room <= 0.001) continue;
      const add = round2(Math.min(room, left));
      out[i] = round2(out[i] + add);
      left = round2(left - add);
    }
  }
  return out;
}

/**
 * Early settlement: customer pays `settlementAmount` instead of the open balance.
 * Interest is whatever is collected above installment principal (principal first).
 * Sale profit is cash that will have been collected minus goods cost.
 */
export function previewEarlySettlement(order, settlementAmount) {
  const rows = Array.isArray(order?.installments) ? order.installments : [];
  const unpaid = rows.filter((r) => installmentRowRemaining(r) > 0.001);
  const installmentRemainingTotal = round2(
    unpaid.reduce((s, r) => s + installmentRowRemaining(r), 0)
  );
  const scheduleTotal = round2(rows.reduce((s, r) => s + round2(r.amount), 0));
  const schedulePaid = round2(rows.reduce((s, r) => s + round2(r.paidAmount), 0));
  const principal = round2(order?.installmentPrincipal);
  const interestFromFields = round2(
    (Number(order?.installmentInterestAmount) || 0) +
      (Number(order?.installmentSurchargeAmount) || 0) -
      (Number(order?.installmentDiscountAmount) || 0)
  );
  const hasInterestInfo =
    interestFromFields > 0.001 ||
    (principal > 0.001 && scheduleTotal > principal + 0.001);
  const interestPlanned = !hasInterestInfo
    ? 0
    : interestFromFields > 0.001
      ? interestFromFields
      : round2(scheduleTotal - principal);

  const amountPaid = round2(order?.amountPaid);
  const totalPrice = round2(order?.totalPrice);
  const invoiceRemaining = round2(Math.max(0, totalPrice - amountPaid));
  const due =
    invoiceRemaining > 0.001 ? invoiceRemaining : installmentRemainingTotal;

  const rawSettlement = round2(settlementAmount);
  const settlementValid =
    Number.isFinite(rawSettlement) &&
    rawSettlement > 0.001 &&
    rawSettlement <= due + 0.001 &&
    due > 0.001;
  const settlement = settlementValid ? Math.min(rawSettlement, due) : 0;
  const waiver = settlementValid ? round2(due - settlement) : 0;

  const scheduleCollectedAfter = round2(
    schedulePaid + Math.min(settlement || 0, installmentRemainingTotal)
  );
  const interestKept = hasInterestInfo
    ? round2(Math.max(0, scheduleCollectedAfter - principal))
    : 0;
  const interestShortfall = round2(Math.max(0, interestPlanned - interestKept));
  let interestVerdict = "none";
  if (hasInterestInfo) {
    interestVerdict = interestKept > 0.005 ? "gain" : "loss";
  }

  const cost = round2(
    (order?.products || []).reduce((s, p) => {
      return s + (Number(p?.cost) || 0) * (Number(p?.quantity) || 0);
    }, 0)
  );
  const collectedBefore = amountPaid;
  const profitBefore = round2(collectedBefore + due - cost);
  const profitAfter = settlementValid
    ? round2(collectedBefore + settlement - cost)
    : profitBefore;
  const totalCollectedAfter = settlementValid
    ? round2(collectedBefore + settlement)
    : collectedBefore;
  let saleVerdict = "even";
  if (profitAfter > 0.005) saleVerdict = "gain";
  else if (profitAfter < -0.005) saleVerdict = "loss";

  return {
    due,
    unpaidCount: unpaid.length,
    installmentRemaining: installmentRemainingTotal,
    settlement,
    waiver,
    principal,
    interestPlanned,
    interestKept,
    interestShortfall,
    interestVerdict,
    amountPaid: collectedBefore,
    totalCollectedAfter,
    cost,
    profitBefore,
    profitAfter,
    saleVerdict,
    valid: settlementValid,
  };
}

/**
 * Close every unpaid installment for a discounted (or full) early settlement.
 * Mutates installment rows. Profit booked on the payment is the signed change
 * so a waiver larger than remaining margin becomes a loss.
 */
export function applyEarlySettlementToInstallments(order, settlementAmount, meta = {}) {
  const preview = previewEarlySettlement(order, settlementAmount);
  if (!preview.valid) {
    return { ...preview, applied: 0, installmentProfit: 0 };
  }

  let totalProfit = ensureInstallmentProfitShares(order);
  const lineProfit = orderLineTradingProfit(order.products);
  if (Math.abs(totalProfit) <= 0.001 && Math.abs(lineProfit) > 0.001) {
    totalProfit = lineProfit;
    if (lineProfit > 0.001) {
      allocateInstallmentProfitShares(order.installments, lineProfit);
      order.installmentTotalProfit = lineProfit;
    }
  }
  const rows = order.installments || [];
  const unpaid = rows
    .filter((r) => installmentRowRemaining(r) > 0.001)
    .sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
  const remainings = unpaid.map((r) => installmentRowRemaining(r));
  const takes = allocateAcross(
    remainings,
    Math.min(preview.settlement, preview.installmentRemaining),
    { capAtWeight: true }
  );

  const trackedAlready = round2(
    (order.payments || []).reduce((s, p) => s + (Number(p?.installmentProfit) || 0), 0)
  );
  const targetProfit = round2(totalProfit - preview.waiver);
  const installmentProfit = round2(targetProfit - trackedAlready);
  const positiveRecognize = round2(Math.max(0, installmentProfit));
  const recognizeWeights = takes.some((t) => t > 0.001) ? takes : remainings;
  const recognizeParts = allocateAcross(recognizeWeights, positiveRecognize);

  const paidAt = meta.paidAt ? new Date(meta.paidAt) : new Date();
  const method = String(meta.paymentMethod || "").trim();
  const uid = meta.paidByUserId || undefined;

  unpaid.forEach((row, i) => {
    const take = takes[i] || 0;
    row.paidAmount = round2((Number(row.paidAmount) || 0) + take);
    row.paid = true;
    row.earlySettlement = true;
    row.paidAt = paidAt;
    if (method) row.paymentMethod = method;
    if (uid) row.paidByUserId = uid;
    const prev = round2(row.recognizedProfit);
    row.recognizedProfit = round2(prev + (recognizeParts[i] || 0));
    row.profitShare = row.recognizedProfit;
    onInstallmentPaymentForPromises(row, { userId: uid, now: paidAt });
  });

  order.installmentTotalProfit = round2(Math.max(0, targetProfit));
  order.earlySettlementClosed = true;
  order.earlySettlementWaiver = round2(
    (Number(order.earlySettlementWaiver) || 0) + preview.waiver
  );
  order.earlySettlementAmount = preview.settlement;
  order.earlySettlementAt = paidAt;

  return {
    ...preview,
    applied: preview.settlement,
    installmentProfit,
  };
}
