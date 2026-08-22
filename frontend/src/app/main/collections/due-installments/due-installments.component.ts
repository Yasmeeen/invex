import { Component, OnDestroy, OnInit } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { AuthenticationService } from '@core/services/authentication.service';
import { Branch, Order } from '@core/models/products.model';
import { PaginationData } from '@core/models/users-interfaces.model';
import { canPickBranchRole, isCollector } from '@core/utils/role-utils';
import { TranslateService } from '@ngx-translate/core';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { BranchesServce } from '@shared/services/branches.service';
import {
  CollectionDueItem,
  CollectionsService,
  CollectorUser,
} from '@shared/services/collections.service';
import { OrdersSerivce } from '@shared/services/orders.service';
import { PayOrderDialogComponent } from '../../orders/pay-order-dialog/pay-order-dialog.component';
import {
  PromiseToPayDialogComponent,
  PromiseToPayDialogResult,
} from '@shared/components/promise-to-pay-dialog/promise-to-pay-dialog.component';
import {
  AssignCollectorDialogComponent,
  AssignCollectorDialogResult,
} from '@shared/components/assign-collector-dialog/assign-collector-dialog.component';
import { Subscription } from 'rxjs';

/** Sentinel value for collector filter: invoices with no effective collector. */
const UNASSIGNED_COLLECTOR = 'unassigned';

@Component({
  selector: 'app-due-installments',
  templateUrl: './due-installments.component.html',
  styleUrls: [
    '../collections-dashboard/collections-dashboard.component.scss',
    './due-installments.component.scss',
  ],
})
export class DueInstallmentsComponent implements OnInit, OnDestroy {
  loading = false;

  branches: Branch[] = [];
  collectors: CollectorUser[] = [];
  selectedBranchId = '';
  selectedCollectorId = '';
  statusFilter: 'all' | 'due' | 'overdue' | 'promised' = 'due';
  fromDate: Date | null = null;
  toDate: Date | null = null;
  promiseFromDate: Date | null = null;
  promiseToDate: Date | null = null;

  /** '' = date order; 'desc' = highest remaining first; 'asc' = lowest first */
  remainingSort: '' | 'asc' | 'desc' = '';

  isAdminView = false;
  isCollectorView = false;
  currentUserId = '';

  readonly unassignedCollectorValue = UNASSIGNED_COLLECTOR;

  items: CollectionDueItem[] = [];
  readonly perPage = 10;
  page = 1;
  pagination: PaginationData = {
    currentPage: 1,
    nextPage: 0,
    prevPage: 0,
    totalCount: 0,
    totalPages: 0,
  };
  summary = {
    dueCount: 0,
    overdueCount: 0,
    promisedCount: 0,
    dueAmount: 0,
  };

  private subs: Subscription[] = [];

  constructor(
    private collections: CollectionsService,
    private orders: OrdersSerivce,
    private auth: AuthenticationService,
    private branchesService: BranchesServce,
    private dialog: MatDialog,
    private notify: AppNotificationService,
    private translate: TranslateService,
    private router: Router
  ) {
    const u = this.auth.getUserFromLocalStorage();
    this.currentUserId = String(u?._id || '');
    this.isCollectorView = isCollector(u?.role);
    this.isAdminView = canPickBranchRole(u?.role) || u?.role === 'Branch Manager';
    if (this.isCollectorView) {
      this.selectedCollectorId = this.currentUserId;
    }
  }

  ngOnInit(): void {
    const now = new Date();
    this.fromDate = new Date(now.getFullYear(), now.getMonth(), 1);
    this.toDate = new Date(now.getFullYear(), now.getMonth() + 2, 0);

    if (this.isAdminView) {
      this.subs.push(
        this.branchesService.getBranchs({ page: 1, limit: 1000 }).subscribe({
          next: (res: any) => {
            this.branches = res?.branches || [];
          },
        })
      );
      this.loadCollectors();
    }
    this.load(1);
  }

  get showDaysOverdue(): boolean {
    return this.statusFilter === 'overdue' || this.statusFilter === 'all';
  }

  collectorOptionLabel(c: CollectorUser): string {
    const name = c?.name || '—';
    const n = Number(c?.openOrdersCount);
    if (!Number.isFinite(n)) return name;
    return `${name} (${n})`;
  }

  private loadCollectors(): void {
    this.subs.push(
      this.collections.listCollectors({ withWorkload: true }).subscribe({
        next: (res) => {
          this.collectors = res?.collectors || [];
        },
      })
    );
  }

  load(page = 1): void {
    this.loading = true;
    this.page = Math.max(1, Number(page) || 1);
    const collectorId = this.isAdminView
      ? this.selectedCollectorId || undefined
      : this.currentUserId || undefined;

    this.subs.push(
      this.collections
        .listDue({
          collectorId,
          branchId: this.isAdminView ? this.selectedBranchId || undefined : undefined,
          status: this.statusFilter,
          from: this.formatDate(this.fromDate),
          to: this.formatDate(this.toDate),
          promiseFrom: this.formatDate(this.promiseFromDate),
          promiseTo: this.formatDate(this.promiseToDate),
          page: this.page,
          limit: this.perPage,
          sortBy: this.remainingSort ? 'remaining' : undefined,
          sortDir: this.remainingSort || undefined,
        })
        .subscribe({
          next: (res) => {
            this.loading = false;
            this.items = res?.items || [];
            this.summary = res?.summary || this.summary;
            const meta = res?.meta || {};
            this.pagination = {
              currentPage: Number(meta.currentPage) || this.page,
              nextPage: Number(meta.nextPage) || 0,
              prevPage: Number(meta.prevPage) || 0,
              totalCount: Number(meta.totalCount) || 0,
              totalPages: Number(meta.totalPages) || 0,
            };
          },
          error: () => {
            this.loading = false;
            this.notify.push(this.translate.instant('tr_unexpected_error_message'), 'error');
          },
        })
    );
  }

