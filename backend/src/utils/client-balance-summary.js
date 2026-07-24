/** Total credit we owe client = prepaid deposits + deferred desk-purchase payables. */
export function computeTotalClientCreditOwed(prepaidBalance, deferredPayable = 0) {
  const prepaid = Math.round((Number(prepaidBalance) || 0) * 100) / 100;
  const deferred = Math.round((Number(deferredPayable) || 0) * 100) / 100;
  return Math.round((prepaid + deferred) * 100) / 100;
}

/** Build who owes whom: client debit vs credit (prepaid + deferred purchases we owe). */
export function buildClientNetBalanceMessage(debitTotal, creditTotal) {
  const debit = Math.round((Number(debitTotal) || 0) * 100) / 100;
  const credit = Math.round((Number(creditTotal) || 0) * 100) / 100;

  if (debit <= 0 && credit <= 0) {
    return null;
  }

  const net = Math.round((debit - credit) * 100) / 100;
  if (Math.abs(net) < 0.001) {
    return { who: 'even', amount: 0 };
  }
  if (net > 0) {
    return { who: 'client', amount: net };
  }
  return { who: 'store', amount: Math.abs(net) };
}

export function buildClientSettlementPreview(debitTotal, creditTotal) {
  const debit = Math.round((Number(debitTotal) || 0) * 100) / 100;
  const credit = Math.round((Number(creditTotal) || 0) * 100) / 100;
  const settleAmount = Math.round(Math.min(debit, credit) * 100) / 100;

  return {
    debitTotal: debit,
    creditTotal: credit,
    settleAmount,
    afterDebit: Math.round((debit - settleAmount) * 100) / 100,
    afterCredit: Math.round((credit - settleAmount) * 100) / 100,
    netAfter: buildClientNetBalanceMessage(debit - settleAmount, credit - settleAmount),
    canSettle: settleAmount > 0,
  };
}
