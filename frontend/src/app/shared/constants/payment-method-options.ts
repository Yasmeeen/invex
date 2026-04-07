/** IDs must match `paymentMethod` stored on orders (same as cashier). */
export interface PaymentMethodOption {
  id: string;
  labelKey: string;
}

export const PAYMENT_METHOD_OPTIONS: PaymentMethodOption[] = [
  { id: 'cash', labelKey: 'tr_pay_cash' },
  { id: 'credit', labelKey: 'tr_pay_credit' },
  { id: 'visa', labelKey: 'tr_pay_visa' },
  { id: 'mastercard', labelKey: 'tr_pay_mastercard' },
  { id: 'meeza', labelKey: 'tr_pay_meeza' },
  { id: 'valu', labelKey: 'tr_pay_valu' },
  { id: 'aman', labelKey: 'tr_pay_aman' },
  { id: 'halan', labelKey: 'tr_pay_halan' },
  { id: 'tru', labelKey: 'tr_pay_tru' },
  { id: 'sohoula', labelKey: 'tr_pay_sohoula' },
  { id: 'maylo_seven', labelKey: 'tr_pay_maylo_seven' },
  { id: 'fawry', labelKey: 'tr_pay_fawry' },
  { id: 'vodafone_cash', labelKey: 'tr_pay_vodafone_cash' },
  { id: 'instapay', labelKey: 'tr_pay_instapay' },
];
