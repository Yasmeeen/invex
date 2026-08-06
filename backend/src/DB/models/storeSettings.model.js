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
