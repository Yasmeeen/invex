/**
 * Payment methods that may carry a BNPL / wallet provider surcharge.
 * Must stay in sync with backend `paymentAppFees.js` ALLOWED_METHODS.
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
