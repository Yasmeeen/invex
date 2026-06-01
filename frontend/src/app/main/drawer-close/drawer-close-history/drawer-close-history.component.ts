import { Component, OnDestroy, OnInit } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Globals } from '@core/globals';
import { PaginationData } from '@core/models/users-interfaces.model';
import { Branch } from '@core/models/products.model';
import { TranslateService } from '@ngx-translate/core';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { BranchesServce } from '@shared/services/branches.service';
import {
  DrawerCloseRecord,
  DrawerCloseService,
} from '@shared/services/drawer-close.service';
import { Subscription } from 'rxjs';
import { canPickBranchRole } from '@core/utils/role-utils';
import {
  DrawerCloseDialogComponent,
  DrawerCloseDialogData,
} from '../drawer-close-dialog/drawer-close-dialog.component';
import { ConfirmationDialogComponent } from '@shared/components/confirmation-dialog/confirmation-dialog.component';

@Component({
  selector: 'app-drawer-close-history',
  templateUrl: './drawer-close-history.component.html',
  styleUrls: ['./drawer-close-history.component.scss'],
})
export class DrawerCloseHistoryComponent implements OnInit, OnDestroy {
  closes: DrawerCloseRecord[] = [];
  reopening = false;
  loading = true;
  isNotAuthorized = false;
  isFilterOpen = true;
  paginationData: PaginationData;
  paginationPerPage = 15;

  branches: Branch[] = [];
  filterBranchId = '';
  dateFrom = '';
  dateTo = '';

  params: {
    page: number;
    limit: number;
    branch_id?: string;
    dateFrom?: string;
    dateTo?: string;
    viewerUserId: string;
  };

  private subscriptions: Subscription[] = [];

  constructor(
    private drawerClose: DrawerCloseService,
    private dialog: MatDialog,
    private branchesService: BranchesServce,
    private notify: AppNotificationService,
    private translate: TranslateService,
    public globals: Globals
  ) {}

  ngOnInit(): void {
    const uid = this.globals.currentUser?._id;
    this.params = {
      page: 1,
      limit: this.paginationPerPage,
      viewerUserId: uid,
    };

    if (canPickBranchRole(this.globals.currentUser?.role)) {
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

  get showBranchFilter(): boolean {
    return canPickBranchRole(this.globals.currentUser?.role);
  }

  periodLabel(row: DrawerCloseRecord): string {
    const start = row.periodStartDate || row.businessDate;
    const end = row.periodEndDate || row.businessDate;
    if (start === end) return end;
    return `${start} → ${end}`;
  }

  applyFilters(): void {
    this.params.page = 1;
    this.params.branch_id = this.filterBranchId || undefined;
    this.params.dateFrom = this.dateFrom || undefined;
    this.params.dateTo = this.dateTo || undefined;
    this.load();
  }

  clearDateFilters(): void {
    this.dateFrom = '';
    this.dateTo = '';
    this.applyFilters();
  }

  load(): void {
    this.loading = true;
    this.subscriptions.push(
      this.drawerClose.list(this.params).subscribe({
        next: (res) => {
          this.closes = res.closes || [];
          const m = res.meta;
          this.paginationData = {
            currentPage: m.currentPage,
            totalCount: m.totalCount,
            totalPages: m.totalPages,
            nextPage: m.nextPage ?? 0,
            prevPage: m.prevPage ?? 0,
          };
          this.loading = false;
        },
        error: (err) => {
          this.loading = false;
          this.isNotAuthorized = err.status === 403;
          if (!this.isNotAuthorized) {
            const msg = err?.error?.error || this.translate.instant('tr_unexpected_error_message');
            this.notify.push(msg, 'error');
          }
        },
      })
    );
  }

  paginationUpdate(page: number): void {
    this.params.page = page;
    this.load();
  }

  private effectiveBranchIdForReopen(): string | null {
    if (canPickBranchRole(this.globals.currentUser?.role)) {
      return this.filterBranchId ? String(this.filterBranchId).trim() : null;
    }
    const b = this.globals.currentUser?.branch as { _id?: string } | string | undefined;
    return typeof b === 'string' ? String(b).trim() : b?._id ? String(b._id).trim() : null;
  }

  reopenBranchId(): string | null {
    const fromFilter = this.effectiveBranchIdForReopen();
    if (fromFilter) return fromFilter;
    const rowBranch = this.closes[0]?.branch as { _id?: string } | undefined;
    return rowBranch?._id ? String(rowBranch._id).trim() : null;
  }

  canReopenLast(): boolean {
    return Boolean(this.reopenBranchId() && this.closes.length > 0 && this.params.page === 1);
  }

  reopenLastClose(): void {
    const branchId = this.reopenBranchId();
    const uid = this.globals.currentUser?._id;
    if (!branchId || !uid || this.reopening) return;

    const latest = this.closes[0];
    const period = this.periodLabel(latest);

    const dialogRef = this.dialog.open(ConfirmationDialogComponent, {
      width: '450px',
      disableClose: true,
      data: {
        title: this.translate.instant('tr_drawer_close_reopen_confirm', { period }),
        buttons: [
          {
            label: this.translate.instant('tr_action.cancel'),
            actionCallback: 'cancel',
            type: 'btn-secondary',
          },
          {
            label: this.translate.instant('tr_drawer_close_reopen_action'),
            actionCallback: 'reopen',
            type: 'btn-danger',
          },
        ],
      },
    });

    dialogRef.afterClosed().subscribe((result) => {
      if (result !== 'reopen') return;
      this.reopening = true;
      const end = latest.periodEndDate || latest.businessDate;
      this.drawerClose.reopenLast({ userId: uid, branch: branchId, date: end }).subscribe({
        next: () => {
          this.reopening = false;
          this.notify.push(this.translate.instant('tr_drawer_close_reopen_success'), 'success');
          this.load();
        },
        error: (err) => {
          this.reopening = false;
          const msg = err?.error?.error || this.translate.instant('tr_unexpected_error_message');
          this.notify.push(msg, 'error');
        },
      });
    });
  }

  openCloseDialog(): void {
    const uid = this.globals.currentUser?._id;
    let forced: string | null | undefined;

    if (canPickBranchRole(this.globals.currentUser?.role)) {
      forced = this.filterBranchId ? String(this.filterBranchId) : null;
    } else {
      const b = this.globals.currentUser?.branch as { _id?: string } | string | undefined;
      forced =
        typeof b === 'string' ? b : b?._id ? String(b._id) : null;
    }

    const data: DrawerCloseDialogData = {
      userId: uid,
      forcedBranchId: forced || undefined,
    };

    const ref = this.dialog.open(DrawerCloseDialogComponent, {
      width: '640px',
      maxWidth: '96vw',
      panelClass: 'drawer-close-dialog-panel',
      backdropClass: 'drawer-close-dialog-backdrop',
      data,
      disableClose: true,
    });

    this.subscriptions.push(
      ref.afterClosed().subscribe((ok) => {
        if (ok) {
          this.load();
        }
      })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach((s) => s && s.unsubscribe());
  }
}
