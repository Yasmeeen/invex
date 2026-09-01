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

export function canUseVixa(role) {
  const r = norm(role);
  if (r === ROLES.CASHIER || r === ROLES.WAREHOUSE || r === 'Operation Manager') return false;
  return true;
}

export function canUseReports(role) {
  // Vixa should match what users can see in UI quick actions.
  // - Cashier / Warehouse: no Vixa.
  const r = norm(role);
  return r === ROLES.SUPER_ADMIN || r === ROLES.CO_ADMIN || r === ROLES.BRANCH_MANAGER;
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

