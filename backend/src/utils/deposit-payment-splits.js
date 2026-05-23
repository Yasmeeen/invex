function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

/** Physical cash in drawer only — literal cash payments. */
export function isPhysicalCashMethod(m) {
  return String(m ?? '')
    .trim()
    .toLowerCase() === 'cash';
}

export function normalizePaymentSplitsRaw(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((s) => ({
      method: String(s?.method ?? s?.key ?? '')
        .trim()
        .toLowerCase(),
      amount: round2(Number(s?.amount) || 0),
    }))
    .filter((s) => s.method && s.method !== 'credit' && Number.isFinite(s.amount) && s.amount > 0);
}

export function normalizePaymentFeeAllocations(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => ({
      forMethod: String(row?.forMethod ?? '')
        .trim()
        .toLowerCase(),
      feeNet: round2(Number(row?.feeNet) || 0),
      paidVia: String(row?.paidVia ?? '')
        .trim()
        .toLowerCase(),
      feeGrossOnPaidVia: round2(Number(row?.feeGrossOnPaidVia) || 0),
      feePercentSnapshot: round2(Number(row?.feePercentSnapshot) || 0),
    }))
    .filter((r) => r.forMethod && r.feeNet > 0 && r.paidVia);
}

export function totalNetFromPaymentSplits(splits) {
  return round2((splits || []).reduce((acc, s) => acc + (Number(s.amount) || 0), 0));
}

/** Cash that enters or leaves the physical drawer for a deposit payment. */
export function cashAmountFromPaymentSplits(splits, feeAllocations) {
  let cash = 0;
  for (const s of splits || []) {
    if (isPhysicalCashMethod(s.method)) {
      cash += Number(s.amount) || 0;
    }
  }
  for (const fee of feeAllocations || []) {
    if (isPhysicalCashMethod(fee.paidVia)) {
      cash += Number(fee.feeGrossOnPaidVia) || Number(fee.feeNet) || 0;
    }
  }
  return round2(cash);
}

/** Audit breakdown stored on drawer payment / receipt documents. */
export function buildTreasurySplitsFromPayment(splits, feeAllocations) {
  const rows = (splits || []).map((s) => ({
    key: s.method,
    label: String(s.method || '').trim(),
    amount: round2(s.amount),
  }));

  for (const fee of feeAllocations || []) {
    if (fee.feeNet <= 0) continue;
    const via =
      !fee.paidVia || fee.paidVia === fee.forMethod || fee.paidVia === 'same'
        ? fee.forMethod
        : fee.paidVia;
    rows.push({
      key: via,
      label: `fee:${fee.forMethod}`,
      amount: round2(fee.feeGrossOnPaidVia || fee.feeNet),
    });
  }

  return rows.filter((r) => r.key && r.amount > 0);
}
