import {
  Component,
  Input,
  OnDestroy,
  OnInit,
  AfterViewInit,
} from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { AuthenticationService } from '@core/services/authentication.service';
import { Branch, Order } from '@core/models/products.model';
import { canPickBranchRole, isCollector } from '@core/utils/role-utils';
import { TranslateService } from '@ngx-translate/core';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { BranchesServce } from '@shared/services/branches.service';
import {
  CollectionDueItem,
  CollectionsDashboardResponse,
  CollectionsService,
  CollectorPerformance,
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
import { PaginationData } from '@core/models/users-interfaces.model';
import * as Highcharts from 'highcharts';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-collections-dashboard',
  templateUrl: './collections-dashboard.component.html',
  styleUrls: ['./collections-dashboard.component.scss'],
})
export class CollectionsDashboardComponent implements OnInit, AfterViewInit, OnDestroy {
  @Input() asSection = false;

  loading = false;
  showPromisesPanel = false;

  branches: Branch[] = [];
  collectors: CollectorUser[] = [];
  selectedBranchId = '';
  selectedCollectorId = '';
  statusFilter = 'all';
  fromDate: Date | null = null;
  toDate: Date | null = null;

  isAdminView = false;
  isCollectorView = false;
  currentUserId = '';

  summary = {
    totalInstallments: 0,
    collected: 0,
    overdue: 0,
    dueSoon: 0,
    collectionRate: 0,
    unassignedOrdersCount: 0,
  };
  collectorRows: CollectorPerformance[] = [];
  monthly = {
    target: 0,
    collected: 0,
    series: [] as { key: string; label: string; target: number; collected: number }[],
  };
  overdueItems: CollectionDueItem[] = [];
  private overdueItemsRaw: CollectionDueItem[] = [];
  overduePageItems: CollectionDueItem[] = [];
  /** '' = API order; 'desc' = highest share first; 'asc' = lowest first */
  overdueShareSort: '' | 'asc' | 'desc' = '';
  readonly overduePerPage = 10;
  overduePagination: PaginationData = {
    currentPage: 1,
    nextPage: 0,
    prevPage: 0,
    totalCount: 0,
    totalPages: 0,
  };
  promisesToday: { count: number; items: CollectionDueItem[] } = { count: 0, items: [] };

