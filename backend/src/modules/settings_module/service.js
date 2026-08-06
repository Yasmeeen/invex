import StoreSettings from '../../DB/models/storeSettings.model.js';
import { normalizePaymentAppFeePercents } from './paymentAppFees.js';
import { normalizePurchaseTreasuryMethods } from './treasuryMethods.js';
import { isEcommerceIntegrationFeatureAvailable } from '../integrations_module/feature.js';
import { ensureOnlineBranch } from '../integrations_module/onlineBranch.js';
import { pushFullCatalog } from '../integrations_module/catalogSync.js';

const MAX_LOGO_LENGTH = 600000;

/** One logical row: always read/update the same document (avoids split brain if multiple rows exist). */
const getLatestSettingsDoc = () =>
  StoreSettings.findOne().sort({ updatedAt: -1 });

function serializeSettings(doc) {
  const featureAvailable = isEcommerceIntegrationFeatureAvailable();
  return {
    storeName: doc.storeName,
    storePhoneNumber: doc.storePhoneNumber,
    logoUrl: doc.logoUrl || '',
    receiptLanguage: doc.receiptLanguage || 'en',
    purchaseTreasuryMethods: normalizePurchaseTreasuryMethods(doc.purchaseTreasuryMethods),
    paymentAppFeePercents: normalizePaymentAppFeePercents(doc.paymentAppFeePercents),
    returnExchangePolicy: doc.returnExchangePolicy || '',
    showReturnExchangePolicyOnReceipt: Boolean(doc.showReturnExchangePolicyOnReceipt),
    bookingPolicy: doc.bookingPolicy || '',
    showBookingPolicyOnReceipt: Boolean(doc.showBookingPolicyOnReceipt),
    ecommerceIntegrationFeatureAvailable: featureAvailable,
    ecommerceIntegrationEnabled: featureAvailable && Boolean(doc.ecommerceIntegrationEnabled),
    ecommerceBaseUrl: featureAvailable ? doc.ecommerceBaseUrl || '' : '',
    ecommerceSharedKey: featureAvailable ? doc.ecommerceSharedKey || '' : '',
    ecommerceCatalogMode:
      featureAvailable && doc.ecommerceCatalogMode === 'online_only' ? 'online_only' : 'all',
    onlineBranchId: featureAvailable && doc.onlineBranchId ? String(doc.onlineBranchId) : null,
  };
}

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
    res.status(200).json(serializeSettings(doc));
  } catch (error) {
    console.error('getStoreSettings:', error);
    res.status(500).json({ error: 'Failed to load store settings' });
  }
};

