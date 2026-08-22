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
    /** For treasury kind: bank vs mobile wallet (optional for cash/settlement). */
    channel: {
      type: String,
      enum: ['bank', 'wallet', ''],
      default: '',
    },
    /** Optional bank account number (when channel=bank). */
    accountNumber: { type: String, trim: true, maxlength: 80, default: '' },
    /** Optional wallet phone number (when channel=wallet). */
    phone: { type: String, trim: true, maxlength: 40, default: '' },
    /** When false, account is inactive in UI pickers (cash stays always enabled). */
    enabled: { type: Boolean, default: true },
  },
  { _id: false }
);

/** Unified payment method catalog (sale / purchase / both + effect + sale-only fee). */
const paymentMethodCatalogEntry = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true, maxlength: 40 },
    label: { type: String, required: true, trim: true, maxlength: 120 },
    /** Where the method appears in pickers. */
    showIn: {
      type: String,
      enum: ['sale', 'purchase', 'both'],
      required: true,
      default: 'sale',
    },
    /** instant → wallet/bank; settlement → app receivable; none → credit (no treasury). */
    effectMode: {
      type: String,
      enum: ['instant', 'settlement', 'none'],
      required: true,
      default: 'instant',
    },
    /** Sale/cashier app surcharge only (ignored for purchase). */
    feePercent: { type: Number, default: 0, min: 0, max: 100 },
  },
  { _id: false }
);

/** Cashier payment method → money account that receives the funds. */
const paymentMethodAccountMapEntry = new mongoose.Schema(
  {
    method: { type: String, required: true, trim: true, maxlength: 40 },
    accountKey: { type: String, required: true, trim: true, maxlength: 40 },
    /** instant | settlement — legacy rows without mode are inferred on read. */
    mode: {
      type: String,
      enum: ['instant', 'settlement'],
      required: false,
    },
    /** Bank/wallet that receives app settlement payout (settlement mode only). */
    settlementBankAccountKey: { type: String, trim: true, maxlength: 40, default: '' },
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
    /**
     * Unified payment methods (visibility + effect + sale fee%).
     * Empty → API migrates from paymentAppFeePercents + purchaseTreasuryMethods + defaults.
     */
    paymentMethodsCatalog: {
      type: [paymentMethodCatalogEntry],
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
    /** Master switch: sell-by-weight categories and cashier weight entry. Default off. */
    weightSalesEnabled: { type: Boolean, default: false },
    /** Master switch: delivery invoices at cashier + delivery staff per branch. Default off. */
    deliveryOrdersEnabled: { type: Boolean, default: false },
    /** Master switch: desk product purchase + exchange at cashier. Default on for existing stores. */
    cashierPurchaseExchangeEnabled: { type: Boolean, default: true },

    /** E-commerce storefront integration (gated by ECOMMERCE_INTEGRATION_FEATURE env). */
    ecommerceIntegrationEnabled: { type: Boolean, default: false },
    /** Base URL of the e-commerce API (e.g. https://shop.example.com). */
    ecommerceBaseUrl: { type: String, default: '', trim: true },
    /** Shared secret for service-to-service calls (header x-integration-key). */
    ecommerceSharedKey: { type: String, default: '', trim: true },
    /** all = every sellable product; online_only = products on Online branch only. */
    ecommerceCatalogMode: {
      type: String,
      enum: ['all', 'online_only'],
      default: 'all',
    },
    /** Branch used when ecommerceCatalogMode is online_only. */
    onlineBranchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch',
      default: null,
    },
  },
  { timestamps: true, collection: 'storesettings' }
);

export default mongoose.model('StoreSettings', storeSettingsSchema);
