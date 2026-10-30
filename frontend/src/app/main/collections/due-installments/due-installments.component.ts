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
import { saveAs } from 'file-saver';
import * as ExcelJS from 'exceljs';
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
  exporting = false;

  branches: Branch[] = [];
  collectors: CollectorUser[] = [];
  selectedBranchId = '';
  selectedCollectorId = '';
  statusFilter: 'all' | 'due' | 'overdue' | 'promised' = 'due';
  /** all = every overdue installment; earliest = oldest overdue row per client. */
  overdueGrouping: 'all' | 'earliest' = 'earliest';
  fromDate: Date | null = null;
  toDate: Date | null = null;
  promiseFromDate: Date | null = null;
  promiseToDate: Date | null = null;
  installmentSaleNumberTerm = '';
  private installmentSaleNumberTimeout: ReturnType<typeof setTimeout> | null = null;

  /** '' = date order; 'desc' = highest remaining first; 'asc' = lowest first */
  remainingSort: '' | 'asc' | 'desc' = '';
  /** '' = date order; 'desc' / 'asc' by installment sale number */
  saleNumberSort: '' | 'asc' | 'desc' = '';

  isAdminView = false;
  isCollectorView = false;
  currentUserId = '';
  private currentUserName = '';

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
    this.currentUserName = String(u?.name || '').trim();
    this.isCollectorView = isCollector(u?.role);
    this.isAdminView = canPickBranchRole(u?.role) || u?.role === 'Branch Manager';
    if (this.isCollectorView) {
      this.selectedCollectorId = this.currentUserId;
    }
  }

  ngOnInit(): void {
    const now = new Date();
    this.fromDate = new Date(now.getFullYear(), now.getMonth(), 1);
    this.toDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);

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

  /** A named collector is selected (not "all" and not "unassigned"). */
  get isNamedCollectorFilter(): boolean {
    const id = (this.selectedCollectorId || '').trim();
    return !!id && id !== this.unassignedCollectorValue;
  }

  /** Hide the collector column when every row belongs to one collector. */
  get showCollectorColumn(): boolean {
    return this.isAdminView && !this.isNamedCollectorFilter;
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

    this.subs.push(
      this.collections.listDue(this.dueQueryParams(this.page, this.perPage)).subscribe({
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

  onStatusChange(): void {
    this.applyFilters();
  }

  onOverdueGroupingChange(): void {
    if (this.overdueGrouping === 'earliest') {
      this.statusFilter = 'overdue';
    }
    this.applyFilters();
  }

  clearDateFilters(): void {
    this.fromDate = null;
    this.toDate = null;
    this.promiseFromDate = null;
    this.promiseToDate = null;
    this.load(1);
  }

  filterByInstallmentSaleNumber(event?: Event): void {
    if (this.installmentSaleNumberTimeout) {
      clearTimeout(this.installmentSaleNumberTimeout);
    }
    this.installmentSaleNumberTimeout = setTimeout(() => {
      const raw = (
        (event?.target as HTMLInputElement | null)?.value ??
        this.installmentSaleNumberTerm ??
        ''
      )
        .toString()
        .trim();
      this.installmentSaleNumberTerm = raw;
      if (raw !== '') {
        const n = Math.floor(Number(raw));
        if (!Number.isFinite(n) || n <= 0) {
          return;
        }
      }
      this.load(1);
    }, 500);
  }

  toggleRemainingSort(): void {
    this.saleNumberSort = '';
    if (this.remainingSort === '') {
      this.remainingSort = 'desc';
    } else if (this.remainingSort === 'desc') {
      this.remainingSort = 'asc';
    } else {
      this.remainingSort = '';
    }
    this.load(1);
  }

  toggleSaleNumberSort(): void {
    this.remainingSort = '';
    if (this.saleNumberSort === '') {
      this.saleNumberSort = 'desc';
    } else if (this.saleNumberSort === 'desc') {
      this.saleNumberSort = 'asc';
    } else {
      this.saleNumberSort = '';
    }
    this.load(1);
  }

  clientPhone(item: CollectionDueItem): string {
    const phone = String(item?.clientPhoneNumber || '').trim();
    if (!phone || phone === '00') return '';
    return phone;
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

  async exportExcel(): Promise<void> {
    if (this.exporting || !this.pagination.totalCount) return;
    this.exporting = true;
    try {
      const items = await this.fetchAllDueItems();
      if (!items.length) {
        this.notify.push(this.translate.instant('tr_collections_empty'), 'error');
        return;
      }
      await this.writeDueWorkbook(items);
    } catch {
      this.notify.push(this.translate.instant('tr_unexpected_error_message'), 'error');
    } finally {
      this.exporting = false;
    }
  }

  private dueQueryParams(page: number, limit: number) {
    const collectorId = this.isAdminView
      ? this.selectedCollectorId || undefined
      : this.currentUserId || undefined;

    const saleRaw = (this.installmentSaleNumberTerm ?? '').toString().trim();
    let installmentSaleNumber: number | undefined;
    if (saleRaw !== '') {
      const n = Math.floor(Number(saleRaw));
      if (Number.isFinite(n) && n > 0) {
        installmentSaleNumber = n;
      }
    }

    let sortBy: string | undefined;
    let sortDir: 'asc' | 'desc' | undefined;
    if (this.saleNumberSort) {
      sortBy = 'saleNumber';
      sortDir = this.saleNumberSort;
    } else if (this.remainingSort) {
      sortBy = 'remaining';
      sortDir = this.remainingSort;
    }

    return {
      collectorId,
      branchId: this.isAdminView ? this.selectedBranchId || undefined : undefined,
      status: this.statusFilter,
      from: this.formatDate(this.fromDate),
      to: this.formatDate(this.toDate),
      promiseFrom: this.formatDate(this.promiseFromDate),
      promiseTo: this.formatDate(this.promiseToDate),
      installmentSaleNumber,
      overdueGrouping:
        this.statusFilter === 'overdue' ? this.overdueGrouping : undefined,
      page,
      limit,
      sortBy,
      sortDir,
    };
  }

  private async fetchAllDueItems(): Promise<CollectionDueItem[]> {
    const limit = 200;
    const first = await this.collections.listDue(this.dueQueryParams(1, limit)).toPromise();
    const items = [...(first?.items || [])];
    const totalPages = Math.max(1, Number(first?.meta?.totalPages) || 1);
    for (let page = 2; page <= totalPages; page++) {
      const res = await this.collections.listDue(this.dueQueryParams(page, limit)).toPromise();
      items.push(...(res?.items || []));
    }
    return items;
  }

  private async writeDueWorkbook(items: CollectionDueItem[]): Promise<void> {
    const showCollector = this.showCollectorColumn;
    const showDays = this.showDaysOverdue;
    const t = (key: string) => this.translate.instant(key);
    const headers: string[] = [
      t('tr_client_name'),
      t('tr_installment_sale_number'),
      t('tr_client_phone'),
    ];
    if (showCollector) headers.push(t('tr_collector'));
    headers.push(t('tr_installment_due_date'));
    if (showDays) {
      headers.push(t('tr_collections_days_overdue'));
      headers.push(t('tr_overdue_installments_col'));
    }
    headers.push(t('tr_remaining'), t('tr_minimum_collection'), t('tr_status'));

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'INVEX';
    const isAr = String(this.translate.currentLang || '').toLowerCase().startsWith('ar');
    const sheetName = String(t('tr_due_installments_title') || 'Due').slice(0, 31);
    const ws = workbook.addWorksheet(sheetName);
    ws.views = [{ state: 'frozen', ySplit: 1, rightToLeft: isAr }];
    ws.addRow(headers);

    const headerRow = ws.getRow(1);
    headerRow.height = 22;
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF6C5CE7' },
      };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    });

    const phoneCol = 3;
    for (const item of items) {
      const rowValues: Array<string | number> = [
        item.clientName || '',
        item.installmentSaleNumber != null ? Number(item.installmentSaleNumber) : '',
        '',
      ];
      if (showCollector) {
        rowValues.push(item.collectorName || t('tr_unassigned_collector'));
      }
      rowValues.push(this.formatDisplayDate(item.dueDate));
      if (showDays) {
        rowValues.push(item.status === 'overdue' ? Number(item.daysOverdue) || 0 : '');
        rowValues.push(
          item.status === 'overdue' ? Number(item.overdueInstallmentCount) || 0 : ''
        );
      }
      rowValues.push(Number(item.remaining) || 0);
      rowValues.push(
        (Number(item.minimumCollectionAmount) || 0) > 0
          ? Number(item.minimumCollectionAmount)
          : ''
      );
      rowValues.push(t(this.statusLabelKey(item.status)));

      const row = ws.addRow(rowValues);
      const phoneCell = row.getCell(phoneCol);
      phoneCell.value = this.clientPhone(item);
      phoneCell.numFmt = '@';
    }

    headers.forEach((header, index) => {
      const col = ws.getColumn(index + 1);
      col.width = index === phoneCol - 1 ? 18 : Math.min(36, Math.max(14, String(header).length + 4));
    });
    ws.getColumn(phoneCol).numFmt = '@';

    const buffer = (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
    saveAs(
      new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
      this.exportFilename(items)
    );
  }

  private exportFilename(items: CollectionDueItem[]): string {
    const parts = [this.exportCollectorLabel(items), this.exportDatePart()].filter((part) => !!part);
    const base = this.safeFilePart(parts.join('_')) || 'due-installments';
    return `${base}.xlsx`;
  }

  private exportCollectorLabel(items: CollectionDueItem[]): string {
    if (!this.isNamedCollectorFilter && !this.isCollectorView) return '';
    const fromList = this.collectors.find(
      (c) => String(c._id) === String(this.selectedCollectorId)
    )?.name;
    return String(
      fromList || (this.isCollectorView ? this.currentUserName : '') || items[0]?.collectorName || ''
    ).trim();
  }

  private exportDatePart(): string {
    const dueFrom = this.formatDateLabel(this.fromDate);
    const dueTo = this.formatDateLabel(this.toDate);
    if (dueFrom || dueTo) return this.joinDateLabels(dueFrom, dueTo);
    return this.joinDateLabels(
      this.formatDateLabel(this.promiseFromDate),
      this.formatDateLabel(this.promiseToDate)
    );
  }

  private joinDateLabels(from?: string, to?: string): string {
    if (from && to && from !== to) return `${from}_${to}`;
    return from || to || '';
  }

  private formatDateLabel(d: Date | null): string | undefined {
    if (!d || !(d instanceof Date) || isNaN(d.getTime())) return undefined;
    const day = String(d.getDate()).padStart(2, '0');
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return `${day}-${m}-${d.getFullYear()}`;
  }

  private formatDisplayDate(value?: string): string {
    if (!value) return '';
    const d = new Date(value);
    if (isNaN(d.getTime())) return '';
    const day = String(d.getDate()).padStart(2, '0');
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return `${day}/${m}/${d.getFullYear()}`;
  }

  private safeFilePart(value: string): string {
    return value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  private formatDate(d: Date | null): string | undefined {
    if (!d || !(d instanceof Date) || isNaN(d.getTime())) return undefined;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  ngOnDestroy(): void {
    if (this.installmentSaleNumberTimeout) {
      clearTimeout(this.installmentSaleNumberTimeout);
    }
    this.subs.forEach((s) => s && s.unsubscribe());
  }
}
