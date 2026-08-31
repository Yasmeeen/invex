import { Component, OnDestroy, OnInit } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { Subscription } from 'rxjs';
import { AuthenticationService } from '@core/services/authentication.service';
import { Globals } from '@core/globals';
import { PaginationData } from '@core/models/users-interfaces.model';
import { Branch, Category } from '@core/models/products.model';
import { formatCairoDateTime, formatCairoYMD } from '@core/utils/date-tz.util';
import { canPickBranchRole, isBranchManager, isWarehouse } from '@core/utils/role-utils';
import { ConfirmationDialogComponent } from '@shared/components/confirmation-dialog/confirmation-dialog.component';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { BranchesServce } from '@shared/services/branches.service';
import { CategoriesServce } from '@shared/services/categories.service';
import {
  BranchTransferItem,
  ProductsSerivce,
} from '@shared/services/products.service';
import { ReportExportService } from '@shared/services/report-export.service';

@Component({
  selector: 'app-pending-branch-transfers',
  templateUrl: './pending-branch-transfers.component.html',
  styleUrls: ['./pending-branch-transfers.component.scss'],
})
export class PendingBranchTransfersComponent implements OnInit, OnDestroy {
  loading = true;
  exporting = false;
  isFilterOpen = true;
  isNotAuthorized = false;
  transfers: BranchTransferItem[] = [];
  statusFilter: 'pending' | 'rejected' | 'all' = 'pending';
  rejectTransfer: BranchTransferItem | null = null;
  rejectReason = '';
  actingId: string | null = null;

  branches: Branch[] = [];
  categories: Category[] = [];
  selectedFromBranches: string[] = [];
  selectedToBranches: string[] = [];
  selectedCategories: string[] = [];
  searchTerm = '';
  listFromDate: Date | null = null;
  listToDate: Date | null = null;
  searchTimeout: any;

  paginationPerPage = 20;
  paginationData: PaginationData;
  totalCount = 0;

  params: {
    page: number;
    limit: number;
    status: string;
    userId: string;
    fromBranchId?: string;
    toBranchId?: string;
    categoryId?: string;
    search?: string;
    from?: string;
    to?: string;
    fromWarehouse?: boolean;
  };

  private subscriptions: Subscription[] = [];

  constructor(
    private auth: AuthenticationService,
    private products: ProductsSerivce,
    private branchesService: BranchesServce,
    private categoriesService: CategoriesServce,
    private notify: AppNotificationService,
    private translate: TranslateService,
    private exportService: ReportExportService,
    private globals: Globals,
    private router: Router,
    private dialog: MatDialog
  ) {}

  ngOnInit(): void {
    const role = this.globals.currentUser?.role as string | undefined;
    if (!(canPickBranchRole(role) || isBranchManager(role) || isWarehouse(role))) {
      this.isNotAuthorized = true;
      this.loading = false;
      return;
    }

    const user = this.auth.getUserFromLocalStorage();
    const uid = user?._id != null ? String(user._id) : '';
    this.params = {
      page: 1,
      limit: this.paginationPerPage,
      status: 'pending',
      userId: uid,
    };

    this.loadBranches();
    this.loadCategories();
    this.load();
  }

  ngOnDestroy(): void {
    clearTimeout(this.searchTimeout);
    this.subscriptions.forEach((s) => s.unsubscribe());
  }

  get showBranchFilter(): boolean {
    const role = this.globals.currentUser?.role;
    return canPickBranchRole(role) || isBranchManager(role) || isWarehouse(role);
  }

  /** From-branch filter (warehouse role only sees warehouse→branch transfers). */
  get showFromBranchFilter(): boolean {
    const role = this.globals.currentUser?.role;
    return canPickBranchRole(role) || isBranchManager(role);
  }

  /** Destination branch options (exclude synthetic warehouse row). */
  get toBranchOptions(): Branch[] {
    return (this.branches || []).filter((b) => String(b._id) !== '__warehouse__');
  }

  /** Label for transfer source: warehouse or branch name. */
  transferFromLabel(t: BranchTransferItem | null | undefined): string {
    if (!t) {
      return '—';
    }
    if (t.fromWarehouse) {
      return this.translate.instant('tr_warehouse');
    }
    return t.fromBranch?.name || '—';
  }

