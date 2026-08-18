import { PaymentMethodCatalogRow } from '@shared/services/store-settings.service';

export function roundMoney(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** Sale % on the `credit` catalog row (not cashier app-fee percents). */
export function catalogCreditFeePercent(
  catalog: PaymentMethodCatalogRow[] | undefined | null
): number {
  const row = (catalog || []).find(
    (r) => String(r?.key || '').trim().toLowerCase() === 'credit'
  );
  const pct = Number(row?.feePercent);
  if (!Number.isFinite(pct) || pct <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round(pct * 100) / 100));
}

export function creditOnAccountAmount(amountDue: number, paidAmount: number): number {
  return roundMoney(Math.max(0, (Number(amountDue) || 0) - (Number(paidAmount) || 0)));
}

export function creditMarkupAmount(onAccount: number, percent: number): number {
  const base = roundMoney(onAccount);
  const pct = Number(percent) || 0;
  if (base <= 0 || pct <= 0) return 0;
  return roundMoney(base * (pct / 100));
}
