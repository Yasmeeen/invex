/** Legacy DB value — treat same as Warehouse. */
export const LEGACY_OPERATION_MANAGER = 'Operation Manager';

/** Roles that may pick any branch (same store-wide powers as Super Admin for branch filtering). */
export function canPickBranchRole(role: string | undefined | null): boolean {
  return role === 'Super Admin' || role === 'Co Admin' || role === 'Admin';
}

export function isBranchManager(role: string | undefined | null): boolean {
  return role === 'Branch Manager';
}

/** Central / ops role (renamed from Operation Manager). */
export function isWarehouse(role: string | undefined | null): boolean {
  return role === 'Warehouse' || role === LEGACY_OPERATION_MANAGER;
}

/** View-only on catalog + inventory; may book products only (no create/edit/delete product). */
export function isModerator(role: string | undefined | null): boolean {
  return role === 'Moderator';
}

/** Collects installments across any branch (not tied to one store). */
export function isCollector(role: string | undefined | null): boolean {
  return role === 'Collector';
}

/** Roles stored without a fixed branch — see data across all branches. */
export function isBranchlessUserRole(role: string | undefined | null): boolean {
  return canPickBranchRole(role) || isWarehouse(role) || isModerator(role) || isCollector(role);
}

/** Book/reserve on any product (all branches + warehouse). Warehouse cannot book. */
export function canBookAnyProduct(role: string | undefined | null): boolean {
  return canPickBranchRole(role) || isModerator(role);
}

/** Roles Super Admin can hide cost / purchase price from. Super Admin is never listed. */
export const COST_PRICE_RESTRICTABLE_ROLES = [
  'Co Admin',
  'Branch Manager',
  'Cashier',
  'Collector',
  'Warehouse',
  'Moderator',
] as const;

export type CostPriceRestrictableRole = typeof COST_PRICE_RESTRICTABLE_ROLES[number];

export const DEFAULT_ROLES_HIDDEN_FROM_COST_PRICE: string[] = [...COST_PRICE_RESTRICTABLE_ROLES];

function canonicalCostPriceRole(role: string | undefined | null): string {
  const r = String(role || '').trim();
  if (r === LEGACY_OPERATION_MANAGER) return 'Warehouse';
  return r;
}

export function normalizeRolesHiddenFromCostPrice(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [...DEFAULT_ROLES_HIDDEN_FROM_COST_PRICE];
  }
  const allowed = new Set<string>(COST_PRICE_RESTRICTABLE_ROLES);
  const out: string[] = [];
  for (const item of raw) {
    const role = canonicalCostPriceRole(String(item || ''));
    if (!allowed.has(role) || out.includes(role)) continue;
    out.push(role);
  }
  return out;
}

/** Super Admin always sees cost. Others see it only if their role is not in the hidden list. */
export function canSeeCostPrice(
  role: string | undefined | null,
  hiddenRolesRaw: unknown
): boolean {
  const r = canonicalCostPriceRole(role);
  if (r === 'Super Admin' || r === 'Admin') return true;
  const hidden = new Set(normalizeRolesHiddenFromCostPrice(hiddenRolesRaw));
  return !hidden.has(r);
}

export function isCashier(role: string | undefined | null): boolean {
  return role === 'Cashier';
}
