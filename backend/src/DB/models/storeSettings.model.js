import mongoose from 'mongoose';

const RECEIPT_LANGS = ['ar', 'en', 'de', 'fr'];

const purchaseTreasuryMethodEntry = new mongoose.Schema(
  {
    /** Lowercase slug: cash, bank_misr, vodafone_cash, … */
    key: { type: String, required: true, trim: true, maxlength: 40 },
    /** Display label (e.g. Arabic) shown in purchase UI & receipts. */
    label: { type: String, required: true, trim: true, maxlength: 120 },
  },
  { _id: false }
);

/** Unified money accounts: cash drawer, bank/wallet treasuries, app settlement receivables. */
const moneyAccountEntry = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true, maxlength: 40 },
    label: { type: String, required: true, trim: true, maxlength: 120 },
    /** cash = drawer; treasury = bank/wallet; settlement = app pending payout (aman/valu/…). */
    kind: {
      type: String,
      enum: ['cash', 'treasury', 'settlement'],
      required: true,
      default: 'treasury',
    },
  },
  { _id: false }
);

/** Cashier payment method → money account that receives the funds. */
const paymentMethodAccountMapEntry = new mongoose.Schema(
  {
    method: { type: String, required: true, trim: true, maxlength: 40 },
    accountKey: { type: String, required: true, trim: true, maxlength: 40 },
  },
  { _id: false }
);

const paymentAppFeePercentEntry = new mongoose.Schema(
  {
    /** Same ids as cashier payment splits (fawry, valu, aman, …). */
    method: { type: String, required: true, trim: true, maxlength: 40 },
    /** Display name in settings (Arabic / custom label). */
    label: { type: String, trim: true, maxlength: 120, default: '' },
    /** Provider surcharge paid by customer on top of invoice net (0–100). */
    percent: { type: Number, default: 0, min: 0, max: 100 },
  },
  { _id: false }
);

const storeSettingsSchema = new mongoose.Schema(
  {
    storeName: { type: String, default: 'Store' },
    storePhoneNumber: { type: String, default: '' },
    logoUrl: { type: String, default: '' },
    /** Language for printed receipts/invoices (not the admin UI language). */
    receiptLanguage: {
      type: String,
      enum: RECEIPT_LANGS,
      default: 'en',
    },
    /**
     * Purchase / exchange desk: where store pays cost from (cash drawer vs bank/wallets).
     * Must include key `cash`. Empty array in DB → API returns seeded defaults.
     */
    purchaseTreasuryMethods: {
      type: [purchaseTreasuryMethodEntry],
      default: [],
    },
    /**
     * All balance-bearing accounts (cash + banks/wallets + settlement apps).
     * Empty → API seeds from purchaseTreasuryMethods + default settlement apps.
     */
    moneyAccounts: {
      type: [moneyAccountEntry],
      default: [],
    },
    /** Cashier payment method → which moneyAccounts.key receives the money. */
    paymentMethodAccountMap: {
      type: [paymentMethodAccountMapEntry],
      default: [],
    },
    /** Cashier: gross → net allocation per payment app (customer pays net × (1 + percent/100)). */
    paymentAppFeePercents: {
      type: [paymentAppFeePercentEntry],
      default: [],
    },
    /** Free-text return & exchange policy (shown on receipt when enabled). */
    returnExchangePolicy: { type: String, default: '', trim: true, maxlength: 2000 },
    /** When true and policy text is set, print it on sale invoices/receipts. */
    showReturnExchangePolicyOnReceipt: { type: Boolean, default: false },
    /** Free-text booking/reservation policy (shown on booking receipt when enabled). */
    bookingPolicy: { type: String, default: '', trim: true, maxlength: 2000 },
    /** When true and policy text is set, print it on booking receipts. */
    showBookingPolicyOnReceipt: { type: Boolean, default: false },
  },
  { timestamps: true, collection: 'storesettings' }
);

export default mongoose.model('StoreSettings', storeSettingsSchema);
