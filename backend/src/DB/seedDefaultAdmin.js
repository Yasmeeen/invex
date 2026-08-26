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
    // Default: مدينة نصر + التجمع الخامس (override first branch via env if needed).
    const primaryName = String(
      process.env.SEED_DEFAULT_BRANCH_NAME || 'مدينة نصر'
    ).trim();
    const primaryAddress = String(
      process.env.SEED_DEFAULT_BRANCH_ADDRESS || 'مدينة نصر، القاهرة'
    ).trim();
    branchDoc = await Branch.create({
      name: primaryName,
      storeAddress: primaryAddress,
    });

    const skipSecond =
      String(process.env.SEED_SKIP_SECOND_BRANCH || '').toLowerCase() === 'true';
    if (!skipSecond) {
      const secondName = String(
        process.env.SEED_SECOND_BRANCH_NAME || 'التجمع الخامس'
      ).trim();
      const secondAddress = String(
        process.env.SEED_SECOND_BRANCH_ADDRESS || 'التجمع الخامس، القاهرة'
      ).trim();
      const existingSecond = await Branch.findOne({ name: secondName });
      if (!existingSecond) {
        await Branch.create({
          name: secondName,
          storeAddress: secondAddress,
        });
      }
    }
  }

  await User.create({
    name,
    email,
    password,
    mustChangePassword: true,
    role: 'Super Admin',
    locale: 'en',
    branch: branchDoc._id,
  });

  console.log(`✅ Seeded default Super Admin: ${email} (change password in production)`);
}
