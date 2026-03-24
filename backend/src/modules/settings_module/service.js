import StoreSettings from '../../DB/models/storeSettings.model.js';

const MAX_LOGO_LENGTH = 600000;

export const getStoreSettings = async (req, res) => {
  try {
    let doc = await StoreSettings.findOne();
    if (!doc) {
      doc = await StoreSettings.create({
        storeName: 'Store',
        storePhoneNumber: '',
        logoUrl: '',
      });
    }
    res.status(200).json({
      storeName: doc.storeName,
      storePhoneNumber: doc.storePhoneNumber,
      logoUrl: doc.logoUrl || '',
    });
  } catch (error) {
    console.error('getStoreSettings:', error);
    res.status(500).json({ error: 'Failed to load store settings' });
  }
};

export const updateStoreSettings = async (req, res) => {
  try {
    const { storeName, storePhoneNumber, logoUrl } = req.body;

    if (storeName !== undefined && typeof storeName !== 'string') {
      return res.status(400).json({ error: 'storeName must be a string' });
    }
    if (storePhoneNumber !== undefined && typeof storePhoneNumber !== 'string') {
      return res.status(400).json({ error: 'storePhoneNumber must be a string' });
    }
    if (logoUrl !== undefined && typeof logoUrl !== 'string') {
      return res.status(400).json({ error: 'logoUrl must be a string' });
    }
    if (logoUrl && logoUrl.length > MAX_LOGO_LENGTH) {
      return res.status(400).json({ error: 'Logo image is too large (max ~450KB)' });
    }

    const update = {};
    if (storeName !== undefined) update.storeName = storeName.trim().slice(0, 200);
    if (storePhoneNumber !== undefined) update.storePhoneNumber = storePhoneNumber.trim().slice(0, 50);
    if (logoUrl !== undefined) update.logoUrl = logoUrl;

    const doc = await StoreSettings.findOneAndUpdate(
      {},
      { $set: update },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    res.status(200).json({
      storeName: doc.storeName,
      storePhoneNumber: doc.storePhoneNumber,
      logoUrl: doc.logoUrl || '',
    });
  } catch (error) {
    console.error('updateStoreSettings:', error);
    res.status(500).json({ error: 'Failed to update store settings' });
  }
};
