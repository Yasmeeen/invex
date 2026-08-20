import StoreSettings from '../../DB/models/storeSettings.model.js';
import { normalizePaymentAppFeePercents } from './paymentAppFees.js';
import { normalizePurchaseTreasuryMethods } from './treasuryMethods.js';
import {
  moneyAccountsToPurchaseTreasuries,
  normalizeMoneyAccounts,
  normalizePaymentMethodAccountMap,
  syncPaymentMapWithCatalog,
} from './moneyAccounts.js';
import {
  catalogToPaymentAppFeePercents,
  mergeMoneyAccountsFromCatalog,
  normalizePaymentMethodsCatalog,
} from './paymentMethodsCatalog.js';

const MAX_LOGO_LENGTH = 600000;

/** One logical row: always read/update the same document (avoids split brain if multiple rows exist). */
const getLatestSettingsDoc = () => StoreSettings.findOne().sort({ updatedAt: -1 });

function serializeSettings(doc) {
  const paymentMethodsCatalog = normalizePaymentMethodsCatalog({
    paymentMethodsCatalog: doc.paymentMethodsCatalog,
    paymentAppFeePercents: doc.paymentAppFeePercents,
    purchaseTreasuryMethods: doc.purchaseTreasuryMethods,
  });

  // Money accounts in DB are authoritative. Catalog may only ADD missing
  // treasury homes for instant purchase methods — never auto-create settlement companies.
  let moneyAccounts = normalizeMoneyAccounts({
    purchaseTreasuryMethods: doc.purchaseTreasuryMethods,
    moneyAccounts: doc.moneyAccounts,
  });
  moneyAccounts = normalizeMoneyAccounts({
    purchaseTreasuryMethods: moneyAccountsToPurchaseTreasuries(moneyAccounts),
    moneyAccounts: mergeMoneyAccountsFromCatalog(moneyAccounts, paymentMethodsCatalog),
  });

  const accountKeys = new Set(moneyAccounts.map((a) => a.key));
  const paymentMethodAccountMap = syncPaymentMapWithCatalog(
    doc.paymentMethodAccountMap,
    paymentMethodsCatalog,
    accountKeys,
    moneyAccounts
  );

  const paymentAppFeePercents = catalogToPaymentAppFeePercents(paymentMethodsCatalog);
  // Keep purchase pickers aligned with real cash/treasury accounts (not sale-only catalog rows)
  const purchaseTreasuryMethods = moneyAccountsToPurchaseTreasuries(moneyAccounts);

  return {
    storeName: doc.storeName,
    storePhoneNumber: doc.storePhoneNumber,
    logoUrl: doc.logoUrl || '',
    receiptLanguage: doc.receiptLanguage || 'en',
    paymentMethodsCatalog,
    purchaseTreasuryMethods,
    moneyAccounts,
    paymentMethodAccountMap,
    paymentAppFeePercents,
    returnExchangePolicy: doc.returnExchangePolicy || '',
    showReturnExchangePolicyOnReceipt: Boolean(doc.showReturnExchangePolicyOnReceipt),
    bookingPolicy: doc.bookingPolicy || '',
    showBookingPolicyOnReceipt: Boolean(doc.showBookingPolicyOnReceipt),
    weightSalesEnabled: Boolean(doc.weightSalesEnabled),
    deliveryOrdersEnabled: Boolean(doc.deliveryOrdersEnabled),
    cashierPurchaseExchangeEnabled: doc.cashierPurchaseExchangeEnabled !== false,
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
      paymentMethodsCatalog,
      returnExchangePolicy,
      showReturnExchangePolicyOnReceipt,
      bookingPolicy,
      showBookingPolicyOnReceipt,
      weightSalesEnabled,
      deliveryOrdersEnabled,
      cashierPurchaseExchangeEnabled,
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

    const existing = await getLatestSettingsDoc();

    let catalogNormalized;
    if (paymentMethodsCatalog !== undefined) {
      if (!Array.isArray(paymentMethodsCatalog)) {
        return res.status(400).json({ error: 'paymentMethodsCatalog must be an array' });
      }
      if (paymentMethodsCatalog.length > 80) {
        return res.status(400).json({ error: 'Too many payment methods (max 80)' });
      }
      catalogNormalized = normalizePaymentMethodsCatalog({
        paymentMethodsCatalog,
        paymentAppFeePercents: existing?.paymentAppFeePercents,
        purchaseTreasuryMethods: existing?.purchaseTreasuryMethods,
      });
      if (!catalogNormalized.some((x) => x.key === 'cash')) {
        return res.status(400).json({ error: 'paymentMethodsCatalog must include key "cash"' });
      }
    }

    let treasuryNormalized;
    if (purchaseTreasuryMethods !== undefined && catalogNormalized === undefined) {
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
      // Submitted moneyAccounts are authoritative for cash/treasury/settlement.
      // Seed PTM from the payload itself so stale purchaseTreasuryMethods cannot
      // resurrect deleted accounts (or wipe banks when PTM was catalog-only cash).
      const submittedTreasuries = moneyAccountsToPurchaseTreasuries(moneyAccounts);
      const prevMoney = normalizeMoneyAccounts({
        purchaseTreasuryMethods: existing?.purchaseTreasuryMethods,
        moneyAccounts: existing?.moneyAccounts,
      });
      const submittedKeys = new Set(
        (Array.isArray(moneyAccounts) ? moneyAccounts : [])
          .map((a) => String(a?.key || '').trim().toLowerCase())
          .filter(Boolean)
      );
      // Keep prior settlement accounts unless the client explicitly sent settlement rows
      // (accounts editor only edits cash/treasury and re-attaches settlements from snapshot).
      const clientSentSettlement = (Array.isArray(moneyAccounts) ? moneyAccounts : []).some(
        (a) => String(a?.kind || '').toLowerCase() === 'settlement'
      );
      const preservedSettlements = clientSentSettlement
        ? []
        : prevMoney.filter((a) => a.kind === 'settlement' && !submittedKeys.has(a.key));
      moneyAccountsNormalized = normalizeMoneyAccounts({
        purchaseTreasuryMethods: submittedTreasuries,
        moneyAccounts: [...moneyAccounts, ...preservedSettlements],
      });
      if (!moneyAccountsNormalized.some((x) => x.key === 'cash' && x.kind === 'cash')) {
        return res.status(400).json({ error: 'moneyAccounts must include cash' });
      }
      treasuryNormalized = moneyAccountsToPurchaseTreasuries(moneyAccountsNormalized);
    } else if (treasuryNormalized !== undefined) {
      const prevMoney = normalizeMoneyAccounts({
        purchaseTreasuryMethods: existing?.purchaseTreasuryMethods,
        moneyAccounts: existing?.moneyAccounts,
      });
      const prevByKey = new Map(prevMoney.map((a) => [a.key, a]));
      const settlementOnly = prevMoney.filter((a) => a.kind === 'settlement');
      moneyAccountsNormalized = normalizeMoneyAccounts({
        purchaseTreasuryMethods: treasuryNormalized,
        moneyAccounts: [
          ...treasuryNormalized.map((t) => {
            const prev = prevByKey.get(t.key);
            return {
              key: t.key,
              label: t.label,
              kind: t.key === 'cash' ? 'cash' : 'treasury',
              channel: prev?.channel || '',
              accountNumber: prev?.accountNumber || '',
              phone: prev?.phone || '',
              enabled: t.key === 'cash' ? true : prev?.enabled !== false,
            };
          }),
          ...settlementOnly,
        ],
      });
    }

    if (catalogNormalized !== undefined) {
      // Catalog edits must not rebuild / replace money accounts from sale-visible methods.
      // Only ensure each catalog method that needs a balance home has one.
      const baseMoney =
        moneyAccountsNormalized ||
        normalizeMoneyAccounts({
          purchaseTreasuryMethods: existing?.purchaseTreasuryMethods,
          moneyAccounts: existing?.moneyAccounts,
        });
      moneyAccountsNormalized = normalizeMoneyAccounts({
        purchaseTreasuryMethods: moneyAccountsToPurchaseTreasuries(baseMoney),
        moneyAccounts: mergeMoneyAccountsFromCatalog(baseMoney, catalogNormalized),
      });
      treasuryNormalized = moneyAccountsToPurchaseTreasuries(moneyAccountsNormalized);
    } else if (treasuryNormalized !== undefined || moneyAccountsNormalized !== undefined) {
      // Keep unified catalog in sync when accounts/treasuries are edited alone
      const effectiveTreasuries =
        treasuryNormalized ||
        moneyAccountsToPurchaseTreasuries(
          moneyAccountsNormalized ||
            normalizeMoneyAccounts({
              purchaseTreasuryMethods: existing?.purchaseTreasuryMethods,
              moneyAccounts: existing?.moneyAccounts,
            })
        );
      const baseCatalog = normalizePaymentMethodsCatalog({
        paymentMethodsCatalog: existing?.paymentMethodsCatalog,
        paymentAppFeePercents: existing?.paymentAppFeePercents,
        purchaseTreasuryMethods: existing?.purchaseTreasuryMethods,
      });
      const byKey = new Map(baseCatalog.map((r) => [r.key, { ...r }]));
      const treasuryKeys = new Set(effectiveTreasuries.map((t) => t.key));
      for (const t of effectiveTreasuries) {
        const prev = byKey.get(t.key);
        if (!prev) {
          byKey.set(t.key, {
            key: t.key,
            label: t.label,
            showIn: t.key === 'cash' ? 'both' : 'purchase',
            effectMode: 'instant',
            feePercent: 0,
          });
        } else {
          prev.label = t.label || prev.label;
          if (prev.effectMode !== 'none' && prev.showIn === 'sale') {
            prev.showIn = 'both';
          }
        }
      }
      // Drop purchase-only catalog rows for accounts the user removed (keep sale methods)
      for (const [key, row] of Array.from(byKey.entries())) {
        if (key === 'cash' || key === 'credit') continue;
        if (row.showIn === 'purchase' && row.effectMode === 'instant' && !treasuryKeys.has(key)) {
          byKey.delete(key);
        }
      }
      catalogNormalized = normalizePaymentMethodsCatalog({
        paymentMethodsCatalog: Array.from(byKey.values()),
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
            treasuryNormalized ?? existing?.purchaseTreasuryMethods,
          moneyAccounts: existing?.moneyAccounts,
        });
      const keys = new Set(accountsForKeys.map((a) => a.key));
      const catalogForMap =
        catalogNormalized ||
        normalizePaymentMethodsCatalog({
          paymentMethodsCatalog: existing?.paymentMethodsCatalog,
          paymentAppFeePercents: existing?.paymentAppFeePercents,
          purchaseTreasuryMethods: existing?.purchaseTreasuryMethods,
        });
      mapNormalized = syncPaymentMapWithCatalog(
        paymentMethodAccountMap,
        catalogForMap,
        keys,
        accountsForKeys
      );
    }

    let feesNormalized;
    if (catalogNormalized !== undefined) {
      feesNormalized = catalogToPaymentAppFeePercents(catalogNormalized);
    } else if (paymentAppFeePercents !== undefined) {
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
    if (weightSalesEnabled !== undefined && typeof weightSalesEnabled !== 'boolean') {
      return res.status(400).json({ error: 'weightSalesEnabled must be a boolean' });
    }
    if (deliveryOrdersEnabled !== undefined && typeof deliveryOrdersEnabled !== 'boolean') {
      return res.status(400).json({ error: 'deliveryOrdersEnabled must be a boolean' });
    }
    if (
      cashierPurchaseExchangeEnabled !== undefined &&
      typeof cashierPurchaseExchangeEnabled !== 'boolean'
    ) {
      return res.status(400).json({ error: 'cashierPurchaseExchangeEnabled must be a boolean' });
    }

    const update = {};
    if (storeName !== undefined) update.storeName = storeName.trim().slice(0, 200);
    if (storePhoneNumber !== undefined) update.storePhoneNumber = storePhoneNumber.trim().slice(0, 50);
    if (logoUrl !== undefined) update.logoUrl = logoUrl;
    if (receiptLanguage !== undefined) update.receiptLanguage = receiptLangNormalized;
    if (catalogNormalized !== undefined) update.paymentMethodsCatalog = catalogNormalized;
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
    if (weightSalesEnabled !== undefined) {
      update.weightSalesEnabled = weightSalesEnabled;
    }
    if (deliveryOrdersEnabled !== undefined) {
      update.deliveryOrdersEnabled = deliveryOrdersEnabled;
    }
    if (cashierPurchaseExchangeEnabled !== undefined) {
      update.cashierPurchaseExchangeEnabled = cashierPurchaseExchangeEnabled;
    }

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
