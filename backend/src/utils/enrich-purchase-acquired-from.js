import mongoose from 'mongoose';
import Client from '../DB/models/client.model.js';
import Vendor from '../DB/models/vendor.model.js';

function partyNameFromAcquiredFrom(af) {
  if (!af || typeof af !== 'object') return '';
  return String(af.displayName || af.name || af.phone || '').trim();
}

function idString(ref) {
  if (!ref) return '';
  if (typeof ref === 'object' && ref._id) return String(ref._id);
  return String(ref);
}

/**
 * Fill missing acquiredFrom.displayName on purchase list/detail payloads (clientId/vendorId only).
 */
export async function enrichPurchasesAcquiredFromDisplay(purchases) {
  if (!Array.isArray(purchases) || !purchases.length) return purchases;

  const clientIds = new Set();
  const vendorIds = new Set();

  for (const p of purchases) {
    const af = p?.productPayload?.acquiredFrom;
    if (!af || partyNameFromAcquiredFrom(af)) continue;
    const cid = idString(af.clientId);
    const vid = idString(af.vendorId);
    if (cid && mongoose.Types.ObjectId.isValid(cid)) clientIds.add(cid);
    if (vid && mongoose.Types.ObjectId.isValid(vid)) vendorIds.add(vid);
  }

  if (!clientIds.size && !vendorIds.size) return purchases;

  const [clients, vendors] = await Promise.all([
    clientIds.size
      ? Client.find({ _id: { $in: [...clientIds] } })
          .select('name phoneNumber')
          .lean()
      : [],
    vendorIds.size
      ? Vendor.find({ _id: { $in: [...vendorIds] } })
          .select('name nameOfcompany phone')
          .lean()
      : [],
  ]);

  const clientMap = new Map(clients.map((c) => [String(c._id), c]));
  const vendorMap = new Map(vendors.map((v) => [String(v._id), v]));

  for (const p of purchases) {
    const af = p?.productPayload?.acquiredFrom;
    if (!af || partyNameFromAcquiredFrom(af)) continue;

    const cid = idString(af.clientId);
    const vid = idString(af.vendorId);

    if (vid && vendorMap.has(vid)) {
      const v = vendorMap.get(vid);
      af.displayName = String(v.nameOfcompany || v.name || '').trim();
      if (!af.phone) af.phone = String(v.phone || '').trim();
    } else if (cid && clientMap.has(cid)) {
      const c = clientMap.get(cid);
      af.displayName = String(c.name || '').trim();
      if (!af.phone) af.phone = String(c.phoneNumber || '').trim();
    }
  }

  return purchases;
}
