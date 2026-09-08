/**
 * Total liabilities to a supplier.
 * `prepaidBalance` is accepted for backward call compatibility but is an asset
 * (money advanced to the supplier), so it must not be counted as a liability.
 */
export function computeTotalCreditOwed(prepaidBalance, purchasePayable, buyerPrepaidBalance = 0) {
  const payable = Math.round((Number(purchasePayable) || 0) * 100) / 100;
  const buyerPrepaid = Math.round((Number(buyerPrepaidBalance) || 0) * 100) / 100;
  return Math.round((payable + buyerPrepaid) * 100) / 100;
}

/** Money/value due from the supplier, including advances paid to them. */
export function computeTotalDebitDue(
  salesReceivable,
  openingDebitBalance,
  supplierPrepaidAsset = 0
) {
  const sales = Math.round((Number(salesReceivable) || 0) * 100) / 100;
  const opening = Math.round((Number(openingDebitBalance) || 0) * 100) / 100;
  const prepaid = Math.round((Number(supplierPrepaidAsset) || 0) * 100) / 100;
  return Math.round((sales + opening + prepaid) * 100) / 100;
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
