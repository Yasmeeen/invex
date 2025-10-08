import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true }, // should be hashed in real apps
  role: { type: String, required: true },
  locale: { type: String, enum: ['en', 'ar'], default: 'en' }, // 👈 added field
  branch: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Branch',
    required: false // optional; set to true if every user must belong to a branch
  }
}, { timestamps: true });

const User = mongoose.model('User', userSchema);
export default User;