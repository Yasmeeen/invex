import User from './models/user.model.js';
import Branch from './models/branch.model.js';

/**
 * First boot on an empty DB: create a default branch (if needed) and one Super Admin.
 * Credentials can be overridden via env; change password after first login in production.
 */
export async function seedDefaultSuperAdmin() {
  const userCount = await User.countDocuments();
  if (userCount > 0) {
    return;
  }

  const email = String(
    process.env.SEED_SUPER_ADMIN_EMAIL || 'cto.innovate@gmail.com'
  )
    .trim()
    .toLowerCase();
  const password =
    process.env.SEED_SUPER_ADMIN_PASSWORD || 'asdasd123A!';
  const name = String(process.env.SEED_SUPER_ADMIN_NAME || 'Super Admin').trim();

  let branchDoc = await Branch.findOne().sort({ createdAt: 1 });
  if (!branchDoc) {
    branchDoc = await Branch.create({
      name: String(process.env.SEED_DEFAULT_BRANCH_NAME || 'Main').trim(),
      storeAddress: String(
        process.env.SEED_DEFAULT_BRANCH_ADDRESS || '—'
      ).trim(),
    });
  }

  await User.create({
    name,
    email,
    password,
    role: 'Super Admin',
    locale: 'en',
    branch: branchDoc._id,
  });

  console.log(`✅ Seeded default Super Admin: ${email} (change password in production)`);
}
