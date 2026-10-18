/** Keep in sync with backend/src/utils/sale-installments.js previewEarlySettlement. */

export type EarlySettlementInterestVerdict = 'gain' | 'loss' | 'none';
export type EarlySettlementSaleVerdict = 'gain' | 'loss' | 'even';

export interface EarlySettlementPreviewInput {
  totalPrice?: number;
  amountPaid?: number;
  installmentPrincipal?: number;
  installmentInterestAmount?: number;
  installmentSurchargeAmount?: number;
  installmentDiscountAmount?: number;
  products?: Array<{ cost?: number; quantity?: number }>;
  installments?: Array<{
    amount?: number;
    paid?: boolean;
    paidAmount?: number;
  }>;
}

export interface EarlySettlementPreview {
  due: number;
  unpaidCount: number;
  installmentRemaining: number;
  settlement: number;
  waiver: number;
  principal: number;
  interestPlanned: number;
  interestKept: number;
  interestShortfall: number;
  interestVerdict: EarlySettlementInterestVerdict;
  /** Cash already collected on the order (down payment + prior installments). */
  amountPaid: number;
  /** amountPaid + settlement after a valid early settlement. */
  totalCollectedAfter: number;
  cost: number;
  profitBefore: number;
  profitAfter: number;
  saleVerdict: EarlySettlementSaleVerdict;
  valid: boolean;
}

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function rowRemaining(row: { paid?: boolean; amount?: number; paidAmount?: number }): number {
  if (row?.paid) return 0;
  return Math.max(0, round2((Number(row?.amount) || 0) - (Number(row?.paidAmount) || 0)));
}

export function previewEarlySettlement(
  order: EarlySettlementPreviewInput | null | undefined,
  settlementAmount: number
): EarlySettlementPreview {
  const rows = order?.installments || [];
  const unpaid = rows.filter((r) => rowRemaining(r) > 0.001);
  const installmentRemainingTotal = round2(unpaid.reduce((s, r) => s + rowRemaining(r), 0));
  const scheduleTotal = round2(rows.reduce((s, r) => s + round2(Number(r.amount) || 0), 0));
  const schedulePaid = round2(rows.reduce((s, r) => s + round2(Number(r.paidAmount) || 0), 0));
  const principal = round2(Number(order?.installmentPrincipal) || 0);
  const interestFromFields = round2(
    (Number(order?.installmentInterestAmount) || 0) +
      (Number(order?.installmentSurchargeAmount) || 0) -
      (Number(order?.installmentDiscountAmount) || 0)
  );
  const hasInterestInfo =
    interestFromFields > 0.001 || (principal > 0.001 && scheduleTotal > principal + 0.001);
  const interestPlanned = !hasInterestInfo
    ? 0
    : interestFromFields > 0.001
      ? interestFromFields
      : round2(scheduleTotal - principal);

  const amountPaid = round2(Number(order?.amountPaid) || 0);
  const totalPrice = round2(Number(order?.totalPrice) || 0);
  const invoiceRemaining = round2(Math.max(0, totalPrice - amountPaid));
  const due = invoiceRemaining > 0.001 ? invoiceRemaining : installmentRemainingTotal;

  const rawSettlement = round2(settlementAmount);
  const settlementValid =
    Number.isFinite(rawSettlement) &&
    rawSettlement > 0.001 &&
    rawSettlement <= due + 0.001 &&
    due > 0.001;
  const settlement = settlementValid ? Math.min(rawSettlement, due) : 0;
  const waiver = settlementValid ? round2(due - settlement) : 0;

  const scheduleCollectedAfter = round2(
    schedulePaid + Math.min(settlement || 0, installmentRemainingTotal)
  );
  const interestKept = hasInterestInfo
    ? round2(Math.max(0, scheduleCollectedAfter - principal))
    : 0;
  const interestShortfall = round2(Math.max(0, interestPlanned - interestKept));
  let interestVerdict: EarlySettlementInterestVerdict = 'none';
  if (hasInterestInfo) {
    interestVerdict = interestKept > 0.005 ? 'gain' : 'loss';
  }

  const cost = round2(
    (order?.products || []).reduce(
      (s, p) => s + (Number(p?.cost) || 0) * (Number(p?.quantity) || 0),
      0
    )
  );
  const profitBefore = round2(amountPaid + due - cost);
  const profitAfter = settlementValid ? round2(amountPaid + settlement - cost) : profitBefore;
  const totalCollectedAfter = settlementValid
    ? round2(amountPaid + settlement)
    : amountPaid;
  let saleVerdict: EarlySettlementSaleVerdict = 'even';
  if (profitAfter > 0.005) saleVerdict = 'gain';
  else if (profitAfter < -0.005) saleVerdict = 'loss';

  return {
    due,
    unpaidCount: unpaid.length,
    installmentRemaining: installmentRemainingTotal,
    settlement,
    waiver,
    principal,
    interestPlanned,
    interestKept,
    interestShortfall,
    interestVerdict,
    amountPaid,
    totalCollectedAfter,
    cost,
    profitBefore,
    profitAfter,
    saleVerdict,
    valid: settlementValid,
  };
}
