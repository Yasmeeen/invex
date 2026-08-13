import { Branch } from '@core/models/products.model';

/** Visible from (opening date − 1 day) through 7 calendar days. */
export const OPENING_CELEBRATION_LEAD_DAYS = 1;
export const OPENING_CELEBRATION_DURATION_DAYS = 7;

export function startOfLocalDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

export function parseOpeningDate(value: string | Date | null | undefined): Date | null {
  if (value == null || value === '') {
    return null;
  }
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) {
    return null;
  }
  return startOfLocalDay(d);
}

export function openingDateStorageKey(value: string | Date | null | undefined): string {
  const d = parseOpeningDate(value);
  if (!d) {
    return '';
  }
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function isBranchInCelebrationWindow(
  openingDate: string | Date | null | undefined,
  now: Date = new Date()
): boolean {
  const open = parseOpeningDate(openingDate);
  if (!open) {
    return false;
  }
  const start = new Date(open);
  start.setDate(start.getDate() - OPENING_CELEBRATION_LEAD_DAYS);
  const end = new Date(start);
  end.setDate(end.getDate() + OPENING_CELEBRATION_DURATION_DAYS);
  const today = startOfLocalDay(now);
  return today >= start && today < end;
}

export function pickCelebratingBranch(branches: Branch[], now: Date = new Date()): Branch | null {
  const active = (branches || []).filter((b) => isBranchInCelebrationWindow(b?.openingDate, now));
  if (!active.length) {
    return null;
  }
  const today = startOfLocalDay(now).getTime();
  active.sort((a, b) => {
    const da = Math.abs((parseOpeningDate(a.openingDate)?.getTime() || 0) - today);
    const db = Math.abs((parseOpeningDate(b.openingDate)?.getTime() || 0) - today);
    return da - db;
  });
  return active[0];
}

export function openingCelebrationStorageKey(
  kind: 'popup' | 'banner',
  branch: Branch | null | undefined
): string | null {
  if (!branch?._id) {
    return null;
  }
  const day = openingDateStorageKey(branch.openingDate);
  if (!day) {
    return null;
  }
  return `invex-opening-${kind}-${branch._id}-${day}`;
}
