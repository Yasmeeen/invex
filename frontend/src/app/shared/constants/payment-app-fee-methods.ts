/**
 * Default payment method ids (cashier). Settings may add custom methods;
 * fee % is matched by `method` id — custom rows need the same id as in cashier splits.
 */
export const PAYMENT_APP_FEE_METHOD_IDS = [
  'visa',
  'mastercard',
  'meeza',
  'valu',
  'aman',
  'halan',
  'tru',
  'sohoula',
  'maylo_seven',
  'fawry',
  'vodafone_cash',
  'instapay',
  'forsa',
] as const;
