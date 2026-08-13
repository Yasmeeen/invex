import StoreSettings from '../../DB/models/storeSettings.model.js';

export async function getOrCreateStoreSettings() {
  let doc = await StoreSettings.findOne().sort({ updatedAt: -1 });
  if (!doc) {
    doc = await StoreSettings.create({
      storeName: 'Store',
      storePhoneNumber: '',
      logoUrl: '',
      receiptLanguage: 'en',
    });
  }
  return doc;
}

export async function patchStoreSettings(doc, update) {
  const filter = doc?._id ? { _id: doc._id } : {};
  return StoreSettings.findOneAndUpdate(filter, { $set: update }, {
    new: true,
    upsert: true,
    setDefaultsOnInsert: true,
    runValidators: true,
  });
}