  applyFilters(): void {
    this.load(1);
  }

  toggleRemainingSort(): void {
    if (this.remainingSort === '') {
      this.remainingSort = 'desc';
    } else if (this.remainingSort === 'desc') {
      this.remainingSort = 'asc';
    } else {
      this.remainingSort = '';
    }
    this.load(1);
  }

  statusLabelKey(status?: string): string {
    if (status === 'overdue') return 'tr_collections_status_overdue';
    if (status === 'promised') return 'tr_collections_status_promised';
    return 'tr_collections_status_due';
  }

  shareOfTotal(remaining?: number): number {
    const amount = Number(remaining) || 0;
    const total = Number(this.summary?.dueAmount) || 0;
    if (total <= 0 || amount <= 0) return 0;
    return Math.round((amount / total) * 1000) / 10;
  }

  paginationUpdate(page: number): void {
    this.load(page);
  }

  openClient(item: CollectionDueItem): void {
    if (!item?.clientId) return;
    this.router.navigate(['/clients', item.clientId, 'history']);
  }

  openPay(item: CollectionDueItem): void {
    this.orders.getOrder(item.orderId).subscribe({
      next: (order: any) => {
        const ref = this.dialog.open(PayOrderDialogComponent, {
          width: '520px',
          maxWidth: '96vw',
          panelClass: 'pay-order-dialog-panel',
          backdropClass: 'pay-order-dialog-backdrop',
          data: {
            order: order as Order,
            installmentId: item.installmentId,
          },
          disableClose: true,
        });
        ref.afterClosed().subscribe((ok) => {
          if (ok) this.load(this.page);
        });
      },
      error: () => {
        this.notify.push(this.translate.instant('tr_unexpected_error_message'), 'error');
      },
    });
  }

  assignCollector(item: CollectionDueItem): void {
    if (!this.isAdminView || !item?.orderId) return;

    const openDialog = (collectors: CollectorUser[]) => {
      const ref = this.dialog.open(AssignCollectorDialogComponent, {
        width: '440px',
        maxWidth: '95vw',
        panelClass: 'assign-collector-dialog-panel',
        backdropClass: 'assign-collector-dialog-backdrop',
        data: {
          orderNumber: item.orderNumber,
          clientName: item.clientName,
          collectorId: item.collectorId || null,
          collectors,
        },
        disableClose: true,
      });
      ref.afterClosed().subscribe((result: AssignCollectorDialogResult | undefined) => {
        if (result === false || result === undefined) return;
        this.collections.assignOrderCollector(String(item.orderId), result).subscribe({
          next: () => {
            this.notify.push(this.translate.instant('tr_assign_collector_ok'), 'success');
            this.loadCollectors();
            this.load(this.page);
          },
          error: (err) => {
            const msg =
              err?.error?.error ||
              err?.error?.message ||
              this.translate.instant('tr_unexpected_error_message');
            this.notify.push(msg, 'error');
          },
        });
      });
    };

    if (this.collectors.length) {
      openDialog(this.collectors);
      return;
    }
    this.collections.listCollectors({ withWorkload: true }).subscribe({
      next: (res) => {
        this.collectors = res?.collectors || [];
        openDialog(this.collectors);
      },
      error: () => {
        this.notify.push(this.translate.instant('tr_unexpected_error_message'), 'error');
      },
    });
  }

  setPromise(item: CollectionDueItem): void {
    const ref = this.dialog.open(PromiseToPayDialogComponent, {
      width: '440px',
      maxWidth: '95vw',
      panelClass: 'promise-to-pay-dialog-panel',
      backdropClass: 'promise-to-pay-dialog-backdrop',
      data: {
        promiseToPayAt: item.promiseToPayAt || null,
        orderNumber: item.orderNumber,
        installmentSequence: item.sequence,
        promiseToPayHistory: item.promiseToPayHistory || [],
      },
      disableClose: true,
    });

    ref.afterClosed().subscribe((result: PromiseToPayDialogResult | undefined) => {
      if (result === false || result === undefined) return;
      this.orders
        .setInstallmentPromise(String(item.orderId), String(item.installmentId), {
          promiseToPayAt: result,
        })
        .subscribe({
          next: () => {
            this.notify.push(this.translate.instant('tr_promise_to_pay_ok'), 'success');
            this.load(this.page);
          },
          error: (err) => {
            const msg =
              err?.error?.error ||
              err?.error?.message ||
              this.translate.instant('tr_unexpected_error_message');
            this.notify.push(msg, 'error');
          },
        });
    });
  }

  private formatDate(d: Date | null): string | undefined {
    if (!d || !(d instanceof Date) || isNaN(d.getTime())) return undefined;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s && s.unsubscribe());
  }
}
