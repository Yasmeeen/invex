import { Component, OnDestroy, OnInit } from '@angular/core';
import { MatLegacyDialog as MatDialog } from '@angular/material/legacy-dialog';
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

@Component({
    selector: 'app-drawer-close-history',
    templateUrl: './drawer-close-history.component.html',
    styleUrls: ['./drawer-close-history.component.scss'],
    standalone: false
})
export class DrawerCloseHistoryComponent implements OnInit, OnDestroy {
  closes: DrawerCloseRecord[] = [];
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
      width: '580px',
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
