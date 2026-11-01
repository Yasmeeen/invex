import { Component, OnDestroy, OnInit } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { PaginationData } from '@core/models/users-interfaces.model';
import { AuthenticationService } from '@core/services/authentication.service';
import { Branch } from '@core/models/products.model';
import { resolveActorBranchContext } from '@core/utils/branch-utils';
import { formatCairoDateTime } from '@core/utils/date-tz.util';
import { TranslateService } from '@ngx-translate/core';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { BranchesServce } from '@shared/services/branches.service';
import { VendorsSerivce } from '@shared/services/vendors.service';
import { Subscription } from 'rxjs';
import { VendorGoodsReturnDialogComponent } from '../vendor-goods-return-dialog/vendor-goods-return-dialog.component';

export interface VendorGoodsReturnLine {
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface VendorGoodsReturnRow {
  vendorId: string;
  vendorName: string;
  vendorCompany?: string;
  vendorPhone?: string;
  entryId: string;
  amount: number;
  note?: string;
  createdAt: string;
  branchId?: string;
  branchName?: string;
  lines: VendorGoodsReturnLine[];
}

@Component({
  selector: 'app-vendor-goods-returns-list',
  templateUrl: './vendor-goods-returns-list.component.html',
  styleUrls: ['./vendor-goods-returns-list.component.scss'],
})
export class VendorGoodsReturnsListComponent implements OnInit, OnDestroy {
  rows: VendorGoodsReturnRow[] = [];
  loading = true;
  isNotAuthorized = false;
  isFilterOpen = true;
  paginationData?: PaginationData;
  paginationPerPage = 15;
  page = 1;
  totalCount = 0;

  branches: Branch[] = [];
  showBranchPicker = false;
  lockedBranchId: string | null = null;
  filterBranchId = '';
  searchTerm = '';
  dateFrom = '';
  dateTo = '';

  private subscriptions: Subscription[] = [];

  constructor(
    private vendors: VendorsSerivce,
    private branchesService: BranchesServce,
    private dialog: MatDialog,
    private notify: AppNotificationService,
    private translate: TranslateService,
    private auth: AuthenticationService
  ) {}

  ngOnInit(): void {
    const ctx = resolveActorBranchContext(this.auth.getUserFromLocalStorage(), null);
    this.showBranchPicker = ctx.showBranchPicker;
    this.lockedBranchId = ctx.branchId;
    if (this.showBranchPicker) {
      this.subscriptions.push(
        this.branchesService.getBranchs({ page: 1, limit: 1000 }).subscribe({
          next: (res: any) => {
            this.branches = res?.branches || [];
          },
          error: () => {
            this.notify.push(this.translate.instant('tr_unexpected_error_message'), 'error');
          },
        })
      );
    }
    this.load();
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach((sub) => sub.unsubscribe());
  }

  formatWhen(value?: string | null): string {
    return formatCairoDateTime(value) || '—';
  }

  vendorLabel(row: VendorGoodsReturnRow): string {
    const name = String(row.vendorName || '').trim();
    const company = String(row.vendorCompany || '').trim();
    if (name && company && name !== company) return `${name} — ${company}`;
    return name || company || '—';
  }

  applyFilters(): void {
    this.page = 1;
    this.load();
  }

  clearFilters(): void {
    this.filterBranchId = '';
    this.searchTerm = '';
    this.dateFrom = '';
    this.dateTo = '';
    this.applyFilters();
  }

  paginationUpdate(page: number): void {
    this.page = page;
    this.load();
  }

  openGoodsReturnDialog(): void {
    this.dialog
      .open(VendorGoodsReturnDialogComponent, {
        width: '560px',
        maxWidth: '96vw',
        panelClass: 'vendor-goods-return-dialog-panel',
        backdropClass: 'vendor-goods-return-dialog-backdrop',
        data: {},
        disableClose: true,
      })
      .afterClosed()
      .subscribe((saved) => {
        if (saved) this.load();
      });
  }

  private load(): void {
    this.loading = true;
    const branchId = this.showBranchPicker
      ? String(this.filterBranchId || '').trim()
      : String(this.lockedBranchId || '').trim();
    this.subscriptions.push(
      this.vendors
        .getGoodsReturns({
          page: this.page,
          perPage: this.paginationPerPage,
          search: this.searchTerm.trim(),
          branchId,
          from: this.dateFrom,
          to: this.dateTo,
        })
        .subscribe({
          next: (res: any) => {
            this.rows = Array.isArray(res?.returns) ? res.returns : [];
            this.paginationData = res?.meta;
            this.totalCount = Number(res?.meta?.totalCount) || 0;
            this.loading = false;
          },
          error: (error: any) => {
            this.loading = false;
            this.rows = [];
            if (error?.status === 403) {
              this.isNotAuthorized = true;
              return;
            }
            this.notify.push(this.translate.instant('tr_unexpected_error_message'), 'error');
          },
        })
    );
  }
}
