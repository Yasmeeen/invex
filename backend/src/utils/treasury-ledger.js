/**
 * No-op stub: treasury accounts / ledger feature lives on branch `feature/treasury-accounts`.
 * Call sites stay import-compatible so the rest of the app can ship without the feature.
 */

export function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

export function businessDateStr() {
  return new Date().toISOString().slice(0, 10);
}

export async function resolveAccountKeyForPaymentMethod() {
  return null;
}

export async function recordTreasuryLedgerEntry() {
  return { skipped: true };
}

export async function recordTreasuryTransfer() {
  return { error: 'Treasury accounts feature disabled on this branch' };
}

export async function postPaymentMethodOutflows() {
  return { skipped: true };
}

export async function postPaymentMethodInflows() {
  return { skipped: true };
}

export async function postTreasurySplitOutflows() {
  return { skipped: true };
}

export async function postTreasurySplitInflows() {
  return { skipped: true };
}

export async function getOpeningBalance() {
  return 0;
}

export async function sumLedgerNet() {
  return 0;
}

export async function computeAccountExpectedBalance() {
  return {
    openingBalance: 0,
    inTotal: 0,
    outTotal: 0,
    periodNet: 0,
    expectedBalance: 0,
  };
}

export async function sumCashTransferNet() {
  return 0;
}

export async function safeTreasuryPost(_label, fn) {
  try {
    if (typeof fn === 'function') await fn();
  } catch {
    // ignore — feature disabled
  }
}

export async function postOrderPaymentLinesToLedger() {
  return { skipped: true };
}

export async function postRefundPaymentLinesToLedger() {
  return { skipped: true };
}
