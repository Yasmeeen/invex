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

/** Book/reserve on any product (all branches + warehouse). */
export function canBookAnyProduct(role: string | undefined | null): boolean {
  return canPickBranchRole(role) || isWarehouse(role) || isModerator(role);
}