  loadBranches(): void {
    if (!this.showBranchFilter) {
      return;
    }
    this.subscriptions.push(
      this.branchesService.getBranchs({ page: 1, limit: 1000 }).subscribe({
        next: (res: any) => {
          const list = res?.branches || [];
          if (this.showFromBranchFilter) {
            this.branches = [
              { _id: '__warehouse__', name: this.translate.instant('tr_warehouse') } as Branch,
              ...list,
            ];
          } else {
            this.branches = list;
          }
        },
        error: () => {},
      })
    );
  }

  loadCategories(): void {
    this.subscriptions.push(
      this.categoriesService.getCategorys({ page: 1, limit: 1000 }).subscribe({
        next: (res: any) => {
          this.categories = res?.categories || [];
        },
        error: () => {},
      })
    );
  }

  setFilter(v: 'pending' | 'rejected' | 'all'): void {
    this.statusFilter = v;
    this.params.status = v;
    this.params.page = 1;
    this.load();
  }

  onSearchInput(): void {
    clearTimeout(this.searchTimeout);
    this.searchTimeout = setTimeout(() => {
      this.applyFilters();
    }, 400);
  }

  applyFilters(): void {
    this.params.page = 1;
    const fromSelected = (this.selectedFromBranches || []).filter(Boolean);
    const warehouseSelected = fromSelected.includes('__warehouse__');
    const fromBranchCsv = fromSelected.filter((id) => id !== '__warehouse__').join(',');
    const toBranchCsv = (this.selectedToBranches || []).filter(Boolean).join(',');
    const categoryCsv = (this.selectedCategories || []).filter(Boolean).join(',');
    const search = String(this.searchTerm || '').trim();

    if (fromBranchCsv) {
      this.params.fromBranchId = fromBranchCsv;
    } else {
      delete this.params.fromBranchId;
    }
    if (warehouseSelected) {
      this.params.fromWarehouse = true;
    } else {
      delete this.params.fromWarehouse;
    }
    if (toBranchCsv) {
      this.params.toBranchId = toBranchCsv;
    } else {
      delete this.params.toBranchId;
    }
    if (categoryCsv) {
      this.params.categoryId = categoryCsv;
    } else {
      delete this.params.categoryId;
    }
    if (search) {
      this.params.search = search;
    } else {
      delete this.params.search;
    }
    if (this.listFromDate) {
      this.params.from = formatCairoYMD(this.listFromDate);
    } else {
      delete this.params.from;
    }
    if (this.listToDate) {
      this.params.to = formatCairoYMD(this.listToDate);
    } else {
      delete this.params.to;
    }
    this.load();
  }

  onDateFilterChange(): void {
    this.applyFilters();
  }

  clearFilters(): void {
    this.selectedFromBranches = [];
    this.selectedToBranches = [];
    this.selectedCategories = [];
    this.searchTerm = '';
    this.listFromDate = null;
    this.listToDate = null;
    this.applyFilters();
  }

  load(): void {
    if (!this.params?.userId) {
      this.loading = false;
      return;
    }
    this.loading = true;
    this.subscriptions.push(
      this.products.listBranchTransfers(this.params).subscribe({
        next: (r) => {
          this.transfers = r?.transfers || [];
          const m = r?.meta;
          this.totalCount = Number(m?.totalCount) || 0;
          this.paginationData = {
            currentPage: m?.currentPage || this.params.page,
            totalCount: this.totalCount,
            totalPages: m?.totalPages || 0,
            nextPage: m?.nextPage ?? 0,
            prevPage: m?.prevPage ?? 0,
          };
          this.loading = false;
          this.refreshSidebarPendingCount();
        },
        error: (err) => {
          this.loading = false;
          this.isNotAuthorized = err?.status === 403;
          if (!this.isNotAuthorized) {
            this.notify.push(this.translate.instant('tr_unexpected_error_message'), 'error');
          }
        },
      })
    );
  }

  private refreshSidebarPendingCount(): void {
    const uid = this.params?.userId;
    if (!uid) {
      return;
    }
    this.products.getPendingBranchTransferCount(uid).subscribe({
      next: (r) => {
        this.globals.pendingBranchTransferCount = Number(r?.count) || 0;
      },
      error: () => {},
    });
  }

