import { User } from '@core/models/users-interfaces.model';
import { canPickBranchRole } from './role-utils';

/** Branch id for cash-drawer / expense recording from logged-in user. */
export function branchIdFromUser(user: User | null | undefined): string {
  const b = user?.branch as { _id?: string } | string | undefined;
  if (typeof b === 'string') return String(b).trim();
  if (b?._id) return String(b._id).trim();
  return '';
}

export interface ActorBranchContext {
  branchId: string | null;
  showBranchPicker: boolean;
}

/** Same rules as daily expense / drawer close branch selection. */
export function resolveActorBranchContext(
  actor: User | null | undefined,
  forcedBranchId?: string | null
): ActorBranchContext {
  const forced = forcedBranchId ? String(forcedBranchId).trim() : '';
  if (forced) {
    return { branchId: forced, showBranchPicker: false };
  }
  const role = actor?.role != null ? String(actor.role) : undefined;
  if (canPickBranchRole(role)) {
    return { branchId: null, showBranchPicker: true };
  }
  const bm = branchIdFromUser(actor);
  return { branchId: bm || null, showBranchPicker: false };
}
