import { roundWeight } from './sale-quantity.util.js';

export const FARM_HEAD_STEP = 0.25;

export function normalizeProductType(raw) {
  const s = String(raw || 'good').trim().toLowerCase();
  if (s === 'service') return 'service';
  if (s === 'farm') return 'farm';
  return 'good';
}

export function isServiceProduct(product) {
  return normalizeProductType(product?.productType) === 'service';
}

export function isFarmProduct(product) {
  if (normalizeProductType(product?.productType) === 'farm') return true;
  const key = String(product?.catalogKey || '');
  if (key.startsWith('farm_')) return true;
  const catCode = String(product?.category?.code || '').toUpperCase();
  return catCode === 'FARM';
}

export function roundFarmHeads(n) {
  const x = Math.round((Number(n) || 0) / FARM_HEAD_STEP) * FARM_HEAD_STEP;
  return Math.round(x * 100) / 100;
}

export function isValidSlaughterShare(share) {
  const n = Number(share);
  return n === 1 || n === 0.5 || n === 0.25;
}

/**
 * Incoming stock for create/update (not cut SKUs).
 * @returns {{ ok: true, stock: number } | { ok: false, error: string }}
 */
export function normalizeIncomingStock({
  stockNum,
  isCutSku,
  isWeightCategory,
  productType,
  isCreate = false,
}) {
  const type = normalizeProductType(productType);
  if (isCutSku) {
    return { ok: true, stock: 0 };
  }
  const n = Number(stockNum);
  if (Number.isNaN(n) || n < 0) {
    return { ok: false, error: 'stock must be a number >= 0' };
  }
  if (type === 'service') {
    return { ok: true, stock: Math.max(0, n) };
  }
  if (type === 'farm') {
    return { ok: true, stock: roundFarmHeads(n) };
  }
  if (isWeightCategory) {
    return { ok: true, stock: roundWeight(n) };
  }
  if (isCreate && n < 1) {
    return { ok: false, error: 'Stock must be at least 1' };
  }
  return { ok: true, stock: Math.max(0, Math.floor(n)) };
}