  paginationUpdate(page: number): void {
    this.params.page = page;
    this.load();
  }

  goToProducts(): void {
    this.router.navigate(['/products']);
  }

  async exportExcel(): Promise<void> {
    if (this.exporting || !this.params?.userId) {
      return;
    }
    this.exporting = true;
    try {
      const transfers = await this.fetchAllTransfersForExport();
      if (!transfers.length) {
        this.notify.push(this.translate.instant('tr_branch_transfers_empty'), 'error');
        return;
      }
      const rows = transfers.map((t) => this.mapTransferExportRow(t));
      const filename = `branch_transfers_${new Date().toISOString().slice(0, 10)}`;
      await this.exportService.exportToExcel(filename, rows);
    } catch {
      this.notify.push(this.translate.instant('tr_unexpected_error_message'), 'error');
    } finally {
      this.exporting = false;
    }
  }

  private async fetchAllTransfersForExport(): Promise<BranchTransferItem[]> {
    const pageSize = 100;
    const all: BranchTransferItem[] = [];
    let page = 1;
    let totalPages = 1;
    while (page <= totalPages) {
      const r = await this.products
        .listBranchTransfers({
          ...this.params,
          page,
          limit: pageSize,
        })
        .toPromise();
      all.push(...(r?.transfers || []));
      totalPages = Math.max(1, Number(r?.meta?.totalPages) || 1);
      page += 1;
    }
    return all;
  }

  private mapTransferExportRow(t: BranchTransferItem): Record<string, string | number> {
    return {
      [this.translate.instant('tr_product_name')]: this.transferProductName(t),
      [this.translate.instant('tr_code')]: this.transferProductCode(t),
      [this.translate.instant('tr_branch_transfer_from')]: this.transferFromLabel(t),
      [this.translate.instant('tr_branch_transfer_to_branch')]: t.toBranch?.name || '',
      [this.translate.instant('tr_branch_transfer_quantity')]: t.quantity ?? 0,
      [this.translate.instant('tr_branch_transfer_status_col')]: this.translate.instant(
        this.statusLabelKey(t)
      ),
      [this.translate.instant('tr_branch_transfer_reject_reason')]:
        t.status === 'rejected' ? t.rejectReason || '' : '',
      [this.translate.instant('tr_branch_transfer_date')]: this.formatTransferDate(t.createdAt) || '',
      [this.translate.instant('tr_branch_transfer_by')]: t.initiatedBy?.name || '',
    };
  }

  transferProductName(t: BranchTransferItem | null | undefined): string {
    if (!t) {
      return '';
    }
    return String(t.product?.name || t.productNameSnapshot || '').trim();
  }

  transferProductCode(t: BranchTransferItem | null | undefined): string {
    if (!t) {
      return '';
    }
    return String(t.product?.code || t.productCodeSnapshot || '').trim();
  }

  canResolve(transfer: BranchTransferItem): boolean {
    if (transfer.status !== 'pending') {
      return false;
    }
    const user = this.auth.getUserFromLocalStorage();
    if (!user) {
      return false;
    }
    const role = user.role as string;
    if (canPickBranchRole(role)) {
      return true;
    }
    if (isBranchManager(role) && user.branch?._id) {
      const tid =
        transfer.toBranch &&
        (typeof transfer.toBranch === 'object'
          ? (transfer.toBranch as { _id?: string })._id
          : transfer.toBranch);
      return !!tid && String(tid) === String(user.branch._id);
    }
    return false;
  }

  statusLabelKey(transfer: BranchTransferItem): string {
    if (transfer.status === 'approved') {
      return 'tr_branch_transfer_status_approved';
    }
    if (transfer.status === 'rejected') {
      return 'tr_branch_transfer_status_rejected';
    }
    return 'tr_branch_transfer_status_pending';
  }

  /** Transfer request date/time in Cairo (dd/MM/yyyy HH:mm). */
  formatTransferDate(value: string | Date | null | undefined): string {
    return formatCairoDateTime(value);
  }

  startReject(t: BranchTransferItem): void {
    if (this.actingId) {
      return;
    }
    this.rejectTransfer = t;
    this.rejectReason = '';
  }

  cancelReject(): void {
    if (this.actingId) {
      return;
    }
    this.rejectTransfer = null;
    this.rejectReason = '';
  }

