import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema(
  {
    type: { type: String, required: true, index: true }, // e.g. booking_created
    title: { type: String, default: '', trim: true },
    body: { type: String, default: '', trim: true },
    data: { type: Object, default: {} },
    recipients: [
      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    ],
    readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true }],
  },
  { timestamps: true }
);

notificationSchema.index({ recipients: 1, createdAt: -1 });
notificationSchema.index({ recipients: 1, readBy: 1, createdAt: -1 });

const Notification = mongoose.model('Notification', notificationSchema);
export default Notification;

