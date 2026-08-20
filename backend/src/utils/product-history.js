import mongoose from 'mongoose';
import AuditLog from '../DB/models/auditLog.model.js';
import Order from '../DB/models/order.model.js';
import Product from '../DB/models/product.model.js';
import ProductBooking from '../DB/models/productBooking.model.js';
import ProductBranchTransfer from '../DB/models/productBranchTransfer.model.js';
import ProductPurchaseRequest from '../DB/models/productPurchaseRequest.model.js';
import StockMovement from '../DB/models/stockMovement.model.js';
import User from '../DB/models/user.model.js';

function toOid(id) {
  const s = String(id || '').trim();
  if (!mongoose.Types.ObjectId.isValid(s)) return null;
  return new mongoose.Types.ObjectId(s);
}

function pushEvent(events, event) {
  if (!event?.occurredAt) return;
  const d = event.occurredAt instanceof Date ? event.occurredAt : new Date(event.occurredAt);
  if (Number.isNaN(d.getTime())) return;
  events.push({ ...event, occurredAt: d.toISOString() });
}

function actorFromUser(user) {
  if (!user) return '';
  if (typeof user === 'string') return user;
  return String(user.name || '').trim();
}

function branchName(branch) {
  if (!branch) return '';
  if (typeof branch === 'string') return '';
  return String(branch.name || '').trim();
}

/**
 * Collect every product row that shares the same unit code / transfer chain
 * so serial track keeps pre-transfer history after a branch clone.
 */
export async function resolveRelatedProductIds(product, extraIds = []) {
  const seed = new Set();
  const add = (id) => {
    const oid = toOid(id);
    if (oid) seed.add(String(oid));
  };

  add(product?._id);
  for (const id of extraIds || []) add(id);

  const code = String(product?.code || '').trim();
  if (code) {
    const siblings = await Product.find({ code }).select('_id').lean();
    for (const s of siblings || []) add(s._id);
  }

  const seedOids = [...seed].map((id) => toOid(id)).filter(Boolean);
  if (seedOids.length) {
    const transfers = await ProductBranchTransfer.find({
      $or: [
        { product: { $in: seedOids } },
        { destinationProduct: { $in: seedOids } },
      ],
    })
      .select('product destinationProduct')
      .lean();

    for (const t of transfers || []) {
      add(t.product);
      add(t.destinationProduct);
    }
  }

  return [...seed].map((id) => toOid(id)).filter(Boolean);
}

/**
 * Build a chronological timeline of everything that happened to a product row
 * (and related same-code / transfer-linked clones).
 * @param {object} product — lean Product with category + branch populated
 * @param {{ relatedProductIds?: Array<string|object>, relatedProducts?: object[] }} [options]
 * @returns {Promise<{ events: object[] }>}
 */
