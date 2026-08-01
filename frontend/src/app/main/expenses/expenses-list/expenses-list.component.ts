import { Component, OnDestroy, OnInit } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Globals } from '@core/globals';
import { PaginationData } from '@core/models/users-interfaces.model';
import { Branch } from '@core/models/products.model';
import { TranslateService } from '@ngx-translate/core';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { BranchesServce } from '@shared/services/branches.service';
import {
  DailyExpenseDto,
  DailyExpensesService,
} from '@shared/services/daily-expenses.service';
import { Subscription } from 'rxjs';
import { canPickBranchRole } from '@core/utils/role-utils';
import { DailyExpenseDialogComponent } from '../daily-expense-dialog/daily-expense-dialog.component';

export type ExpensesTab = 'operating' | 'cash_movements';

/** System types shown under «cash movements» (not operating costs / not in profit). */
const CASH_MOVEMENT_TYPE_KEYS: Record<string, string> = {
  client_prepaid_payout: 'tr_expense_type_client_prepaid_payout',
  desk_purchase_deferred_paid: 'tr_expense_type_desk_purchase_deferred_paid',
  exchange_settlement_paid: 'tr_expense_type_exchange_settlement_paid',
};

@Component({
  selector: 'app-expenses-list',
  templateUrl: './expenses-list.component.html',
  styleUrls: ['./expenses-list.component.scss'],
})
export class ExpensesListComponent implements OnInit, OnDestroy {
  expenses: DailyExpenseDto[] = [];
  loading = true;
  isNotAuthorized = false;
  isFilterOpen = true;
  paginationData: PaginationData;
  paginationPerPage = 15;
  /** Sum of filtered expenses (all matching pages). */
  totalAmount = 0;

  activeTab: ExpensesTab = 'operating';

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
    category?: ExpensesTab;
    viewerUserId: string;
  };

  private subscriptions: Subscription[] = [];

  constructor(
    private dailyExpenses: DailyExpensesService,
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
      category: this.activeTab,
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

  get isCashMovementsTab(): boolean {
    return this.activeTab === 'cash_movements';
  }

  get totalAmountLabelKey(): string {
    return this.isCashMovementsTab
      ? 'tr_daily_expenses_total_cash_movements'
      : 'tr_daily_expenses_total_amount';
  }

  get filteredCountKey(): string {
    return this.isCashMovementsTab
      ? 'tr_daily_expenses_filtered_count_movements'
      : 'tr_daily_expenses_filtered_count';
  }

  setTab(tab: ExpensesTab): void {
    if (this.activeTab === tab) return;
    this.activeTab = tab;
    this.params.category = tab;
    this.params.page = 1;
    this.load();
  }

  applyFilters(): void {
    this.params.page = 1;
    this.params.branch_id = this.filterBranchId || undefined;
    this.params.dateFrom = this.dateFrom || undefined;
    this.params.dateTo = this.dateTo || undefined;
    this.params.category = this.activeTab;
    this.load();
  }

  clearDateFilters(): void {
    this.dateFrom = '';
    this.dateTo = '';
    this.applyFilters();
  }

  load(): void {
    this.loading = true;
    this.params.category = this.activeTab;
    this.subscriptions.push(
      this.dailyExpenses.list(this.params).subscribe({
        next: (res) => {
          this.expenses = res.expenses || [];
          const m = res.meta;
          this.totalAmount = Number(m?.totalAmount) || 0;
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

  openAddDialog(): void {
    const uid = this.globals.currentUser?._id;
    let forced: string | null | undefined;

    if (canPickBranchRole(this.globals.currentUser?.role)) {
      forced = this.filterBranchId ? String(this.filterBranchId) : null;
    } else {
      const b = this.globals.currentUser?.branch as { _id?: string } | string | undefined;
      forced =
        typeof b === 'string'
          ? b
          : b?._id
            ? String(b._id)
            : null;
    }

    const ref = this.dialog.open(DailyExpenseDialogComponent, {
      width: '440px',
      panelClass: 'daily-expense-dialog-panel',
      backdropClass: 'daily-expense-dialog-backdrop',
      data: {
        userId: uid,
        forcedBranchId: forced || undefined,
      },
      disableClose: true,
    });

    this.subscriptions.push(
      ref.afterClosed().subscribe((ok) => {
        if (ok) {
          this.activeTab = 'operating';
          this.params.category = 'operating';
          this.params.page = 1;
          this.load();
        }
      })
    );
  }

  expenseTypeLabel(row: DailyExpenseDto): string {
    const raw = String(row?.expenseType || '').trim();
    if (!raw) return '—';
    const key = CASH_MOVEMENT_TYPE_KEYS[raw];
    if (key) return this.translate.instant(key);
    return raw;
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach((s) => s && s.unsubscribe());
  }

  expenseTreasuryDisplay(row: DailyExpenseDto): string {
    const splits = Array.isArray(row.expenseTreasurySplits) ? row.expenseTreasurySplits : [];
    if (splits.length > 1) {
      return splits
        .map((s) => {
          const name = String(s.label || s.key || '').trim();
          const amt = Number(s.amount);
          const amtStr = Number.isFinite(amt)
            ? new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(amt)
            : '0';
          return `${name}: ${amtStr}`;
        })
        .join(' · ');
    }
    const label = String(row.expenseTreasuryLabel || '').trim();
    const key = String(row.expenseTreasuryKey || '').trim();
    if (label) return label;
    if (key) return key;
    return '—';
  }
}
