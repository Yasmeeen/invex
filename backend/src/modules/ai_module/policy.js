export const ROLES = {
  SUPER_ADMIN: 'Super Admin',
  CO_ADMIN: 'Co Admin',
  BRANCH_MANAGER: 'Branch Manager',
  CASHIER: 'Cashier',
  WAREHOUSE: 'Warehouse',
  MODERATOR: 'Moderator',
};

function norm(role) {
  return String(role || '').trim();
}

export function canUseProfit(role) {
  // Mirror frontend ProfitReportGuard: Co Admin / Branch Manager must not access profit report.
  const r = norm(role);
  return r !== ROLES.CO_ADMIN && r !== ROLES.BRANCH_MANAGER;
}

export function canUseReports(role) {
  // Vixa should match what users can see in UI quick actions.
  // - Cashier: allowed to ask about orders/invoices (sales summary) for their branch.
  // - Warehouse: must not see Vixa reports (per product request).
  const r = norm(role);
  return (
    r === ROLES.SUPER_ADMIN ||
    r === ROLES.CO_ADMIN ||
    r === ROLES.BRANCH_MANAGER ||
    r === ROLES.CASHIER
  );
}

export function canUseBookings(role) {
  // Bookings: admins + branch managers + moderator (bookings-only).
  const r = norm(role);
  return (
    r === ROLES.SUPER_ADMIN ||
    r === ROLES.CO_ADMIN ||
    r === ROLES.BRANCH_MANAGER ||
    r === ROLES.MODERATOR
  );
}

