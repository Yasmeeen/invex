import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { Globals } from '@core/globals';
import { PaginationData } from '@core/models/users-interfaces.model';
import { Branch, Category } from '@core/models/products.model';
import { formatCairoDateTime12 } from '@core/utils/date-tz.util';
import { canPickBranchRole, isWarehouse } from '@core/utils/role-utils';
import { TranslateService } from '@ngx-translate/core';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { BranchesServce } from '@shared/services/branches.service';
import { CategoriesServce } from '@shared/services/categories.service';
import {
  StockCountDto,
  StockCountService,
  stockCountErrorMessage,
} from '@shared/services/stock-count.service';
import { Subscription } from 'rxjs';
import { StockCountStartDialogComponent } from '../stock-count-start-dialog/stock-count-start-dialog.component';

interface FilterOption {
  value: string;
  label: string;
}

@Component({
  selector: 'app-stock-count-list',
  templateUrl: './stock-count-list.component.html',
  styleUrls: ['./stock-count-list.component.scss'],
})
export class StockCountListComponent implements OnInit, OnDestroy {
  counts: StockCountDto[] = [];
  loading = true;
  isNotAuthorized = false;
  isFilterOpen = true;
  paginationData?: PaginationData;
  paginationPerPage = 15;

  branches: Branch[] = [];
  categories: Category[] = [];
  locationOptions: FilterOption[] = [];
  categoryOptions: FilterOption[] = [];
  statusOptions: FilterOption[] = [];

  filterLocation = '';
  filterStatus = '';
  filterCategoryId = '';
  dateFrom = '';
  dateTo = '';
  page = 1;

  private subscriptions: Subscription[] = [];

  constructor(
    private stockCounts: StockCountService,
    private dialog: MatDialog,
    private router: Router,
    private branchesService: BranchesServce,
    private categoriesService: CategoriesServce,
    private notify: AppNotificationService,
    private translate: TranslateService,
    public globals: Globals
  ) {}

  ngOnInit(): void {
    this.statusOptions = [
      { value: '', label: this.translate.instant('tr_stock_count_all') },
      { value: 'open', label: this.translate.instant('tr_stock_count_status_open') },
      { value: 'completed', label: this.translate.instant('tr_stock_count_status_completed') },
    ];
    this.locationOptions = [{ value: '', label: this.translate.instant('tr_stock_count_all') }];
    this.categoryOptions = [{ value: '', label: this.translate.instant('tr_stock_count_all') }];
    if (this.showLocationFilter) {
      this.subscriptions.push(
        this.branchesService.getBranchs({ page: 1, limit: 1000 }).subscribe({
          next: (res: any) => {
            this.branches = res?.branches || [];
            this.locationOptions = [
              { value: '', label: this.translate.instant('tr_stock_count_all') },
              { value: 'warehouse', label: this.translate.instant('tr_warehouse') },
              ...this.branches.map((branch) => ({
                value: String(branch._id),
                label: branch.name,
              })),
            ];
          },
          error: () => {
            this.notify.push(this.translate.instant('tr_unexpected_error_message'), 'error');
          },
        })
      );
    }
    this.subscriptions.push(
      this.categoriesService.getCategorys({ page: 1, limit: 1000, lite: '1' }).subscribe({
        next: (res: any) => {
          this.categories = (res?.categories || []).filter((category: Category) => !category.sellByWeight);
          this.categoryOptions = [
            { value: '', label: this.translate.instant('tr_stock_count_all') },
            ...this.categories.map((category) => ({
              value: category._id,
              label: category.name,
            })),
          ];
        },
        error: () => {
          this.notify.push(this.translate.instant('tr_unexpected_error_message'), 'error');
        },
      })
    );
    this.load();
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach((sub) => sub.unsubscribe());
  }

  get showLocationFilter(): boolean {
    const role = this.globals.currentUser?.role;
    return canPickBranchRole(role) || isWarehouse(role);
  }

  formatWhen(value?: string | null): string {
    return formatCairoDateTime12(value) || '—';
  }

  locationLabel(row: StockCountDto): string {
    if (row.locationType === 'warehouse') return this.translate.instant('tr_warehouse');
    return row.branchName || row.branch?.name || '—';
  }

  categoriesLabel(row: StockCountDto): string {
    const names = (row.categories || []).map((category) => category.name).filter((name) => !!name);
    return names.join('، ') || '—';
  }

  statusLabel(row: StockCountDto): string {
    return row.status === 'completed'
      ? this.translate.instant('tr_stock_count_status_completed')
      : this.translate.instant('tr_stock_count_status_open');
  }

  applyFilters(): void {
    this.page = 1;
    this.load();
  }

  clearFilters(): void {
    this.filterLocation = '';
    this.filterStatus = '';
    this.filterCategoryId = '';
    this.dateFrom = '';
    this.dateTo = '';
    this.applyFilters();
  }

  paginationUpdate(page: number): void {
    this.page = page;
    this.load();
  }

  openCount(row: StockCountDto): void {
    this.router.navigate(['/stock-count', row._id]);
  }

  openAddDialog(): void {
    const uid = this.globals.currentUser?._id;
    if (!uid) return;
    const ref = this.dialog.open(StockCountStartDialogComponent, {
      width: '520px',
      panelClass: 'stock-count-start-dialog-panel',
      backdropClass: 'stock-count-start-dialog-backdrop',
      autoFocus: false,
      data: { userId: uid },
    });
    this.subscriptions.push(
      ref.afterClosed().subscribe((id?: string) => {
        if (id) this.router.navigate(['/stock-count', id]);
      })
    );
  }

  load(): void {
    const uid = this.globals.currentUser?._id;
    if (!uid) {
      this.loading = false;
      return;
    }
    this.loading = true;
    this.subscriptions.push(
      this.stockCounts
        .list({
          userId: uid,
          page: this.page,
          limit: this.paginationPerPage,
          location: this.showLocationFilter ? this.filterLocation : undefined,
          status: this.filterStatus || undefined,
          categoryId: this.filterCategoryId || undefined,
          dateFrom: this.dateFrom || undefined,
          dateTo: this.dateTo || undefined,
        })
        .subscribe({
          next: (res) => {
            this.counts = res.counts || [];
            const meta = res.meta;
            this.paginationData = {
              currentPage: meta?.currentPage || 1,
              totalCount: meta?.totalCount || 0,
              totalPages: meta?.totalPages || 0,
              nextPage: meta?.nextPage ?? 0,
              prevPage: meta?.prevPage ?? 0,
            };
            this.loading = false;
          },
          error: (err) => {
            this.loading = false;
            this.isNotAuthorized = err?.status === 403;
            if (!this.isNotAuthorized) {
              this.notify.push(stockCountErrorMessage(this.translate, err), 'error');
            }
          },
        })
    );
  }
}
