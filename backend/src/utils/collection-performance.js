function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * Collector performance credit for one installment.
 * When the sale has a minimum collection below the installment amount, that
 * minimum is the target. Collecting at least the minimum fully meets the
 * target, so the unpaid remainder does not lower the rate. Cash above the
 * minimum does not push this installment above 100%.
 * With no minimum, target is the installment amount and collected is the
 * paid amount (same as the previous rate).
 */
export function installmentPerformanceCredit(amount, paidAmount, minimumCollection) {
  const full = round2(Math.max(0, Number(amount) || 0));
  const paid = round2(Math.max(0, Number(paidAmount) || 0));
  const minimum = round2(Math.max(0, Number(minimumCollection) || 0));
  const eased = minimum > 0.001 && full > 0.001 && minimum < full - 0.001;
  if (!eased) {
    return { target: full, collected: paid, eased: false };
  }
  return {
    target: minimum,
    collected: round2(Math.min(paid, minimum)),
    eased: true,
  };
}
