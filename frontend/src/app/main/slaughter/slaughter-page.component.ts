import { Component, OnDestroy, OnInit } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Globals } from '@core/globals';
import { Branch } from '@core/models/products.model';
import { PaginationData } from '@core/models/users-interfaces.model';
import { TranslateService } from '@ngx-translate/core';
import { BranchesServce } from '@shared/services/branches.service';
import {
  SlaughterService,
  SlaughterTemplate,
  SlaughterTicket,
} from '@shared/services/slaughter.service';
import { Router } from '@angular/router';
import { StoreSettingsService } from '@shared/services/store-settings.service';
import { canPickBranchRole, isWarehouse } from '@core/utils/role-utils';
import { Subscription } from 'rxjs';
import { SlaughterDialogComponent } from './slaughter-dialog/slaughter-dialog.component';

@Component({
  selector: 'app-slaughter-page',
  templateUrl: './slaughter-page.component.html',
  styleUrls: ['./slaughter-page.component.scss'],
})
export class SlaughterPageComponent implements OnInit, OnDestroy {
  tickets: SlaughterTicket[] = [];
  templates: SlaughterTemplate[] = [];
  branches: Branch[] = [];
  loading = true;
  paginationData: PaginationData;
  branchId = '';
  /** Filter: '' = all (admin), 'warehouse' = warehouse only, or a branch id */
  locationFilter = '';

  private subs: Subscription[] = [];

  constructor(
    private slaughter: SlaughterService,
    private branchesService: BranchesServce,
    private translate: TranslateService,
    public globals: Globals,
    private router: Router,
    private storeSettings: StoreSettingsService,
    private dialog: MatDialog
  ) {}

  ngOnInit(): void {
    if (!this.storeSettings.butcherFeaturesEnabled) {
      void this.router.navigate(['/home']);
      return;
    }
    const role = this.globals.currentUser?.role;
    const userBranch = this.globals.currentUser?.branch;

    if (isWarehouse(role) && !canPickBranchRole(role)) {
      this.locationFilter = 'warehouse';
    } else if (userBranch?._id && !canPickBranchRole(role)) {
      this.branchId = String(userBranch._id);
      this.locationFilter = this.branchId;
    }

    this.subs.push(
      this.slaughter.listTemplates().subscribe({
        next: (r) => {
          this.templates = r.templates || [];
        },
      })
    );
    if (canPickBranchRole(role)) {
      this.subs.push(
        this.branchesService.getBranchs({ page: 1, limit: 1000 }).subscribe({
          next: (res: any) => {
            this.branches = res?.branches || res?.data || [];
            if (!this.locationFilter && this.branches.length) {
              this.locationFilter = String(this.branches[0]._id);
              this.branchId = this.locationFilter;
            }
          },
        })
      );
    }
    this.loadTickets();
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe());
  }

  get showLocationFilter(): boolean {
    return canPickBranchRole(this.globals.currentUser?.role);
  }

  get allowWarehouse(): boolean {
    const role = this.globals.currentUser?.role;
    return canPickBranchRole(role) || isWarehouse(role);
  }

  onLocationFilterChange(): void {
    if (this.locationFilter === 'warehouse') {
      this.branchId = '';
    } else {
      this.branchId = this.locationFilter;
    }
    this.loadTickets();
  }

  openSlaughterDialog(): void {
    const locationType =
      this.locationFilter === 'warehouse' || (!this.branchId && this.allowWarehouse)
        ? 'warehouse'
        : 'branch';
    const open = (templates: SlaughterTemplate[]) => {
      const ref = this.dialog.open(SlaughterDialogComponent, {
        width: '720px',
        maxWidth: '96vw',
        autoFocus: false,
        data: {
          branchId: this.branchId,
          branches: this.branches,
          showBranchFilter: this.showLocationFilter,
          allowWarehouse: this.allowWarehouse,
          locationType,
          templates,
        },
      });
      ref.afterClosed().subscribe((saved) => {
        if (saved) {
          this.loadTickets();
        }
      });
    };
    this.slaughter.listTemplates().subscribe({
      next: (r) => {
        this.templates = r.templates || [];
        open(this.templates);
      },
      error: () => open(this.templates),
    });
  }

  kindLabel(kind?: string): string {
    const key =
      kind === 'fridge'
        ? 'tr_slaughter_kind_fridge'
        : kind === 'waste'
          ? 'tr_slaughter_kind_waste'
          : 'tr_slaughter_kind_offal';
    return this.translate.instant(key);
  }

  onPagination(page: any): void {
    const n = Number(page);
    this.loadTickets(Number.isFinite(n) && n > 0 ? n : 1);
  }

  loadTickets(page = 1): void {
    this.loading = true;
    const params: {
      page: number;
      limit: number;
      branch_id?: string;
      inWarehouse?: boolean;
      userId?: string;
    } = {
      page,
      limit: 15,
      userId: this.globals.currentUser?._id,
    };
    if (this.locationFilter === 'warehouse') {
      params.inWarehouse = true;
    } else if (this.branchId) {
      params.branch_id = this.branchId;
    }
    this.slaughter.listTickets(params).subscribe({
      next: (res) => {
        this.tickets = res.tickets || [];
        const p = res.pagination || {};
        this.paginationData = {
          currentPage: p.page || 1,
          nextPage: p.page < p.pages ? p.page + 1 : 0,
          prevPage: p.page > 1 ? p.page - 1 : 0,
          totalCount: p.total || 0,
          totalPages: p.pages || 1,
        };
        this.loading = false;
      },
      error: () => {
        this.loading = false;
      },
    });
  }

  ticketFarmName(t: SlaughterTicket): string {
    if (t.farmProductName) {
      return t.farmProductName;
    }
    return t.farmProductId && t.farmProductId.name ? t.farmProductId.name : '';
  }

  ticketLocationLabel(t: SlaughterTicket): string {
    if (t.inWarehouse) {
      return this.translate.instant('tr_warehouse');
    }
    return t.branch?.name || this.translate.instant('tr_storage_branch');
  }

  ticketOutputsLabel(t: SlaughterTicket): string {
    return (t.outputs || [])
      .map((o) => {
        const name = o.name || '';
        const kind = o.kind ? ` (${this.kindLabel(o.kind)})` : '';
        return `${name}${kind} ${o.quantity}`;
      })
      .join('، ');
  }
}
