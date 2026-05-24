/** Total credit = our prepaid to supplier + purchase payables + supplier prepaid with us (buyer). */
export function computeTotalCreditOwed(prepaidBalance, purchasePayable, buyerPrepaidBalance = 0) {
  const prepaid = Math.round((Number(prepaidBalance) || 0) * 100) / 100;
  const payable = Math.round((Number(purchasePayable) || 0) * 100) / 100;
  const buyerPrepaid = Math.round((Number(buyerPrepaidBalance) || 0) * 100) / 100;
  return Math.round((prepaid + payable + buyerPrepaid) * 100) / 100;
}

/** Build who owes whom after comparing debit (supplier owes us) vs credit (we owe supplier). */
export function buildNetBalanceMessage(debitTotal, creditTotal) {
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
    return { who: 'supplier', amount: net };
  }
  return { who: 'store', amount: Math.abs(net) };
}

export function buildSettlementPreview(debitTotal, creditTotal) {
  const debit = Math.round((Number(debitTotal) || 0) * 100) / 100;
  const credit = Math.round((Number(creditTotal) || 0) * 100) / 100;
  const settleAmount = Math.round(Math.min(debit, credit) * 100) / 100;

  return {
    debitTotal: debit,
    creditTotal: credit,
    settleAmount,
    afterDebit: Math.round((debit - settleAmount) * 100) / 100,
    afterCredit: Math.round((credit - settleAmount) * 100) / 100,
    netAfter: buildNetBalanceMessage(debit - settleAmount, credit - settleAmount),
    canSettle: settleAmount > 0,
  };
}
