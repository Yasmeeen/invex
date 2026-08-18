/** Credit-sale (بيع بالآجل) markup: percent added onto product/invoice price. */

export function roundMoney(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** Sale % stored on the `credit` catalog row (not cashier app-fee percents). */
export function catalogCreditFeePercent(catalog) {
  const row = (Array.isArray(catalog) ? catalog : []).find(
    (r) => String(r?.key || '').trim().toLowerCase() === 'credit'
  );
  const pct = Number(row?.feePercent);
  if (!Number.isFinite(pct) || pct <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round(pct * 100) / 100));
}

export function creditOnAccountAmount(amountDue, paidAmount) {
  return roundMoney(Math.max(0, (Number(amountDue) || 0) - (Number(paidAmount) || 0)));
}

export function creditMarkupAmount(onAccount, percent) {
  const base = roundMoney(onAccount);
  const pct = Number(percent) || 0;
  if (base <= 0 || pct <= 0) return 0;
  return roundMoney(base * (pct / 100));
}

/**
 * Spread `amount` onto unit prices so receipts and returns include the markup.
 * @returns {number} amount actually allocated (may differ by 0.01 rounding)
 */
export function distributeAmountOntoLinePrices(orderProducts, amount) {
  const fee = roundMoney(amount);
  const products = Array.isArray(orderProducts) ? orderProducts : [];
  if (fee <= 0 || !products.length) return 0;

  const lineTotals = products.map((p) =>
    Math.max(0, (Number(p.price) || 0) * (Number(p.quantity) || 0))
  );
  const base = lineTotals.reduce((a, b) => a + b, 0);
  if (base <= 0) return 0;

  let allocated = 0;
  const lastIdx = lineTotals.reduce((acc, w, i) => (w > 0 ? i : acc), -1);
  for (let i = 0; i < products.length; i++) {
    const qty = Number(products[i].quantity) || 0;
    if (qty <= 0 || lineTotals[i] <= 0) continue;
    const share =
      i === lastIdx ? roundMoney(fee - allocated) : roundMoney(fee * (lineTotals[i] / base));
    const extraUnit = roundMoney(share / qty);
    products[i].price = roundMoney((Number(products[i].price) || 0) + extraUnit);
    allocated = roundMoney(allocated + extraUnit * qty);
  }
  return allocated;
}
