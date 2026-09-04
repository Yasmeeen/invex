import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Globals } from '@core/globals';
import { Branch } from '@core/models/products.model';
import { PaginationData } from '@core/models/users-interfaces.model';
import { canPickBranchRole } from '@core/utils/role-utils';
import { BranchesServce } from '@shared/services/branches.service';
import { StoreSettingsService } from '@shared/services/store-settings.service';
import { TrimService, TrimTicket } from '@shared/services/trim.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-trim-page',
  templateUrl: './trim-page.component.html',
  styleUrls: ['./trim-page.component.scss'],
})
export class TrimPageComponent implements OnInit, OnDestroy {
  tickets: TrimTicket[] = [];
  branches: Branch[] = [];
  loading = true;
  paginationData: PaginationData;
  branchId = '';

  private subs: Subscription[] = [];

  constructor(
    private trim: TrimService,
    private branchesService: BranchesServce,
    public globals: Globals,
    private router: Router,
    private storeSettings: StoreSettingsService
  ) {}

  ngOnInit(): void {
    if (!this.storeSettings.butcherFeaturesEnabled) {
      void this.router.navigate(['/home']);
      return;
    }
    const userBranch = this.globals.currentUser?.branch;
    if (userBranch?._id && !canPickBranchRole(this.globals.currentUser?.role)) {
      this.branchId = String(userBranch._id);
    }
    if (canPickBranchRole(this.globals.currentUser?.role)) {
      this.subs.push(
        this.branchesService.getBranchs({ page: 1, limit: 1000 }).subscribe({
          next: (res: any) => {
            this.branches = res?.branches || res?.data || [];
            if (!this.branchId && this.branches.length) {
              this.branchId = String(this.branches[0]._id);
            }
            this.loadTickets();
          },
          error: () => this.loadTickets(),
        })
      );
    } else {
      this.loadTickets();
    }
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe());
  }

  get showBranchFilter(): boolean {
    return canPickBranchRole(this.globals.currentUser?.role);
  }

  onBranchChange(): void {
    this.loadTickets();
  }

  onPagination(page: any): void {
    const n = Number(page);
    this.loadTickets(Number.isFinite(n) && n > 0 ? n : 1);
  }

  loadTickets(page = 1): void {
    this.loading = true;
    this.trim
      .listTickets({
        page,
        limit: 15,
        branch_id: this.branchId || undefined,
        userId: this.globals.currentUser?._id,
      })
      .subscribe({
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

  sourceName(t: TrimTicket): string {
    if (t.sourceProductName) return t.sourceProductName;
    return t.sourceProductId && t.sourceProductId.name ? t.sourceProductId.name : '';
  }

  outputsLabel(t: TrimTicket): string {
    return (t.outputs || [])
      .map((o) => `${o.name || o.code || ''} ${o.quantity}`)
      .join('، ');
  }
}
