import StoreSettings from '../../DB/models/storeSettings.model.js';
import { normalizePaymentAppFeePercents } from './paymentAppFees.js';
import { normalizePurchaseTreasuryMethods } from './treasuryMethods.js';
import {
  moneyAccountsToPurchaseTreasuries,
  normalizeMoneyAccounts,
  normalizePaymentMethodAccountMap,
} from './moneyAccounts.js';

const MAX_LOGO_LENGTH = 600000;

/** One logical row: always read/update the same document (avoids split brain if multiple rows exist). */
const getLatestSettingsDoc = () => StoreSettings.findOne().sort({ updatedAt: -1 });

function serializeSettings(doc) {
  const moneyAccounts = normalizeMoneyAccounts({
    purchaseTreasuryMethods: doc.purchaseTreasuryMethods,
    moneyAccounts: doc.moneyAccounts,
  });
  const accountKeys = new Set(moneyAccounts.map((a) => a.key));
  const paymentMethodAccountMap = normalizePaymentMethodAccountMap(
    doc.paymentMethodAccountMap,
    accountKeys
  );
  return {
    storeName: doc.storeName,
    storePhoneNumber: doc.storePhoneNumber,
    logoUrl: doc.logoUrl || '',
    receiptLanguage: doc.receiptLanguage || 'en',
    purchaseTreasuryMethods: moneyAccountsToPurchaseTreasuries(moneyAccounts),
    moneyAccounts,
    paymentMethodAccountMap,
    paymentAppFeePercents: normalizePaymentAppFeePercents(doc.paymentAppFeePercents),
    returnExchangePolicy: doc.returnExchangePolicy || '',
    showReturnExchangePolicyOnReceipt: Boolean(doc.showReturnExchangePolicyOnReceipt),
    bookingPolicy: doc.bookingPolicy || '',
    showBookingPolicyOnReceipt: Boolean(doc.showBookingPolicyOnReceipt),
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
      moneyAccounts,
      paymentMethodAccountMap,
      paymentAppFeePercents,
      returnExchangePolicy,
      showReturnExchangePolicyOnReceipt,
      bookingPolicy,
      showBookingPolicyOnReceipt,
    } = req.body;

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

    let moneyAccountsNormalized;
    if (moneyAccounts !== undefined) {
      if (!Array.isArray(moneyAccounts)) {
        return res.status(400).json({ error: 'moneyAccounts must be an array' });
      }
      if (moneyAccounts.length > 80) {
        return res.status(400).json({ error: 'Too many money accounts (max 80)' });
      }
      moneyAccountsNormalized = normalizeMoneyAccounts({
        purchaseTreasuryMethods:
          treasuryNormalized ??
          (await getLatestSettingsDoc())?.purchaseTreasuryMethods,
        moneyAccounts,
      });
      if (!moneyAccountsNormalized.some((x) => x.key === 'cash' && x.kind === 'cash')) {
        return res.status(400).json({ error: 'moneyAccounts must include cash' });
      }
      // Keep purchaseTreasuryMethods in sync when money accounts are saved
      treasuryNormalized = moneyAccountsToPurchaseTreasuries(moneyAccountsNormalized);
    } else if (treasuryNormalized !== undefined) {
      // When only treasuries updated, rebuild money accounts keeping settlement kinds
      const existing = await getLatestSettingsDoc();
      const prevMoney = normalizeMoneyAccounts({
        purchaseTreasuryMethods: existing?.purchaseTreasuryMethods,
        moneyAccounts: existing?.moneyAccounts,
      });
      const settlementOnly = prevMoney.filter((a) => a.kind === 'settlement');
      moneyAccountsNormalized = normalizeMoneyAccounts({
        purchaseTreasuryMethods: treasuryNormalized,
        moneyAccounts: [
          ...treasuryNormalized.map((t) => ({
            key: t.key,
            label: t.label,
            kind: t.key === 'cash' ? 'cash' : 'treasury',
          })),
          ...settlementOnly,
        ],
      });
    }

    let mapNormalized;
    if (paymentMethodAccountMap !== undefined) {
      if (!Array.isArray(paymentMethodAccountMap)) {
        return res.status(400).json({ error: 'paymentMethodAccountMap must be an array' });
      }
      const accountsForKeys =
        moneyAccountsNormalized ||
        normalizeMoneyAccounts({
          purchaseTreasuryMethods:
            treasuryNormalized ??
            (await getLatestSettingsDoc())?.purchaseTreasuryMethods,
          moneyAccounts: (await getLatestSettingsDoc())?.moneyAccounts,
        });
      const keys = new Set(accountsForKeys.map((a) => a.key));
      mapNormalized = normalizePaymentMethodAccountMap(paymentMethodAccountMap, keys);
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
    if (moneyAccountsNormalized !== undefined) update.moneyAccounts = moneyAccountsNormalized;
    if (mapNormalized !== undefined) update.paymentMethodAccountMap = mapNormalized;
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

    res.status(200).json(serializeSettings(doc));
  } catch (error) {
    console.error('updateStoreSettings:', error);
    res.status(500).json({ error: 'Failed to update store settings' });
  }
};
