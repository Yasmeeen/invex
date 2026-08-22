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
export function buildSaleInstallmentSchedule({
  principal,
  interestPercent,
  months,
  startDate,
}) {
  const m = Math.max(1, Math.floor(Number(months) || 1));
  const p = Math.round((Number(principal) || 0) * 100) / 100;
  const rate = Math.max(0, Number(interestPercent) || 0) / 100;
  const interestAmount = Math.round(p * rate * 100) / 100;
  const totalDue = Math.round((p + interestAmount) * 100) / 100;
  const base = Math.floor((totalDue / m) * 100) / 100;
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
      i === m - 1
        ? Math.round((totalDue - allocated) * 100) / 100
        : base;
    allocated = Math.round((allocated + amount) * 100) / 100;
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

  return {
    principal: p,
    interestAmount,
    totalDue,
    installments: rows,
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
