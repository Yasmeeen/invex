import mongoose from 'mongoose';

const RECEIPT_LANGS = ['ar', 'en', 'de', 'fr'];

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
  },
  { timestamps: true, collection: 'storesettings' }
);

export default mongoose.model('StoreSettings', storeSettingsSchema);
