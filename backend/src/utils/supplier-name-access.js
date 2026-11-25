/** Supplier name on a product is visible only to these roles. */
export function canSeeProductSupplierName(role) {
  const r = String(role || '').trim();
  return r === 'Super Admin' || r === 'Co Admin' || r === 'Admin' || r === 'Branch Manager';
}

export function isSupplierAcquiredFrom(source) {
  if (!source || typeof source !== 'object') return false;
  if (String(source.partyType || '').toLowerCase() === 'supplier') return true;
  return source.vendorId != null && String(source.vendorId).trim() !== '';
}

/** Drop supplier identity from a product payload. Client source is kept.
 * partyType stays so editors do not treat the source as empty and clear it.
 */
export function stripSupplierNameFromProduct(product) {
  if (!product || typeof product !== 'object') return product;
  const plain = typeof product.toObject === 'function' ? product.toObject() : product;
  if (!isSupplierAcquiredFrom(plain.acquiredFrom)) return product;
  const next = { ...plain };
  next.acquiredFrom = { partyType: 'supplier' };
  return next;
}

/** Remove supplier display names from product-history event details. */
export function redactSupplierHistoryEvents(events) {
  return (events || []).map((ev) => {
    const details = ev?.details;
    if (!details || typeof details !== 'object') return ev;
    if (!isSupplierAcquiredFrom({ partyType: details.acquiredFromPartyType, vendorId: details.vendorId })) {
      return ev;
    }
    const nextDetails = { ...details };
    delete nextDetails.acquiredFrom;
    delete nextDetails.acquiredFromPartyType;
    delete nextDetails.vendorId;
    return { ...ev, details: nextDetails };
  });
}