  private chart?: Highcharts.Chart;
  private chartReady = false;
  private subs: Subscription[] = [];
  private readonly chartId = 'collections-target-chart';

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
    this.isAdminView =
      canPickBranchRole(u?.role) || u?.role === 'Branch Manager';
    if (this.isCollectorView) {
      this.selectedCollectorId = this.currentUserId;
    }
  }

  ngOnInit(): void {
    const now = new Date();
    // Wider default so overdue + recent collection history show up for demos
    this.fromDate = new Date(now.getFullYear(), now.getMonth() - 3, 1);
    this.toDate = now;

    if (this.isAdminView) {
      this.subs.push(
        this.branchesService.getBranchs({ page: 1, limit: 1000 }).subscribe({
          next: (res: any) => {
            this.branches = res?.branches || [];
          },
        })
      );
      this.subs.push(
        this.collections.listCollectors({ withWorkload: true }).subscribe({
          next: (res) => {
            this.collectors = res?.collectors || [];
          },
        })
      );
    }
    this.load();
  }

  ngAfterViewInit(): void {
    this.chartReady = true;
    setTimeout(() => this.renderChart(), 0);
  }

  load(): void {
    this.loading = true;
    const collectorId = this.isAdminView
      ? this.selectedCollectorId || undefined
      : this.currentUserId || undefined;

    this.subs.push(
      this.collections
        .getDashboard({
          collectorId,
          branchId: this.selectedBranchId || undefined,
          status: this.statusFilter,
          from: this.formatDate(this.fromDate),
          to: this.formatDate(this.toDate),
        })
        .subscribe({
          next: (res: CollectionsDashboardResponse) => {
            this.loading = false;
            this.summary = {
              totalInstallments: Number(res?.summary?.totalInstallments) || 0,
              collected: Number(res?.summary?.collected) || 0,
              overdue: Number(res?.summary?.overdue) || 0,
              dueSoon: Number(res?.summary?.dueSoon) || 0,
              collectionRate: Number(res?.summary?.collectionRate) || 0,
              unassignedOrdersCount: Number(res?.summary?.unassignedOrdersCount) || 0,
            };
            this.collectorRows = res?.collectors || [];
            this.monthly = res?.monthly || this.monthly;
            this.overdueItemsRaw = res?.overdueItems || [];
            this.overdueItems = this.sortOverdueItems(this.overdueItemsRaw);
            this.promisesToday = res?.promisesToday || { count: 0, items: [] };
            this.setOverduePage(1);
            setTimeout(() => this.renderChart(), 0);
          },
          error: () => {
            this.loading = false;
            this.notify.push(this.translate.instant('tr_unexpected_error_message'), 'error');
          },
        })
    );
  }

  applyFilters(): void {
    this.load();
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
            this.load();
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

  setOverduePage(page: number): void {
    const totalCount = this.overdueItems.length;
    const totalPages = Math.max(1, Math.ceil(totalCount / this.overduePerPage) || 0);
    const currentPage = Math.min(Math.max(1, Number(page) || 1), Math.max(1, totalPages));
    const start = (currentPage - 1) * this.overduePerPage;
    this.overduePageItems = this.overdueItems.slice(start, start + this.overduePerPage);
    this.overduePagination = {
      currentPage,
      nextPage: currentPage < totalPages ? currentPage + 1 : 0,
      prevPage: currentPage > 1 ? currentPage - 1 : 0,
      totalCount,
      totalPages: totalCount ? totalPages : 0,
    };
  }

  overduePaginationUpdate(page: number): void {
    this.setOverduePage(page);
  }

  toggleOverdueShareSort(): void {
    if (this.overdueShareSort === '') {
      this.overdueShareSort = 'desc';
    } else if (this.overdueShareSort === 'desc') {
      this.overdueShareSort = 'asc';
    } else {
      this.overdueShareSort = '';
    }
    this.overdueItems = this.sortOverdueItems(this.overdueItemsRaw);
    this.setOverduePage(1);
  }

  private sortOverdueItems(items: CollectionDueItem[]): CollectionDueItem[] {
    const list = [...(items || [])];
    if (this.overdueShareSort === 'desc') {
      list.sort((a, b) => (Number(b.remaining) || 0) - (Number(a.remaining) || 0));
    } else if (this.overdueShareSort === 'asc') {
      list.sort((a, b) => (Number(a.remaining) || 0) - (Number(b.remaining) || 0));
    }
    return list;
  }

  initials(name?: string): string {
    const parts = String(name || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!parts.length) return '—';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  statusLabelKey(status?: string): string {
    return 'tr_collections_perf_' + (status || 'low');
  }

  overdueStatusKey(status?: string): string {
    return status === 'severe'
      ? 'tr_collections_overdue_severe'
      : 'tr_collections_overdue_late';
  }

  /** Sum of remaining on all overdue rows (used for share %). */
  get overdueTotalRemaining(): number {
    return (this.overdueItems || []).reduce(
      (sum, item) => sum + (Number(item?.remaining) || 0),
      0
    );
  }

  /** Percentage of this overdue installment vs total overdue remaining. */
  overdueShareOfTotal(remaining?: number): number {
    const amount = Number(remaining) || 0;
    const total = this.overdueTotalRemaining;
    if (total <= 0 || amount <= 0) return 0;
    return Math.round((amount / total) * 1000) / 10;
  }

  rateRingStyle(): Record<string, string> {
    const pct = Math.max(0, Math.min(100, Number(this.summary.collectionRate) || 0));
    return {
      background: `conic-gradient(#6c5ce7 ${pct}%, #ebe6ff ${pct}% 100%)`,
    };
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
          if (ok) this.load();
        });
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
            this.load();
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

  togglePromises(): void {
    this.showPromisesPanel = !this.showPromisesPanel;
  }

  private formatDate(d: Date | null): string | undefined {
    if (!d || !(d instanceof Date) || isNaN(d.getTime())) return undefined;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  private renderChart(): void {
    if (!this.chartReady) return;
    const el = document.getElementById(this.chartId);
    if (!el) return;

    const categories = (this.monthly.series || []).map((s) => s.label);
    const targets = (this.monthly.series || []).map((s) => s.target);
    const collected = (this.monthly.series || []).map((s) => s.collected);

    if (this.chart) {
      this.chart.destroy();
      this.chart = undefined;
    }

    this.chart = Highcharts.chart(this.chartId, {
      chart: {
        type: 'column',
        backgroundColor: 'transparent',
        height: 260,
        style: { fontFamily: 'inherit' },
      },
      title: { text: undefined },
      credits: { enabled: false },
      legend: {
        align: 'center',
        verticalAlign: 'bottom',
        itemStyle: { fontWeight: '500', color: '#6b7280' },
      },
      xAxis: {
        categories,
        lineColor: '#e8e4f5',
        tickLength: 0,
        labels: { style: { color: '#9ca3af', fontSize: '11px' } },
      },
      yAxis: {
        min: 0,
        title: { text: undefined },
        gridLineColor: '#f0ecfa',
        labels: {
          style: { color: '#9ca3af', fontSize: '11px' },
          formatter: function () {
            const v = Number(this.value) || 0;
            if (v >= 1000) return (v / 1000).toFixed(v % 1000 === 0 ? 0 : 1) + 'k';
            return String(v);
          },
        },
      },
      tooltip: {
        shared: true,
        valueDecimals: 0,
        valuePrefix: 'EGP ',
      },
      plotOptions: {
        column: {
          borderWidth: 0,
          borderRadius: 4,
          groupPadding: 0.18,
          pointPadding: 0.08,
        },
      },
      series: [
        {
          type: 'column',
          name: this.translate.instant('tr_collections_target'),
          data: targets,
          color: '#c4b5fd',
        },
        {
          type: 'column',
          name: this.translate.instant('tr_collections_collected'),
          data: collected,
          color: '#34d399',
        },
      ],
    } as Highcharts.Options);
  }

  ngOnDestroy(): void {
    if (this.chart) {
      this.chart.destroy();
      this.chart = undefined;
    }
    this.subs.forEach((s) => s && s.unsubscribe());
  }
}