export async function buildProductHistoryEvents(product, options = {}) {
  const primaryOid = toOid(product._id);
  if (!primaryOid) return { events: [] };

  const extraFromOptions = [
    ...(options.relatedProductIds || []),
    ...((options.relatedProducts || []).map((p) => p?._id).filter(Boolean)),
  ];
  const productIds = await resolveRelatedProductIds(product, extraFromOptions);
  if (!productIds.length) return { events: [] };

  const pidStrs = productIds.map((id) => String(id));
  const pidSet = new Set(pidStrs);

  const relatedProductsById = new Map();
  relatedProductsById.set(String(product._id), product);
  for (const p of options.relatedProducts || []) {
    if (p?._id) relatedProductsById.set(String(p._id), p);
  }

  const missingIds = productIds.filter((id) => !relatedProductsById.has(String(id)));
  if (missingIds.length) {
    const fetched = await Product.find({ _id: { $in: missingIds } })
      .populate('branch', 'name')
      .lean();
    for (const p of fetched || []) {
      relatedProductsById.set(String(p._id), p);
    }
  }

  const [
    auditLogs,
    stockMovements,
    bookings,
    branchTransfers,
    orders,
    purchaseRequests,
  ] = await Promise.all([
    AuditLog.find({
      $or: [
        { entityType: 'Product', entityId: { $in: pidStrs } },
        { 'metadata.productId': { $in: pidStrs } },
        { 'metadata.productIds': { $in: pidStrs } },
        { 'metadata.createdProductId': { $in: pidStrs } },
        { 'metadata.createdProductIds': { $in: pidStrs } },
      ],
    })
      .sort({ createdAt: -1 })
      .limit(400)
      .lean(),

    StockMovement.find({ productId: { $in: productIds } })
      .sort({ createdAt: -1 })
      .limit(400)
      .lean(),

    ProductBooking.find({ product: { $in: productIds } })
      .populate('client', 'name phoneNumber')
      .populate('createdBy', 'name')
      .populate('confirmedBy', 'name')
      .populate('cancelledBy', 'name')
      .populate('branch', 'name')
      .sort({ createdAt: -1 })
      .limit(200)
      .lean(),

    ProductBranchTransfer.find({
      $or: [
        { product: { $in: productIds } },
        { destinationProduct: { $in: productIds } },
      ],
    })
      .populate('fromBranch', 'name')
      .populate('toBranch', 'name')
      .populate('initiatedBy', 'name')
      .populate('resolvedBy', 'name')
      .sort({ createdAt: -1 })
      .limit(200)
      .lean(),

    Order.find({ 'products.productId': { $in: productIds } })
      .select(
        'orderNumber products status createdAt restoredAt branch paymentMethod totalPrice clientName sellerName payments paidByUserId returns'
      )
      .populate('branch', 'name')
      .sort({ createdAt: -1 })
      .limit(400)
      .lean(),

    ProductPurchaseRequest.find({
      $or: [
        { createdProductId: { $in: productIds } },
        { createdProductIds: { $in: productIds } },
      ],
    })
      .populate('branch', 'name')
      .populate('createdBy', 'name')
      .populate('resolvedBy', 'name')
      .sort({ createdAt: -1 })
      .limit(100)
      .lean(),
  ]);

  const events = [];
  const seenEventIds = new Set();
  const pushUnique = (event) => {
    if (!event?.id || seenEventIds.has(event.id)) return;
    seenEventIds.add(event.id);
    pushEvent(events, event);
  };

  // Destination clones created by an approved branch transfer should not look like a fresh product.
  const createdByTransferIds = new Set();
  for (const t of branchTransfers || []) {
    if (t.status !== 'approved') continue;
    if (t.destinationProduct) {
      createdByTransferIds.add(String(t.destinationProduct));
      continue;
    }
    // Legacy transfers (before destinationProduct was stored): match clone created at approve time.
    if (!t.resolvedAt) continue;
    const resolvedMs = new Date(t.resolvedAt).getTime();
    const toBranchId = String(t.toBranch?._id || t.toBranch || '');
    for (const p of relatedProductsById.values()) {
      if (String(p._id) === String(t.product)) continue;
      const createdMs = new Date(p.createdAt || 0).getTime();
      if (Number.isNaN(resolvedMs) || Number.isNaN(createdMs)) continue;
      if (Math.abs(createdMs - resolvedMs) > 60_000) continue;
      const pBranchId = String(p.branch?._id || p.branch || '');
      if (toBranchId && pBranchId && toBranchId === pBranchId) {
        createdByTransferIds.add(String(p._id));
      }
    }
  }

  // Prefer chronological origin: earliest product_created among related rows.
  const relatedList = [...relatedProductsById.values()].sort((a, b) => {
    const ta = new Date(a.createdAt || 0).getTime();
    const tb = new Date(b.createdAt || 0).getTime();
    return ta - tb;
  });

  for (const p of relatedList) {
    const idStr = String(p._id);
    if (createdByTransferIds.has(idStr)) continue;
    pushUnique({
      id: `product-created-${idStr}`,
      type: 'product_created',
      occurredAt: p.createdAt,
      actorName: p.addedBy || '',
      summary: p.code,
      details: {
        code: p.code,
        name: p.name,
        stock: p.stock,
        branch: branchName(p.branch),
        inWarehouse: !!p.inWarehouse,
        productId: idStr,
      },
    });
  }

  for (const log of auditLogs) {
    if (log.entityType === 'Product' && log.action === 'create') continue;
    if (
      log.entityType === 'ProductBranchTransfer' ||
      log.entityType === 'ProductBooking' ||
      log.entityType === 'ProductPurchaseRequest'
    ) {
      continue;
    }
    if (log.entityType === 'Product') {
      pushUnique({
        id: `audit-${log._id}`,
        type: `product_${log.action}`,
        occurredAt: log.createdAt,
        actorName: log.actorName || '',
        summary: log.message || log.action,
        details: {
          action: log.action,
          before: log.before,
          after: log.after,
          metadata: log.metadata,
        },
      });
    }
  }

  for (const m of stockMovements) {
    if (m.movementType === 'sale' || m.movementType === 'return') continue;
    // Branch-transfer stock rows are covered by ProductBranchTransfer events (with names + approver).
    if (m.referenceType === 'branch_transfer') continue;
    pushUnique({
      id: `stock-${m._id}`,
      type: m.movementType === 'transfer' ? 'stock_transfer' : `stock_${m.movementType}`,
      occurredAt: m.createdAt,
      actorName: '',
      summary: m.notes || m.movementType,
      details: {
        movementType: m.movementType,
        quantity: m.quantity,
        unitPrice: m.unitPrice,
        totalValue: m.totalValue,
        fromBranch: m.fromBranchId,
        toBranch: m.toBranchId,
        branchId: m.branchId,
        referenceType: m.referenceType,
        notes: m.notes,
      },
    });
  }

  for (const t of branchTransfers) {
    const initiatedByName = actorFromUser(t.initiatedBy);
    const resolvedByName = actorFromUser(t.resolvedBy);
    const from = branchName(t.fromBranch);
    const to = branchName(t.toBranch);
    const routeSummary = from && to ? `${from} → ${to}` : `${t.quantity}`;

    pushUnique({
      id: `bt-request-${t._id}`,
      type: 'branch_transfer_requested',
      occurredAt: t.createdAt,
      actorName: initiatedByName,
      summary: routeSummary,
      details: {
        quantity: t.quantity,
        fromBranch: from,
        toBranch: to,
        status: t.status,
        initiatedBy: initiatedByName,
      },
    });

    if (t.status === 'approved' && t.resolvedAt) {
      pushUnique({
        id: `bt-approve-${t._id}`,
        type: 'branch_transfer_approved',
        occurredAt: t.resolvedAt,
        actorName: resolvedByName,
        summary: routeSummary,
        details: {
          quantity: t.quantity,
          fromBranch: from,
          toBranch: to,
          initiatedBy: initiatedByName,
          approvedBy: resolvedByName,
        },
      });
    }

    if (t.status === 'rejected' && t.resolvedAt) {
      pushUnique({
        id: `bt-reject-${t._id}`,
        type: 'branch_transfer_rejected',
        occurredAt: t.resolvedAt,
        actorName: resolvedByName,
        summary: t.rejectReason || routeSummary,
        details: {
          quantity: t.quantity,
          fromBranch: from,
          toBranch: to,
          initiatedBy: initiatedByName,
          rejectedBy: resolvedByName,
          rejectReason: t.rejectReason || '',
        },
      });
    }
  }

  for (const b of bookings) {
    pushUnique({
      id: `booking-create-${b._id}`,
      type: 'booking_created',
      occurredAt: b.bookingDate || b.createdAt,
      actorName: actorFromUser(b.createdBy),
      summary: b.customerName,
      details: {
        customerName: b.customerName,
        customerPhone: b.customerPhone,
        quantity: b.quantity,
        depositAmount: b.depositAmount,
        pickupType: b.pickupType,
        branch: branchName(b.branch),
        status: b.status,
      },
    });

    if (b.confirmed && b.confirmedAt) {
      pushUnique({
        id: `booking-confirm-${b._id}`,
        type: 'booking_confirmed',
        occurredAt: b.confirmedAt,
        actorName: actorFromUser(b.confirmedBy),
        summary: b.customerName,
        details: { quantity: b.quantity, customerName: b.customerName },
      });
    }

    if (b.status === 'cancelled' && b.cancelledAt) {
      pushUnique({
        id: `booking-cancel-${b._id}`,
        type: 'booking_cancelled',
        occurredAt: b.cancelledAt,
        actorName: actorFromUser(b.cancelledBy),
        summary: b.cancelReason || b.customerName,
        details: {
          quantity: b.quantity,
          customerName: b.customerName,
          cancelReason: b.cancelReason || '',
        },
      });
    }
  }

  for (const pr of purchaseRequests) {
    const payload = pr.productPayload || {};
    pushUnique({
      id: `purchase-create-${pr._id}`,
      type: pr.status === 'pending' ? 'purchase_request_created' : 'purchase_request_submitted',
      occurredAt: pr.createdAtUserLocal || pr.createdAt,
      actorName: actorFromUser(pr.createdBy),
      summary: payload.code || payload.name || '',
      details: {
        status: pr.status,
        quantity: pr.quantity,
        code: payload.code,
        name: payload.name,
        branch: branchName(pr.branch),
        netPrice: payload.netPrice,
        acquiredFrom: payload.acquiredFrom?.displayName || payload.acquiredFrom?.name || '',
      },
    });

    if (pr.resolvedAt && pr.status === 'approved') {
      pushUnique({
        id: `purchase-approve-${pr._id}`,
        type: 'purchase_request_approved',
        occurredAt: pr.resolvedAt,
        actorName: actorFromUser(pr.resolvedBy),
        summary: payload.code || '',
        details: {
          quantity: pr.quantity,
          branch: branchName(pr.branch),
        },
      });
    }

    if (pr.resolvedAt && pr.status === 'rejected') {
      pushUnique({
        id: `purchase-reject-${pr._id}`,
        type: 'purchase_request_rejected',
        occurredAt: pr.resolvedAt,
        actorName: actorFromUser(pr.resolvedBy),
        summary: pr.resolutionNote || payload.code || '',
        details: {
          resolutionNote: pr.resolutionNote || '',
          branch: branchName(pr.branch),
        },
      });
    }

    for (let i = 0; i < (pr.returns || []).length; i++) {
      const ret = pr.returns[i];
      const affectsThis =
        !ret.returnedProductIds?.length ||
        ret.returnedProductIds.some((id) => pidSet.has(String(id)));
      if (!affectsThis) continue;

      pushUnique({
        id: `purchase-return-${pr._id}-${i}`,
        type: 'purchase_return',
        occurredAt: ret.returnedAt,
        actorName: '',
        summary: `${ret.quantity}`,
        details: {
          quantity: ret.quantity,
          refundTotal: ret.refundTotal,
          unitRefundPrice: ret.unitRefundPrice,
          note: ret.note || '',
          purchaseRequestId: String(pr._id),
        },
      });
    }
  }

  const orderIds = orders.map((o) => String(o._id));
  const orderCreateAudits = orderIds.length
    ? await AuditLog.find({
        entityType: 'Order',
        action: 'create',
        entityId: { $in: orderIds },
      })
        .select('entityId actorName actorUserId')
        .lean()
    : [];
  const auditByOrderId = new Map(orderCreateAudits.map((a) => [String(a.entityId), a]));

  const orderActorUserIds = new Set();
  for (const order of orders) {
    if (String(order.sellerName || '').trim()) continue;
    const audit = auditByOrderId.get(String(order._id));
    if (audit?.actorUserId) orderActorUserIds.add(String(audit.actorUserId));
    for (const p of order.payments || []) {
      if (p.paidByUserId) orderActorUserIds.add(String(p.paidByUserId));
    }
  }
  for (const order of orders) {
    for (const ret of order.returns || []) {
      if (ret.returnedByUserId) orderActorUserIds.add(String(ret.returnedByUserId));
    }
  }

  const orderActorUsers = orderActorUserIds.size
    ? await User.find({ _id: { $in: [...orderActorUserIds] } })
        .select('name')
        .lean()
    : [];
  const userNameById = new Map(orderActorUsers.map((u) => [String(u._id), String(u.name || '').trim()]));

  const resolveOrderSeller = (order) => {
    const direct = String(order.sellerName || '').trim();
    if (direct) return direct;
    const audit = auditByOrderId.get(String(order._id));
    if (audit?.actorName) return String(audit.actorName).trim();
    if (audit?.actorUserId) {
      const fromAudit = userNameById.get(String(audit.actorUserId));
      if (fromAudit) return fromAudit;
    }
    for (const p of order.payments || []) {
      if (p.paidByUserId) {
        const fromPayment = userNameById.get(String(p.paidByUserId));
        if (fromPayment) return fromPayment;
      }
    }
    return '';
  };

  const resolveReturnActor = (returnedByUserId) => {
    if (!returnedByUserId) return '';
    return userNameById.get(String(returnedByUserId)) || '';
  };

  for (const order of orders) {
    const line = (order.products || []).find((p) => pidSet.has(String(p.productId)));
    if (!line) continue;

    pushUnique({
      id: `sale-${order._id}`,
      type: 'sale',
      occurredAt: order.createdAt,
      actorName: resolveOrderSeller(order),
      summary: `#${order.orderNumber}`,
      details: {
        orderId: String(order._id),
        orderNumber: order.orderNumber,
        quantity: line.quantity,
        price: line.price,
        lineTotal: Number(line.price || 0) * Number(line.quantity || 0),
        clientName: order.clientName || '',
        paymentMethod: order.paymentMethod || '',
        branch: branchName(order.branch),
        orderStatus: order.status,
      },
    });

    for (let i = 0; i < (order.returns || []).length; i++) {
      const ret = order.returns[i];
      const item = (ret.items || []).find((it) => pidSet.has(String(it.productId)));
      if (!item) continue;

      pushUnique({
        id: `sale-return-${order._id}-${i}`,
        type: 'sale_return',
        occurredAt: ret.returnedAt,
        actorName: resolveReturnActor(ret.returnedByUserId),
        summary: `#${order.orderNumber}`,
        details: {
          orderId: String(order._id),
          orderNumber: order.orderNumber,
          quantity: item.quantity,
          unitRefundPrice: item.unitRefundPrice,
          lineTotal: item.lineTotal,
          refundTotal: ret.refundTotal,
          returnAll: !!ret.returnAll,
          note: ret.note || '',
        },
      });
    }
  }

  events.sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());

  return { events };
}
