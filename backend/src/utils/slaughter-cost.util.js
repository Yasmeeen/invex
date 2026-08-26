import { roundWeight } from './sale-quantity.util.js';

/** Money to 2 decimals (EGP-style). */
export function roundMoney(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * Weighted-average unit cost when adding stock.
 * (oldStock * oldCost + addQty * addUnitCost) / (oldStock + addQty)
 */
export function weightedAverageUnitCost(oldStock, oldUnitCost, addQty, addUnitCost) {
  const prev = Math.max(0, Number(oldStock) || 0);
  const add = Math.max(0, Number(addQty) || 0);
  if (add <= 0) return roundMoney(oldUnitCost);
  if (prev <= 0) return roundMoney(addUnitCost);
  const total = prev + add;
  if (total <= 0) return roundMoney(addUnitCost);
  return roundMoney((prev * Number(oldUnitCost || 0) + add * Number(addUnitCost || 0)) / total);
}

/**
 * Farm animal share cost and cost per useful kg from slaughter outputs.
 * Waste kind lines do not absorb animal cost (cost stays on fridge/offal).
 */
export function allocateSlaughterCost({ farmNetPricePerHead, share, outputLines }) {
  const farmCostTotal = roundMoney(Math.max(0, Number(farmNetPricePerHead) || 0) * Number(share || 0));
  const usefulKg = roundWeight(
    (outputLines || [])
      .filter((l) => l.kind !== 'waste')
      .reduce((s, l) => s + (Number(l.quantity) || 0), 0)
  );
  const allocKg =
    usefulKg > 0
      ? usefulKg
      : roundWeight((outputLines || []).reduce((s, l) => s + (Number(l.quantity) || 0), 0));
  const costPerKg = allocKg > 0 ? roundMoney(farmCostTotal / allocKg) : 0;
  return { farmCostTotal, usefulKg: allocKg, costPerKg };
}

/** Sale COGS for a cut SKU when stock comes from fridge/source. */
export function resolveCutSaleUnitCost(sourceNetPrice, processingExtraCost = 0) {
  return roundMoney(Math.max(0, Number(sourceNetPrice) || 0) + Math.max(0, Number(processingExtraCost) || 0));
}
