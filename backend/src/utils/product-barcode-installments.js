import mongoose from 'mongoose';

/**
 * Optional product field: which installment plans are linked for barcode stickers.
 * Returns `undefined` when the field was not sent (skip update).
 */
export function parseBarcodeInstallmentPlans(bodyOrSrc) {
  if (
    !bodyOrSrc ||
    !Object.prototype.hasOwnProperty.call(bodyOrSrc, 'barcodeInstallmentPlans')
  ) {
    return undefined;
  }
  const raw = bodyOrSrc.barcodeInstallmentPlans;
  if (!Array.isArray(raw)) {
    return [];
  }
  const out = [];
  const seen = new Set();
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const planId = String(row.planId || row.plan?._id || '').trim();
    if (!planId || !mongoose.Types.ObjectId.isValid(planId)) continue;
    if (seen.has(planId)) continue;
    seen.add(planId);
    const months = Math.max(1, Math.floor(Number(row.months) || 0));
    if (!Number.isFinite(months) || months < 1) continue;
    const interestRaw = Number(row.interestPercent);
    const interestPercent = Number.isFinite(interestRaw) ? Math.max(0, interestRaw) : 0;
    out.push({
      planId,
      showOnBarcode: !(row.showOnBarcode === false || row.showOnBarcode === 'false' || row.showOnBarcode === 0),
      name: String(row.name || '').trim().slice(0, 120),
      months,
      interestPercent,
    });
  }
  return out;
}
