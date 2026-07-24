import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { Subscription } from 'rxjs';
import { AuthenticationService } from '@core/services/authentication.service';
import { Globals } from '@core/globals';
import { PaginationData } from '@core/models/users-interfaces.model';
import { Branch, Category } from '@core/models/products.model';
import { formatCairoDateTime, formatCairoYMD } from '@core/utils/date-tz.util';
import { canPickBranchRole, isBranchManager } from '@core/utils/role-utils';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { BranchesServce } from '@shared/services/branches.service';
import { CategoriesServce } from '@shared/services/categories.service';
import {
  BranchTransferItem,
  ProductsSerivce,
} from '@shared/services/products.service';

@Component({
  selector: 'app-pending-branch-transfers',
  templateUrl: './pending-branch-transfers.component.html',
  styleUrls: ['./pending-branch-transfers.component.scss'],
})
export class PendingBranchTransfersComponent implements OnInit, OnDestroy {
  loading = true;
  isFilterOpen = true;
  isNotAuthorized = false;
  transfers: BranchTransferItem[] = [];
  statusFilter: 'pending' | 'all' = 'pending';
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
  };

  private subscriptions: Subscription[] = [];

  constructor(
    private auth: AuthenticationService,
    private products: ProductsSerivce,
    private branchesService: BranchesServce,
    private categoriesService: CategoriesServce,
    private notify: AppNotificationService,
    private translate: TranslateService,
    private globals: Globals,
    private router: Router
  ) {}

  ngOnInit(): void {
    const role = this.globals.currentUser?.role as string | undefined;
    if (!(canPickBranchRole(role) || isBranchManager(role))) {
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
    return canPickBranchRole(this.globals.currentUser?.role);
  }

  loadBranches(): void {
    if (!this.showBranchFilter) {
      return;
    }
    this.subscriptions.push(
      this.branchesService.getBranchs({ page: 1, limit: 1000 }).subscribe({
        next: (res: any) => {
          this.branches = res?.branches || [];
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

  setFilter(v: 'pending' | 'all'): void {
    this.statusFilter = v;
    this.params.status = v === 'all' ? 'all' : 'pending';
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
    const fromBranchCsv = (this.selectedFromBranches || []).filter(Boolean).join(',');
    const toBranchCsv = (this.selectedToBranches || []).filter(Boolean).join(',');
    const categoryCsv = (this.selectedCategories || []).filter(Boolean).join(',');
    const search = String(this.searchTerm || '').trim();

    if (fromBranchCsv) {
      this.params.fromBranchId = fromBranchCsv;
    } else {
      delete this.params.fromBranchId;
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
    this.rejectTransfer = t;
    this.rejectReason = '';
  }

  cancelReject(): void {
    this.rejectTransfer = null;
    this.rejectReason = '';
  }

  approve(t: BranchTransferItem): void {
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
    if (!t || !uid || this.actingId) {
      return;
    }
    this.actingId = t._id;
    this.products.rejectBranchTransfer(t._id, uid, this.rejectReason.trim()).subscribe({
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
