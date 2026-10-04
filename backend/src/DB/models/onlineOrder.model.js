import mongoose from 'mongoose';

const onlineOrderSchema = new mongoose.Schema(
  {
    crmOrderId: { type: String, required: true, unique: true, trim: true, index: true },
    crmOrderNumber: { type: String, required: true, trim: true, index: true },
    reservationKey: { type: String, required: true, unique: true, trim: true },
    customer: {
      crmCustomerId: { type: String, default: '', trim: true },
      name: { type: String, required: true, trim: true },
      phone: { type: String, required: true, trim: true },
      address: { type: String, default: '', trim: true },
    },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true, index: true },
    branchSnapshot: {
      name: { type: String, default: '', trim: true },
      address: { type: String, default: '', trim: true },
    },
    items: [
      {
        product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
        invexProductId: { type: String, required: true, trim: true },
        name: { type: String, required: true, trim: true },
        code: { type: String, default: '', trim: true },
        categoryId: { type: String, default: '', trim: true },
        quantity: { type: Number, required: true, min: 0.001 },
        saleUnit: {
          type: String,
          enum: ['piece', 'weight', 'head'],
          required: true,
        },
        weightUnit: { type: String, enum: ['kg', 'g'], required: false },
        basePrice: { type: Number, required: true, min: 0 },
        discountPercent: { type: Number, default: 0, min: 0 },
        unitPrice: { type: Number, required: true, min: 0 },
        lineTotal: { type: Number, required: true, min: 0 },
        stockSnapshot: { type: Number, required: true, min: 0 },
        bookingId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'ProductBooking',
          default: null,
        },
        reservationId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'EcommerceChannelReservation',
          default: null,
        },
      },
    ],
    subtotal: { type: Number, required: true, min: 0 },
    total: { type: Number, required: true, min: 0 },
    notes: { type: String, default: '', trim: true },
    paymentMethod: { type: String, default: '', trim: true },
    deliveryMethod: { type: String, default: '', trim: true },
    deliveryAddress: { type: String, default: '', trim: true },
    /** Where the online order originated: CRM (e.g. Novexa) or website storefront. */
    channel: {
      type: String,
      enum: ['crm', 'website'],
      default: 'crm',
      index: true,
    },
    createdBySnapshot: {
      id: { type: String, default: '', trim: true },
      name: { type: String, default: '', trim: true },
    },
    status: {
      type: String,
      enum: ['pending', 'preparing', 'ready', 'completed', 'cancelled'],
      default: 'pending',
      index: true,
    },
    statusHistory: [
      {
        status: {
          type: String,
          enum: ['pending', 'preparing', 'ready', 'completed', 'cancelled'],
          required: true,
        },
        changedAt: { type: Date, default: Date.now, required: true },
        actorId: { type: String, default: '', trim: true },
        actorName: { type: String, default: '', trim: true },
        source: { type: String, enum: ['crm', 'invex', 'website'], required: true },
        note: { type: String, default: '', trim: true },
      },
    ],
    invexOrderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
    invexInvoiceNumber: { type: Number, default: null },
    completedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
  },
  { timestamps: true }
);

onlineOrderSchema.index({ status: 1, createdAt: -1 });
onlineOrderSchema.index({ branch: 1, createdAt: -1 });
onlineOrderSchema.index({ channel: 1, createdAt: -1 });

export default mongoose.model('OnlineOrder', onlineOrderSchema);
