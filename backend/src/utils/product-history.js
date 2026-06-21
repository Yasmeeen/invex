import mongoose from 'mongoose';
import AuditLog from '../DB/models/auditLog.model.js';
import Order from '../DB/models/order.model.js';
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
 * Build a chronological timeline of everything that happened to a product row.
 * @param {object} product — lean Product with category + branch populated
 * @returns {Promise<{ events: object[] }>}
 */
export async function buildProductHistoryEvents(product) {
  const pid = toOid(product._id);
  if (!pid) return { events: [] };
  const pidStr = String(product._id);

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
        { entityType: 'Product', entityId: pidStr },
        { 'metadata.productId': pidStr },
        { 'metadata.productIds': pidStr },
        { 'metadata.createdProductId': pidStr },
        { 'metadata.createdProductIds': pidStr },
      ],
    })
      .sort({ createdAt: -1 })
      .limit(200)
      .lean(),

    StockMovement.find({ productId: pid }).sort({ createdAt: -1 }).limit(200).lean(),

    ProductBooking.find({ product: pid })
      .populate('client', 'name phoneNumber')
      .populate('createdBy', 'name')
      .populate('confirmedBy', 'name')
      .populate('cancelledBy', 'name')
      .populate('branch', 'name')
      .sort({ createdAt: -1 })
      .limit(100)
      .lean(),

    ProductBranchTransfer.find({ product: pid })
      .populate('fromBranch', 'name')
      .populate('toBranch', 'name')
      .populate('initiatedBy', 'name')
      .populate('resolvedBy', 'name')
      .sort({ createdAt: -1 })
      .limit(100)
      .lean(),

    Order.find({ 'products.productId': pid })
      .select(
        'orderNumber products status createdAt restoredAt branch paymentMethod totalPrice clientName sellerName payments paidByUserId returns'
      )
      .populate('branch', 'name')
      .sort({ createdAt: -1 })
      .limit(200)
      .lean(),

    ProductPurchaseRequest.find({
      $or: [{ createdProductId: pid }, { createdProductIds: pid }],
    })
      .populate('branch', 'name')
      .populate('createdBy', 'name')
      .populate('resolvedBy', 'name')
      .sort({ createdAt: -1 })
      .limit(50)
      .lean(),
  ]);

  const events = [];

  pushEvent(events, {
    id: `product-created-${pidStr}`,
    type: 'product_created',
    occurredAt: product.createdAt,
    actorName: product.addedBy || '',
    summary: product.code,
    details: {
      code: product.code,
      name: product.name,
      stock: product.stock,
      branch: branchName(product.branch),
      inWarehouse: !!product.inWarehouse,
    },
  });

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
      pushEvent(events, {
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
    pushEvent(events, {
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
    pushEvent(events, {
      id: `bt-request-${t._id}`,
      type: 'branch_transfer_requested',
      occurredAt: t.createdAt,
      actorName: actorFromUser(t.initiatedBy),
      summary: `${t.quantity}`,
      details: {
        quantity: t.quantity,
        fromBranch: branchName(t.fromBranch),
        toBranch: branchName(t.toBranch),
        status: t.status,
      },
    });

    if (t.status === 'approved' && t.resolvedAt) {
      pushEvent(events, {
        id: `bt-approve-${t._id}`,
        type: 'branch_transfer_approved',
        occurredAt: t.resolvedAt,
        actorName: actorFromUser(t.resolvedBy),
        summary: `${t.quantity}`,
        details: {
          quantity: t.quantity,
          fromBranch: branchName(t.fromBranch),
          toBranch: branchName(t.toBranch),
        },
      });
    }

    if (t.status === 'rejected' && t.resolvedAt) {
      pushEvent(events, {
        id: `bt-reject-${t._id}`,
        type: 'branch_transfer_rejected',
        occurredAt: t.resolvedAt,
        actorName: actorFromUser(t.resolvedBy),
        summary: t.rejectReason || `${t.quantity}`,
        details: {
          quantity: t.quantity,
          fromBranch: branchName(t.fromBranch),
          toBranch: branchName(t.toBranch),
          rejectReason: t.rejectReason || '',
        },
      });
    }
  }

  for (const b of bookings) {
    pushEvent(events, {
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
      pushEvent(events, {
        id: `booking-confirm-${b._id}`,
        type: 'booking_confirmed',
        occurredAt: b.confirmedAt,
        actorName: actorFromUser(b.confirmedBy),
        summary: b.customerName,
        details: { quantity: b.quantity, customerName: b.customerName },
      });
    }

    if (b.status === 'cancelled' && b.cancelledAt) {
      pushEvent(events, {
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
    pushEvent(events, {
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
      pushEvent(events, {
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
      pushEvent(events, {
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
        ret.returnedProductIds.some((id) => String(id) === pidStr);
      if (!affectsThis) continue;

      pushEvent(events, {
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
    const line = (order.products || []).find((p) => String(p.productId) === pidStr);
    if (!line) continue;

    pushEvent(events, {
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
      const item = (ret.items || []).find((it) => String(it.productId) === pidStr);
      if (!item) continue;

      pushEvent(events, {
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
