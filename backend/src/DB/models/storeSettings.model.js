import mongoose from 'mongoose';

const storeSettingsSchema = new mongoose.Schema(
  {
    storeName: { type: String, default: 'Store' },
    storePhoneNumber: { type: String, default: '' },
    logoUrl: { type: String, default: '' },
  },
  { timestamps: true, collection: 'storesettings' }
);

export default mongoose.model('StoreSettings', storeSettingsSchema);
