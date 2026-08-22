import Branch from '../../DB/models/branch.model.js';
import StoreSettings from '../../DB/models/storeSettings.model.js';

const ONLINE_BRANCH_NAME = 'Online';

const getLatestSettingsDoc = () => StoreSettings.findOne().sort({ updatedAt: -1 });

/**
 * Ensure a branch named "Online" exists and is stored on store settings.
 * Used when catalog mode is online_only.
 */
export async function ensureOnlineBranch() {
  let settings = await getLatestSettingsDoc();
  if (!settings) {
    settings = await StoreSettings.create({ storeName: 'Store' });
  }

  if (settings.onlineBranchId) {
    const existing = await Branch.findById(settings.onlineBranchId);
    if (existing) return existing;
  }

  let branch = await Branch.findOne({ name: ONLINE_BRANCH_NAME });
  if (!branch) {
    branch = await Branch.create({
      name: ONLINE_BRANCH_NAME,
      storeAddress: 'Online storefront',
      rent: 0,
      employeesSalary: 0,
    });
  }

  settings.onlineBranchId = branch._id;
  await settings.save();
  return branch;
}

export { ONLINE_BRANCH_NAME };
