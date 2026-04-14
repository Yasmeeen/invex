export const ROLES = {
  SUPER_ADMIN: 'Super Admin',
  CO_ADMIN: 'Co Admin',
  BRANCH_MANAGER: 'Branch Manager',
  CASHIER: 'Cashier',
  WAREHOUSE: 'Warehouse',
  MODERATOR: 'Moderator',
};

export function canUseProfit(role) {
  // Mirror frontend ProfitReportGuard: Co Admin / Branch Manager must not access profit report.
  return role !== ROLES.CO_ADMIN && role !== ROLES.BRANCH_MANAGER;
}

export function canUseReports(role) {
  // Main routing allows reports for Super Admin, Co Admin, Branch Manager, Warehouse.
  return (
    role === ROLES.SUPER_ADMIN ||
    role === ROLES.CO_ADMIN ||
    role === ROLES.BRANCH_MANAGER ||
    role === ROLES.WAREHOUSE
  );
}

export function canUseBookings(role) {
  // Bookings exist in reports for admin-like roles; allow warehouse too.
  return canUseReports(role);
}

