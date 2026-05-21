import PurchasingRequest from '../DB/models/purchasingRequest.model.js';
import {
  isDeferredPurchaseTreasury,
  PURCHASE_TREASURY_DEFERRED_LABEL,
} from '../modules/settings_module/treasuryMethods.js';
import {
  removeVendorPurchaseLedger,
  syncVendorPurchaseLedger,
} from './vendor-purchase-ledger.js';

export function deskPurchaseLineTotal(purchase) {
  const q = Math.max(1, Math.floor(Number(purchase?.quantity) || 1));
  const net = Number(purchase?.productPayload?.netPrice) || 0;
  return Math.round(net * q * 100) / 100;
}

export function deferredDeskPurchaseRemaining(purchase) {
  if (!purchase || !isDeferredPurchaseTreasury(purchase.purchaseTreasuryKey)) return 0;
  const total = deskPurchaseLineTotal(purchase);
  const paid = Number(purchase.amountPaid) || 0;
  return Math.max(0, Math.round((total - paid) * 100) / 100);
}

function deskPurchasingRequestNote(purchase) {
  const pp = purchase?.productPayload || {};
  const name = String(pp.name || '').trim();
  const code = String(pp.code || '').trim();
  const parts = ['شراء منتج (مكتب)'];
  if (name) parts.push(name);
  if (code) parts.push(`(${code})`);
  return parts.join(' — ');
}

/**
 * Create or update PurchasingRequest + vendor ledger for approved deferred supplier desk purchase.
 */
export async function syncDeferredSupplierDeskPurchase(purchase, { userId, actorName, session } = {}) {
  if (!purchase || !isDeferredPurchaseTreasury(purchase.purchaseTreasuryKey)) {
    return null;
  }

  const af = purchase.productPayload?.acquiredFrom;
  if (!af || af.partyType !== 'supplier' || !af.vendorId) {
    return null;
  }

  const totalAmount = deskPurchaseLineTotal(purchase);
  const productIds = [];
  if (purchase.createdProductIds?.length) {
    for (const id of purchase.createdProductIds) {
      if (id) productIds.push(id);
    }
  } else if (purchase.createdProductId) {
    productIds.push(purchase.createdProductId);
  }

  const note = deskPurchasingRequestNote(purchase);
  const requestedBy = String(actorName || '').trim();

  let pr;
  if (purchase.linkedPurchasingRequestId) {
    const findQ = PurchasingRequest.findById(purchase.linkedPurchasingRequestId);
    pr = session ? await findQ.session(session) : await findQ;
    if (pr) {
      pr.totalAmount = totalAmount;
      pr.paymentStatus = 'Deferred';
      pr.status = 'Received';
      pr.notes = note;
      if (productIds.length) pr.products = productIds;
      if (session) await pr.save({ session });
      else await pr.save();
    }
  }

  if (!pr) {
    const payload = {
      supplier: af.vendorId,
      paymentStatus: 'Deferred',
      amountPaid: 0,
      totalAmount,
      status: 'Received',
      requestDate: purchase.resolvedAt || purchase.createdAt || new Date(),
      requestedBy,
      notes: note,
      products: productIds,
    };
    if (session) {
      const created = await PurchasingRequest.create([payload], { session });
      pr = created[0];
      purchase.linkedPurchasingRequestId = pr._id;
      await purchase.save({ session });
    } else {
      pr = await PurchasingRequest.create(payload);
      purchase.linkedPurchasingRequestId = pr._id;
      await purchase.save();
    }
  }

  await syncVendorPurchaseLedger(pr, { userId });
  return pr;
}

export async function removeDeferredSupplierDeskPurchase(purchase, { session } = {}) {
  const prId = purchase?.linkedPurchasingRequestId;
  const vendorId = purchase?.productPayload?.acquiredFrom?.vendorId;
  if (!prId) return;

  if (session) {
    await PurchasingRequest.findByIdAndDelete(prId).session(session);
  } else {
    await PurchasingRequest.findByIdAndDelete(prId);
  }
  purchase.linkedPurchasingRequestId = undefined;
  if (session) await purchase.save({ session });
  else await purchase.save();

  try {
    await removeVendorPurchaseLedger(prId, vendorId);
  } catch (e) {
    console.warn('⚠️ remove deferred desk purchase ledger:', e?.message || e);
  }
}

export function deferredPurchaseTreasuryLabel() {
  return PURCHASE_TREASURY_DEFERRED_LABEL;
}
