import { PaymentAppFeePercent } from '@shared/services/store-settings.service';

export const FEE_PAID_VIA_SAME = 'same';

export interface PaymentSplitLine {
  method: string;
  amount: number;
}

export interface PaymentFeeSource {
  /** Method that generated the fee (e.g. aman). */
  forMethod: string;
  /** `same` | `cash` | another payment method id. */
  paidVia: string;
}

export interface PaymentFeeAllocation {
  forMethod: string;
  feeNet: number;
  paidVia: string;
  feeGrossOnPaidVia: number;
  feePercentSnapshot: number;
}

export interface GrossWithdrawalRow {
  method: string;
  invoiceNet: number;
  feeGross: number;
  totalGross: number;
}

export interface PaymentSplitsResult {
  paymentSplits: PaymentSplitLine[];
  feeAllocations: PaymentFeeAllocation[];
  grossByMethod: Record<string, number>;
  grossWithdrawals: GrossWithdrawalRow[];
}

export function round2(n: number): number {
  return Math.round(Number(n || 0) * 100) / 100;
}

export function paymentAppFeePercent(
  methodId: string | undefined | null,
  fees: PaymentAppFeePercent[] | undefined | null
): number {
  const m = String(methodId || '')
    .trim()
    .toLowerCase();
  const row = (fees || []).find((x) => x.method === m);
  const p = Number(row?.percent);
  return Number.isFinite(p) && p > 0 ? Math.min(p, 100) : 0;
}

/** Fee amount on top of invoice net: net × percent ÷ 100. */
export function feeNetFromInvoiceNet(net: number, percent: number): number {
  const n = Number(net) || 0;
  const pct = Number(percent) || 0;
  if (pct <= 0 || n <= 0) {
    return 0;
  }
  return round2(n * (pct / 100));
}

/** Customer gross when fee is included on same method: net × (1 + percent ÷ 100). */
export function grossFromNet(net: number, percent: number): number {
  const n = Number(net) || 0;
  const pct = Number(percent) || 0;
  if (pct <= 0) {
    return round2(n);
  }
  return round2(n * (1 + pct / 100));
}

/** Gross to withdraw from `paidVia` when paying a fee of `feeNet`. */
export function feeGrossOnPaidVia(
  feeNet: number,
  paidVia: string,
  fees: PaymentAppFeePercent[] | undefined | null
): number {
  const fee = round2(Number(feeNet) || 0);
  if (fee <= 0) {
    return 0;
  }
  const via = String(paidVia || '')
    .trim()
    .toLowerCase();
  if (!via || via === FEE_PAID_VIA_SAME) {
    return fee;
  }
  const pct = paymentAppFeePercent(via, fees);
  return grossFromNet(fee, pct);
}

function resolvePaidViaMethod(forMethod: string, paidVia: string): string {
  const via = String(paidVia || '')
    .trim()
    .toLowerCase();
  if (!via || via === FEE_PAID_VIA_SAME) {
    return String(forMethod || '')
      .trim()
      .toLowerCase();
  }
  return via;
}

/**
 * Builds fee allocations and per-method gross withdrawal summary.
 * `splits` = net invoice amounts per method.
 * `feeSources` = one entry per fee-bearing method with chosen paidVia.
 */
export function buildPaymentSplitsResult(
  splits: PaymentSplitLine[],
  feeSources: PaymentFeeSource[],
  fees: PaymentAppFeePercent[] | undefined | null
): PaymentSplitsResult {
  const normalizedSplits = (splits || [])
    .map((s) => ({
      method: String(s?.method ?? '')
        .trim()
        .toLowerCase(),
      amount: round2(Number(s?.amount) || 0),
    }))
    .filter((s) => s.method && s.amount > 0);

  const feeAllocations: PaymentFeeAllocation[] = [];
  const grossByMethod: Record<string, number> = {};

  for (const split of normalizedSplits) {
    grossByMethod[split.method] = round2((grossByMethod[split.method] || 0) + split.amount);
  }

  const sourceMap = new Map<string, string>();
  for (const src of feeSources || []) {
    const forM = String(src?.forMethod ?? '')
      .trim()
      .toLowerCase();
    if (!forM) {
      continue;
    }
    sourceMap.set(forM, String(src?.paidVia ?? FEE_PAID_VIA_SAME).trim().toLowerCase() || FEE_PAID_VIA_SAME);
  }

  for (const split of normalizedSplits) {
    const pct = paymentAppFeePercent(split.method, fees);
    if (pct <= 0) {
      continue;
    }
    const feeNet = feeNetFromInvoiceNet(split.amount, pct);
    if (feeNet <= 0) {
      continue;
    }
    const paidViaRaw = sourceMap.get(split.method) ?? FEE_PAID_VIA_SAME;
    const paidVia = resolvePaidViaMethod(split.method, paidViaRaw);
    const feeGross = feeGrossOnPaidVia(feeNet, paidViaRaw === FEE_PAID_VIA_SAME ? FEE_PAID_VIA_SAME : paidVia, fees);

    feeAllocations.push({
      forMethod: split.method,
      feeNet,
      paidVia,
      feeGrossOnPaidVia: feeGross,
      feePercentSnapshot: pct,
    });

    if (paidViaRaw === FEE_PAID_VIA_SAME) {
      grossByMethod[split.method] = round2((grossByMethod[split.method] || 0) + feeNet);
    } else {
      grossByMethod[paidVia] = round2((grossByMethod[paidVia] || 0) + feeGross);
    }
  }

  const grossWithdrawals: GrossWithdrawalRow[] = Object.keys(grossByMethod)
    .sort()
    .map((method) => {
      const invoiceNet = round2(
        normalizedSplits.filter((s) => s.method === method).reduce((a, s) => a + s.amount, 0)
      );
      const feeGross = round2(grossByMethod[method] - invoiceNet);
      return {
        method,
        invoiceNet,
        feeGross: feeGross > 0 ? feeGross : 0,
        totalGross: round2(grossByMethod[method]),
      };
    })
    .filter((r) => r.totalGross > 0);

  return {
    paymentSplits: normalizedSplits,
    feeAllocations,
    grossByMethod,
    grossWithdrawals,
  };
}

export function paymentSplitsNetTotal(splits: PaymentSplitLine[]): number {
  return round2((splits || []).reduce((acc, s) => acc + (Number(s.amount) || 0), 0));
}

export function methodsWithFees(
  splits: PaymentSplitLine[],
  fees: PaymentAppFeePercent[] | undefined | null
): string[] {
  return (splits || [])
    .map((s) =>
      String(s?.method ?? '')
        .trim()
        .toLowerCase()
    )
    .filter((m, i, arr) => m && arr.indexOf(m) === i && paymentAppFeePercent(m, fees) > 0);
}

export function defaultFeeSources(
  splits: PaymentSplitLine[],
  fees: PaymentAppFeePercent[] | undefined | null
): PaymentFeeSource[] {
  return methodsWithFees(splits, fees).map((forMethod) => ({
    forMethod,
    paidVia: FEE_PAID_VIA_SAME,
  }));
}
