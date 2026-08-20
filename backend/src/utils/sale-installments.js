/**
 * Build equal monthly installment schedule for a customer sale.
 * Last installment absorbs rounding remainder so sum === totalDue.
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

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
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
 * If installmentId is set, prefer that row first, then FIFO by sequence.
 */
export function applyPaymentToInstallments(installments, appliedAmount, meta = {}) {
  let left = round2(appliedAmount);
  if (left <= 0 || !Array.isArray(installments) || !installments.length) {
    return { applied: 0, remainingInstallments: countUnpaidInstallments(installments) };
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
  for (const { row } of orderIdx) {
    if (left <= 0) break;
    const rem = installmentRemaining(row);
    const take = Math.min(rem, left);
    row.paidAmount = round2((Number(row.paidAmount) || 0) + take);
    if (row.paidAmount >= round2(row.amount) - 0.001) {
      row.paid = true;
      row.paidAmount = round2(row.amount);
    } else {
      row.paid = false;
    }
    row.paidAt = paidAt;
    if (method) row.paymentMethod = method;
    if (uid) row.paidByUserId = uid;
    if (row.promiseToPayAt) row.promiseToPayAt = undefined;
    left = round2(left - take);
    applied = round2(applied + take);
  }

  return {
    applied,
    remainingInstallments: countUnpaidInstallments(installments),
  };
}
