import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, Observable, Subscription, interval, of } from 'rxjs';
import { catchError, map, switchMap, tap } from 'rxjs/operators';
import { AuthenticationService } from '@core/services/authentication.service';
import { OnlineOrdersService } from './online-orders.service';
import { RealtimeNotificationsService } from './realtime-notifications.service';

const ONLINE_ORDER_ROLES = new Set(['Super Admin', 'Co Admin', 'Branch Manager', 'Cashier']);
const BRANCH_SCOPED_ROLES = new Set(['Branch Manager', 'Cashier']);
const POLL_MS = 30000;
/** Banner turns red when the oldest pending order has waited this long. */
export const ONLINE_ORDERS_OVERDUE_MS = 15 * 60 * 1000;

export interface OnlineOrdersAlertState {
  count: number;
  oldestPendingAt: string | null;
}

/**
 * Tracks pending CRM/online orders for the global top banner.
 * Polls periodically and refreshes immediately on realtime `online-order:new`.
 *
 * Branch Manager / Cashier are always scoped to their own branch (server-enforced).
 * Super Admin / Co Admin may optionally scope via setScopeBranchId (e.g. cashier branch picker).
 */
@Injectable({ providedIn: 'root' })
export class OnlineOrdersAlertService implements OnDestroy {
  private readonly stateSubject = new BehaviorSubject<OnlineOrdersAlertState>({
    count: 0,
    oldestPendingAt: null,
  });
  readonly state$ = this.stateSubject.asObservable();
  readonly pendingCount$: Observable<number> = this.state$.pipe(map((s) => s.count));

  /** Optional branch filter for Super Admin / Co Admin (cashier selected branch). */
  private scopeBranchId: string | null = null;

  private pollSub?: Subscription;
  private realtimeSub?: Subscription;
  private started = false;

  constructor(
    private onlineOrders: OnlineOrdersService,
    private auth: AuthenticationService,
    private realtime: RealtimeNotificationsService
  ) {}

  get pendingCount(): number {
    return this.stateSubject.value.count;
  }

  get oldestPendingAt(): string | null {
    return this.stateSubject.value.oldestPendingAt;
  }

  get canSeeBanner(): boolean {
    const role = String(this.auth.getUserFromLocalStorage()?.role || '');
    return ONLINE_ORDER_ROLES.has(role);
  }

  /** True when oldest pending order is older than 15 minutes. */
  isOverdue(nowMs: number = Date.now()): boolean {
    const raw = this.stateSubject.value.oldestPendingAt;
    if (!raw || this.stateSubject.value.count <= 0) {
      return false;
    }
    const ts = new Date(raw).getTime();
    if (!Number.isFinite(ts)) {
      return false;
    }
    return nowMs - ts >= ONLINE_ORDERS_OVERDUE_MS;
  }

  /**
   * Scope banner counts to a branch (used by cashier for Super Admin / Co Admin).
   * Pass null to clear and show all branches again.
   * No-op for Branch Manager / Cashier — their branch is always taken from the user record.
   */
  setScopeBranchId(branchId: string | null | undefined): void {
    const role = String(this.auth.getUserFromLocalStorage()?.role || '');
    if (BRANCH_SCOPED_ROLES.has(role)) {
      return;
    }
    const next = branchId ? String(branchId).trim() : null;
    if (this.scopeBranchId === next) {
      return;
    }
    this.scopeBranchId = next;
    if (this.started) {
      this.refresh();
    }
  }

  clearScopeBranchId(): void {
    this.setScopeBranchId(null);
  }

  start(): void {
    if (this.started || !this.canSeeBanner) {
      return;
    }
    this.started = true;
    this.refresh();
    this.pollSub = interval(POLL_MS)
      .pipe(switchMap(() => this.fetchCount$()))
      .subscribe();
    this.realtimeSub = this.realtime.onlineOrderNew$.subscribe((payload) => {
      // Ignore realtime bumps for other branches when the banner is branch-scoped.
      const scoped = this.resolveRequestBranchId();
      if (scoped && payload?.branchId && String(payload.branchId) !== String(scoped)) {
        return;
      }
      this.refresh();
    });
  }

  stop(): void {
    this.started = false;
    this.pollSub?.unsubscribe();
    this.realtimeSub?.unsubscribe();
    this.pollSub = undefined;
    this.realtimeSub = undefined;
  }

  refresh(): void {
    if (!this.canSeeBanner) {
      this.stateSubject.next({ count: 0, oldestPendingAt: null });
      return;
    }
    this.fetchCount$().subscribe();
  }

  ngOnDestroy(): void {
    this.stop();
  }

  private resolveRequestBranchId(): string | null {
    const user = this.auth.getUserFromLocalStorage();
    const role = String(user?.role || '');
    if (BRANCH_SCOPED_ROLES.has(role)) {
      const branch = user?.branch;
      if (!branch) return null;
      return typeof branch === 'string' ? String(branch).trim() : String(branch._id || '').trim() || null;
    }
    return this.scopeBranchId;
  }

  private fetchCount$() {
    const branchId = this.resolveRequestBranchId();
    return this.onlineOrders.pendingSummary(branchId || undefined).pipe(
      tap((res) => {
        const count = Math.max(0, Number(res?.count) || 0);
        const oldestPendingAt =
          count > 0 && res?.oldestPendingAt ? String(res.oldestPendingAt) : null;
        this.stateSubject.next({ count, oldestPendingAt });
      }),
      catchError(() => {
        return of(null);
      })
    );
  }
}
