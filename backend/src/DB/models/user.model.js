import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true }, // hashed via hooks below
  /** Force user to change admin-created password on first login. */
  mustChangePassword: { type: Boolean, default: false },
  role: { type: String, required: true },
  locale: { type: String, enum: ['en', 'ar'], default: 'en' }, // 👈 added field
  branch: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Branch',
    required: false // optional; set to true if every user must belong to a branch
  },
}, { timestamps: true });

function looksHashed(pw) {
  // bcrypt hashes start with $2a$/$2b$/$2y$
  return typeof pw === 'string' && /^\$2[aby]\$/.test(pw);
}

userSchema.pre('save', async function hashPasswordOnSave(next) {
  try {
    if (!this.isModified('password')) return next();
    const raw = this.password;
    if (!raw) return next();
    if (looksHashed(raw)) return next();
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(String(raw), salt);
    return next();
  } catch (e) {
    return next(e);
  }
});

userSchema.pre('findOneAndUpdate', async function hashPasswordOnUpdate(next) {
  try {
    const update = this.getUpdate() || {};
    const pw = update?.password ?? update?.$set?.password;
    if (pw == null || pw === '') return next();
    if (looksHashed(pw)) return next();
    const salt = await bcrypt.genSalt(10);
    const hashed = await bcrypt.hash(String(pw), salt);
    if (update.password != null) {
      update.password = hashed;
    } else {
      update.$set = update.$set || {};
      update.$set.password = hashed;
    }
    this.setUpdate(update);
    return next();
  } catch (e) {
    return next(e);
  }
});

const User = mongoose.model('User', userSchema);
export default User;