export const updateStoreSettings = async (req, res) => {
  try {
    const {
      storeName,
      storePhoneNumber,
      logoUrl,
      receiptLanguage,
      purchaseTreasuryMethods,
      paymentAppFeePercents,
      returnExchangePolicy,
      showReturnExchangePolicyOnReceipt,
      bookingPolicy,
      showBookingPolicyOnReceipt,
      ecommerceIntegrationEnabled,
      ecommerceBaseUrl,
      ecommerceSharedKey,
      ecommerceCatalogMode,
    } = req.body;

    const ALLOWED_RECEIPT_LANGS = ['ar', 'en', 'de', 'fr'];
    const featureAvailable = isEcommerceIntegrationFeatureAvailable();

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

    let treasuryNormalized;
    if (purchaseTreasuryMethods !== undefined) {
      if (!Array.isArray(purchaseTreasuryMethods)) {
        return res.status(400).json({ error: 'purchaseTreasuryMethods must be an array' });
      }
      if (purchaseTreasuryMethods.length > 40) {
        return res.status(400).json({ error: 'Too many purchase treasury methods (max 40)' });
      }
      treasuryNormalized = normalizePurchaseTreasuryMethods(purchaseTreasuryMethods);
      if (!treasuryNormalized.some((x) => x.key === 'cash')) {
        return res.status(400).json({ error: 'purchaseTreasuryMethods must include key "cash"' });
      }
    }

    let feesNormalized;
    if (paymentAppFeePercents !== undefined) {
      if (!Array.isArray(paymentAppFeePercents)) {
        return res.status(400).json({ error: 'paymentAppFeePercents must be an array' });
      }
      if (paymentAppFeePercents.length > 40) {
        return res.status(400).json({ error: 'Too many payment app fee rows (max 40)' });
      }
      feesNormalized = normalizePaymentAppFeePercents(paymentAppFeePercents);
    }

    if (returnExchangePolicy !== undefined && typeof returnExchangePolicy !== 'string') {
      return res.status(400).json({ error: 'returnExchangePolicy must be a string' });
    }
    if (
      showReturnExchangePolicyOnReceipt !== undefined &&
      typeof showReturnExchangePolicyOnReceipt !== 'boolean'
    ) {
      return res.status(400).json({ error: 'showReturnExchangePolicyOnReceipt must be a boolean' });
    }
    if (bookingPolicy !== undefined && typeof bookingPolicy !== 'string') {
      return res.status(400).json({ error: 'bookingPolicy must be a string' });
    }
    if (
      showBookingPolicyOnReceipt !== undefined &&
      typeof showBookingPolicyOnReceipt !== 'boolean'
    ) {
      return res.status(400).json({ error: 'showBookingPolicyOnReceipt must be a boolean' });
    }

    const update = {};
    if (storeName !== undefined) update.storeName = storeName.trim().slice(0, 200);
    if (storePhoneNumber !== undefined) update.storePhoneNumber = storePhoneNumber.trim().slice(0, 50);
    if (logoUrl !== undefined) update.logoUrl = logoUrl;
    if (receiptLanguage !== undefined) update.receiptLanguage = receiptLangNormalized;
    if (treasuryNormalized !== undefined) update.purchaseTreasuryMethods = treasuryNormalized;
    if (feesNormalized !== undefined) update.paymentAppFeePercents = feesNormalized;
    if (returnExchangePolicy !== undefined) {
      update.returnExchangePolicy = returnExchangePolicy.trim().slice(0, 2000);
    }
    if (showReturnExchangePolicyOnReceipt !== undefined) {
      update.showReturnExchangePolicyOnReceipt = showReturnExchangePolicyOnReceipt;
    }
    if (bookingPolicy !== undefined) {
      update.bookingPolicy = bookingPolicy.trim().slice(0, 2000);
    }
    if (showBookingPolicyOnReceipt !== undefined) {
      update.showBookingPolicyOnReceipt = showBookingPolicyOnReceipt;
    }

    let shouldPushCatalog = false;
    if (featureAvailable) {
      if (ecommerceIntegrationEnabled !== undefined) {
        update.ecommerceIntegrationEnabled = ecommerceIntegrationEnabled === true;
        shouldPushCatalog = update.ecommerceIntegrationEnabled;
      }
      if (ecommerceBaseUrl !== undefined) {
        update.ecommerceBaseUrl = String(ecommerceBaseUrl || '')
          .trim()
          .replace(/\/$/, '')
          .slice(0, 500);
      }
      if (ecommerceSharedKey !== undefined) {
        update.ecommerceSharedKey = String(ecommerceSharedKey || '').trim().slice(0, 200);
      }
      if (ecommerceCatalogMode !== undefined) {
        update.ecommerceCatalogMode =
          ecommerceCatalogMode === 'online_only' ? 'online_only' : 'all';
        shouldPushCatalog = true;
      }
    }

    const existing = await getLatestSettingsDoc();
    const filter = existing ? { _id: existing._id } : {};

    let doc = await StoreSettings.findOneAndUpdate(
      filter,
      { $set: update },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
        runValidators: true,
      }
    );

    if (
      featureAvailable &&
      doc.ecommerceIntegrationEnabled &&
      doc.ecommerceCatalogMode === 'online_only'
    ) {
      const online = await ensureOnlineBranch();
      if (String(doc.onlineBranchId || '') !== String(online._id)) {
        doc.onlineBranchId = online._id;
        await doc.save();
      }
    }

    if (shouldPushCatalog && doc.ecommerceIntegrationEnabled) {
      setImmediate(() => {
        pushFullCatalog().catch((err) =>
          console.error('[settings] push catalog after save', err.message)
        );
      });
    }

    res.status(200).json(serializeSettings(doc));
  } catch (error) {
    console.error('updateStoreSettings:', error);
    res.status(500).json({ error: 'Failed to update store settings' });
  }
};
