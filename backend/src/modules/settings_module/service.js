import StoreSettings from '../../DB/models/storeSettings.model.js';

const MAX_LOGO_LENGTH = 600000;

/** One logical row: always read/update the same document (avoids split brain if multiple rows exist). */
const getLatestSettingsDoc = () =>
  StoreSettings.findOne().sort({ updatedAt: -1 });

export const getStoreSettings = async (req, res) => {
  try {
    let doc = await getLatestSettingsDoc();
    if (!doc) {
      doc = await StoreSettings.create({
        storeName: 'Store',
        storePhoneNumber: '',
        logoUrl: '',
        receiptLanguage: 'en',
      });
    }
    res.status(200).json({
      storeName: doc.storeName,
      storePhoneNumber: doc.storePhoneNumber,
      logoUrl: doc.logoUrl || '',
      receiptLanguage: doc.receiptLanguage || 'en',
    });
  } catch (error) {
    console.error('getStoreSettings:', error);
    res.status(500).json({ error: 'Failed to load store settings' });
  }
};

export const updateStoreSettings = async (req, res) => {
  try {
    const { storeName, storePhoneNumber, logoUrl, receiptLanguage } = req.body;

    const ALLOWED_RECEIPT_LANGS = ['ar', 'en', 'de', 'fr'];

    if (storeName !== undefined && typeof storeName !== 'string') {
      return res.status(400).json({ error: 'storeName must be a string' });
    }
    if (storePhoneNumber !== undefined && typeof storePhoneNumber !== 'string') {
      return res.status(400).json({ error: 'storePhoneNumber must be a string' });
    }
    if (logoUrl !== undefined && typeof logoUrl !== 'string') {
      return res.status(400).json({ error: 'logoUrl must be a string' });
    }
    let receiptLangNormalized;
    if (receiptLanguage !== undefined) {
      if (typeof receiptLanguage !== 'string') {
        return res.status(400).json({ error: 'receiptLanguage must be a string' });
      }
      receiptLangNormalized = receiptLanguage.trim().toLowerCase();
      if (!ALLOWED_RECEIPT_LANGS.includes(receiptLangNormalized)) {
        return res.status(400).json({ error: 'receiptLanguage must be one of: ar, en, de, fr' });
      }
    }
    if (logoUrl && logoUrl.length > MAX_LOGO_LENGTH) {
      return res.status(400).json({ error: 'Logo image is too large (max ~450KB)' });
    }

    const update = {};
    if (storeName !== undefined) update.storeName = storeName.trim().slice(0, 200);
    if (storePhoneNumber !== undefined) update.storePhoneNumber = storePhoneNumber.trim().slice(0, 50);
    if (logoUrl !== undefined) update.logoUrl = logoUrl;
    if (receiptLanguage !== undefined) update.receiptLanguage = receiptLangNormalized;

    const existing = await getLatestSettingsDoc();
    const filter = existing ? { _id: existing._id } : {};

    const doc = await StoreSettings.findOneAndUpdate(
      filter,
      { $set: update },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
        runValidators: true,
      }
    );

    res.status(200).json({
      storeName: doc.storeName,
      storePhoneNumber: doc.storePhoneNumber,
      logoUrl: doc.logoUrl || '',
      receiptLanguage: doc.receiptLanguage || 'en',
    });
  } catch (error) {
    console.error('updateStoreSettings:', error);
    res.status(500).json({ error: 'Failed to update store settings' });
  }
};
