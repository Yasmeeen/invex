/**
 * DailyExpense rows created for cash-drawer / treasury tracking only.
 * Not operating costs — excluded from profit report "daily expenses".
 */
export const NON_OPERATING_DAILY_EXPENSE_TYPES = [
  'client_prepaid_payout',
  'desk_purchase_deferred_paid',
  'exchange_settlement_paid',
];

/** List / profit filters: operating | cash_movements | all */
export function dailyExpenseCategoryMatch(category) {
  const c = String(category || 'operating').trim().toLowerCase();
  if (c === 'all') return {};
  if (c === 'cash_movements' || c === 'cash' || c === 'movements') {
    return { expenseType: { $in: NON_OPERATING_DAILY_EXPENSE_TYPES } };
  }
  // default: operating expenses only (manual + any non-system type)
  return { expenseType: { $nin: NON_OPERATING_DAILY_EXPENSE_TYPES } };
}