  approve(t: BranchTransferItem): void {
    if (this.actingId) {
      return;
    }
    this.dialog
      .open(ConfirmationDialogComponent, {
        width: '450px',
        data: {
          title: this.translate.instant('tr_confirmation_message'),
          message: this.translate.instant('tr_branch_transfer_approve_confirm_message'),
          details: this.transferConfirmDetails(t),
          buttons: [
            {
              label: this.translate.instant('tr_action.cancel'),
              actionCallback: 'cancel',
              type: 'btn-secondary',
            },
            {
              label: this.translate.instant('tr_branch_transfer_approve'),
              actionCallback: 'confirm',
              type: 'btn-primary',
            },
          ],
        },
        disableClose: true,
      })
      .afterClosed()
      .subscribe((result) => {
        if (result === 'confirm') {
          this.doApprove(t);
        }
      });
  }

  private transferConfirmDetails(t: BranchTransferItem): string[] {
    const details = [
      `${this.translate.instant('tr_product_name')}: ${this.transferProductName(t) || '—'}`,
      `${this.translate.instant('tr_branch_transfer_from')}: ${this.transferFromLabel(t)}`,
      `${this.translate.instant('tr_branch_transfer_to_branch')}: ${t.toBranch?.name || '—'}`,
      `${this.translate.instant('tr_branch_transfer_quantity')}: ${t.quantity ?? 0}`,
    ];
    const stockOutcome = this.sourceStockOutcomeNote(t);
    if (stockOutcome) {
      details.push(stockOutcome);
    }
    return details;
  }

  /**
   * Explain source-branch product fate per category setting when stock hits 0
   * (keep visible at 0 vs soft-hide / remove from lists).
   */
  private sourceStockOutcomeNote(t: BranchTransferItem): string | null {
    if (!t.product) {
      return null;
    }
    const cat = t.product.category;
    const deleteWhenEmpty =
      !!cat && typeof cat === 'object' && !!cat.deleteProductWhenOutOfStock;
    const stock = Math.max(0, Number(t.product.stock) || 0);
    const qty = Math.max(0, Number(t.quantity) || 0);
    const willDepleteNow = qty > 0 && stock - qty <= 0;

    if (willDepleteNow) {
      return this.translate.instant(
        deleteWhenEmpty
          ? 'tr_branch_transfer_approve_source_will_remove'
          : 'tr_branch_transfer_approve_source_will_keep_zero'
      );
    }
    return this.translate.instant(
      deleteWhenEmpty
        ? 'tr_branch_transfer_approve_category_removes_on_empty'
        : 'tr_branch_transfer_approve_category_keeps_at_zero'
    );
  }

  private doApprove(t: BranchTransferItem): void {
    const user = this.auth.getUserFromLocalStorage();
    const uid = user?._id != null ? String(user._id) : '';
    if (!uid || this.actingId) {
      return;
    }
    this.actingId = t._id;
    this.products.approveBranchTransfer(t._id, uid).subscribe({
      next: () => {
        this.actingId = null;
        this.notify.push(this.translate.instant('tr_branch_transfer_approved_ok'), 'success');
        this.load();
      },
      error: (err) => {
        this.actingId = null;
        const msg = err?.error?.error || this.translate.instant('tr_unexpected_error_message');
        this.notify.push(msg, 'error');
      },
    });
  }

  submitReject(): void {
    const t = this.rejectTransfer;
    const user = this.auth.getUserFromLocalStorage();
    const uid = user?._id != null ? String(user._id) : '';
    const reason = this.rejectReason.trim();
    if (!t || !uid || this.actingId) {
      return;
    }
    if (!reason) {
      this.notify.push(this.translate.instant('tr_branch_transfer_reject_reason_required'), 'error');
      return;
    }
    this.actingId = t._id;
    this.products.rejectBranchTransfer(t._id, uid, reason).subscribe({
      next: () => {
        this.actingId = null;
        this.cancelReject();
        this.notify.push(this.translate.instant('tr_branch_transfer_rejected_ok'), 'success');
        this.load();
      },
      error: (err) => {
        this.actingId = null;
        const msg = err?.error?.error || this.translate.instant('tr_unexpected_error_message');
        this.notify.push(msg, 'error');
      },
    });
  }
}
