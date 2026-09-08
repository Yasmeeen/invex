import mongoose from 'mongoose';

const farmAnimalSchema = new mongoose.Schema(
  {
    serial: { type: String, required: true, unique: true, trim: true, uppercase: true },
    serialNumber: { type: Number, required: true, unique: true, min: 1 },
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      index: true,
    },
    purchaseRequest: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ProductPurchaseRequest',
      default: null,
      index: true,
    },
    acquiredShare: { type: Number, required: true, min: 0.25, max: 1 },
    remainingShare: { type: Number, required: true, min: 0, max: 1 },
    status: {
      type: String,
      enum: ['available', 'reserved', 'sold', 'slaughtered', 'removed'],
      default: 'available',
      index: true,
    },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', default: null, index: true },
    inWarehouse: { type: Boolean, default: false, index: true },
    factory: { type: mongoose.Schema.Types.ObjectId, ref: 'Factory', default: null, index: true },
    purchaseWeightKg: { type: Number, default: 0, min: 0 },
    currentWeightKg: { type: Number, default: 0, min: 0 },
    costPerKg: { type: Number, default: 0, min: 0 },
    acquisitionCost: { type: Number, default: 0, min: 0 },
    booking: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductBooking', default: null, index: true },
    reservedForType: { type: String, enum: ['client', 'supplier'], default: undefined },
    reservedForId: { type: mongoose.Schema.Types.ObjectId, default: null },
    reservedAt: { type: Date, default: null },
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null, index: true },
    soldAt: { type: Date, default: null },
    slaughterTicket: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SlaughterTicket',
      default: null,
      index: true,
    },
    slaughteredAt: { type: Date, default: null },
    notes: { type: String, default: '', trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

farmAnimalSchema.index({ product: 1, status: 1, remainingShare: 1 });
farmAnimalSchema.index({ branch: 1, inWarehouse: 1, factory: 1, status: 1 });
farmAnimalSchema.index(
  { purchaseRequest: 1, product: 1, serialNumber: 1 },
  { unique: true, partialFilterExpression: { purchaseRequest: { $type: 'objectId' } } }
);

const FarmAnimal = mongoose.model('FarmAnimal', farmAnimalSchema);
export default FarmAnimal;
