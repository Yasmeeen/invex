/** Roles that may pick any branch (same store-wide powers as Super Admin for branch filtering). */
export function canPickBranchRole(role: string | undefined | null): boolean {
  return role === 'Super Admin' || role === 'Co Admin';
}

export function isBranchManager(role: string | undefined | null): boolean {
  return role === 'Branch Manager';
}
