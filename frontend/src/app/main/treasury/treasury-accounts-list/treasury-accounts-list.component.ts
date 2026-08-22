import { Component, Input, OnDestroy, OnInit } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { Globals } from '@core/globals';
import { Branch } from '@core/models/products.model';
import { canPickBranchRole } from '@core/utils/role-utils';
import { TranslateService } from '@ngx-translate/core';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { BranchesServce } from '@shared/services/branches.service';
import { StoreSettingsService } from '@shared/services/store-settings.service';
import {
  MoneyAccountBalance,
  TreasuryAccountsService,
  TreasuryRecentEntry,
} from '@shared/services/treasury-accounts.service';
import * as Highcharts from 'highcharts';
import { forkJoin, of, Subscription } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { TreasuryTransferDialogComponent } from '../treasury-transfer-dialog/treasury-transfer-dialog.component';
import { TreasuryDepositDialogComponent } from '../treasury-deposit-dialog/treasury-deposit-dialog.component';
import { TreasurySettleDialogComponent } from '../treasury-settle-dialog/treasury-settle-dialog.component';

export type TreasuryDisplayType = 'cash' | 'bank' | 'wallet' | 'settlement';

type SummaryBucket = {
  type: TreasuryDisplayType;
  total: number;
  count: number;
};

@Component({
  selector: 'app-treasury-accounts-list',
  templateUrl: './treasury-accounts-list.component.html',
  styleUrls: ['./treasury-accounts-list.component.scss'],
})
export class TreasuryAccountsListComponent implements OnInit, OnDestroy {
  @Input() asSection = false;

  accounts: MoneyAccountBalance[] = [];
  recentEntries: TreasuryRecentEntry[] = [];
  loading = true;
  isNotAuthorized = false;
  branches: Branch[] = [];
  filterBranchId = '';
  untilDate = '';
  searchQuery = '';
  typeFilter: '' | TreasuryDisplayType = '';
  page = 1;
  readonly pageSize = 8;

  private subscriptions: Subscription[] = [];
  private chart?: Highcharts.Chart;

  constructor(
    private treasury: TreasuryAccountsService,
    private dialog: MatDialog,
    private branchesService: BranchesServce,
    private notify: AppNotificationService,
    private translate: TranslateService,
    private router: Router,
    private storeSettings: StoreSettingsService,
    public globals: Globals
  ) {}

  ngOnInit(): void {
    this.storeSettings.load();
    if (canPickBranchRole(this.globals.currentUser?.role)) {
      this.subscriptions.push(
        this.branchesService.getBranchs({ page: 1, limit: 1000 }).subscribe({
          next: (res: any) => {
            this.branches = res?.branches || [];
            this.load();
          },
          error: () => {
            this.notify.push(this.translate.instant('tr_unexpected_error_message'), 'error');
            this.load();
          },
        })
      );
    } else {
      this.filterBranchId = String(this.globals.currentUser?.branch || '');
      this.load();
    }
  }

  get showBranchFilter(): boolean {
    return canPickBranchRole(this.globals.currentUser?.role);
  }

  get canDeposit(): boolean {
    const r = this.globals.currentUser?.role;
    return r === 'Super Admin' || r === 'Co Admin' || r === 'Branch Manager';
  }

  get summaries(): SummaryBucket[] {
    const buckets: Record<TreasuryDisplayType, SummaryBucket> = {
      cash: { type: 'cash', total: 0, count: 0 },
      bank: { type: 'bank', total: 0, count: 0 },
      wallet: { type: 'wallet', total: 0, count: 0 },
      settlement: { type: 'settlement', total: 0, count: 0 },
    };
    for (const acc of this.accounts) {
      const t = this.displayType(acc);
      buckets[t].total += Number(acc.expectedBalance) || 0;
      buckets[t].count += 1;
    }
    return [buckets.cash, buckets.bank, buckets.wallet, buckets.settlement];
  }

  get totalBalance(): number {
    return this.summaries.reduce((sum, s) => sum + s.total, 0);
  }

  get filteredAccounts(): MoneyAccountBalance[] {
    const q = this.searchQuery.trim().toLowerCase();
    return this.accounts.filter((acc) => {
      if (this.typeFilter && this.displayType(acc) !== this.typeFilter) return false;
      if (!q) return true;
      const ref = this.accountRef(acc).toLowerCase();
      return (
        String(acc.label || '')
          .toLowerCase()
          .includes(q) ||
        String(acc.key || '')
          .toLowerCase()
          .includes(q) ||
        ref.includes(q)
      );
    });
  }

  get pagedAccounts(): MoneyAccountBalance[] {
    const start = (this.page - 1) * this.pageSize;
    return this.filteredAccounts.slice(start, start + this.pageSize);
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.filteredAccounts.length / this.pageSize));
  }

  get settlementAccounts(): MoneyAccountBalance[] {
    return this.accounts
      .filter((a) => a.kind === 'settlement')
      .sort((a, b) => (Number(b.expectedBalance) || 0) - (Number(a.expectedBalance) || 0));
  }

  get pendingSettlementsTotal(): number {
    return this.settlementAccounts.reduce((sum, a) => sum + (Number(a.expectedBalance) || 0), 0);
  }

  load(): void {
    const uid = this.globals.currentUser?._id;
    if (!uid) {
      this.loading = false;
      return;
    }
    if (!this.showBranchFilter && !this.filterBranchId) {
      this.loading = false;
      return;
    }
    this.loading = true;
    const branch = this.filterBranchId || undefined;
    this.subscriptions.push(
      forkJoin({
        accounts: this.treasury.listAccounts({
          userId: uid,
          branch,
          until: this.untilDate || undefined,
          includeSettlement: true,
        }),
        recent: this.treasury
          .listRecent({ userId: uid, branch, limit: 8 })
          .pipe(catchError(() => of({ branch: branch || null, entries: [] }))),
      }).subscribe({
        next: ({ accounts, recent }) => {
          this.accounts = accounts.accounts || [];
          this.recentEntries = recent.entries || [];
          this.page = 1;
          this.loading = false;
          setTimeout(() => this.renderDonut(), 0);
        },
        error: (err) => {
          this.loading = false;
          this.isNotAuthorized = err.status === 403;
          if (!this.isNotAuthorized) {
            const msg =
              err?.error?.error || this.translate.instant('tr_unexpected_error_message');
            this.notify.push(msg, 'error');
          }
        },
      })
    );
  }

  onFiltersChanged(): void {
    this.page = 1;
  }

  displayType(acc: MoneyAccountBalance): TreasuryDisplayType {
    if (acc.kind === 'cash') return 'cash';
    if (acc.kind === 'settlement') return 'settlement';
    if (acc.channel === 'wallet') return 'wallet';
    return 'bank';
  }

  typeLabel(type: TreasuryDisplayType | string): string {
    const map: Record<string, string> = {
      cash: 'tr_treasury_type_cash',
      bank: 'tr_treasury_type_bank',
      wallet: 'tr_treasury_type_wallet',
      settlement: 'tr_treasury_type_settlement',
    };
    return this.translate.instant(map[type] || 'tr_treasury_kind_treasury');
  }

  typeIcon(type: TreasuryDisplayType | string): string {
    if (type === 'cash') return 'fa-money';
    if (type === 'wallet') return 'fa-mobile';
    if (type === 'settlement') return 'fa-credit-card';
    return 'fa-university';
  }

  accountRef(acc: MoneyAccountBalance): string {
    if (acc?.channel === 'bank' && acc.accountNumber) {
      return `${this.translate.instant('tr_money_account_number_short')}: ${acc.accountNumber}`;
    }
    if (acc?.channel === 'wallet' && acc.phone) {
      return `${this.translate.instant('tr_money_account_phone_short')}: ${acc.phone}`;
    }
    return '';
  }

  sourceLabel(sourceType: string): string {
    const key = `tr_treasury_source_${sourceType}`;
    const translated = this.translate.instant(key);
    return translated === key
      ? this.translate.instant('tr_treasury_source_other')
      : translated;
  }

  signedAmount(entry: TreasuryRecentEntry): number {
    const amt = Number(entry.amount) || 0;
    return entry.direction === 'out' ? -amt : amt;
  }

  movementPath(entry: TreasuryRecentEntry): string {
    if (entry.counterAccountLabel) {
      if (entry.direction === 'out') {
        return `${entry.accountLabel} → ${entry.counterAccountLabel}`;
      }
      return `${entry.counterAccountLabel} → ${entry.accountLabel}`;
    }
    return entry.accountLabel || entry.accountKey;
  }

  openAccount(acc: MoneyAccountBalance): void {
    this.router.navigate(['/treasury', acc.key], {
      queryParams: this.filterBranchId ? { branch: this.filterBranchId } : {},
    });
  }

  openQuickSettle(acc: MoneyAccountBalance): void {
    if (acc?.kind !== 'settlement') return;
    const ref = this.dialog.open(TreasurySettleDialogComponent, {
      width: '420px',
      panelClass: 'treasury-transfer-dialog-panel',
      data: {
        methodKey: acc.key,
        label: acc.label,
      },
    });
    this.subscriptions.push(
      ref.afterClosed().subscribe((ok) => {
        if (ok) this.load();
      })
    );
  }

  openTransfer(isSettlement = false): void {
    const ref = this.dialog.open(TreasuryTransferDialogComponent, {
      width: '480px',
      panelClass: 'treasury-transfer-dialog-panel',
      data: {
        branchId: isSettlement ? '' : this.filterBranchId,
        accounts: this.accounts,
        isSettlement,
      },
    });
    this.subscriptions.push(
      ref.afterClosed().subscribe((ok) => {
        if (ok) this.load();
      })
    );
  }

  openDeposit(): void {
    if (!this.canDeposit) return;
    const branches = this.showBranchFilter ? this.branches : [];
    const ref = this.dialog.open(TreasuryDepositDialogComponent, {
      width: '480px',
      panelClass: 'treasury-transfer-dialog-panel',
      data: {
        branchId: this.filterBranchId,
        branches,
        accounts: this.filterBranchId ? this.accounts : undefined,
      },
    });
    this.subscriptions.push(
      ref.afterClosed().subscribe((ok) => {
        if (ok) this.load();
      })
    );
  }

  openNewAccount(): void {
    this.router.navigate(['/treasury/config/treasuries']);
  }

  openStatement(): void {
    const cash = this.accounts.find((a) => a.kind === 'cash');
    const target = cash || this.accounts[0];
    if (!target) {
      this.notify.push(this.translate.instant('tr_no_items_found'), 'error');
      return;
    }
    this.openAccount(target);
  }

  goPage(delta: number): void {
    const next = this.page + delta;
    if (next < 1 || next > this.totalPages) return;
    this.page = next;
  }

  private renderDonut(): void {
    const el = document.getElementById('treasury-balance-donut');
    if (!el) return;
    const data = this.summaries
      .filter((s) => s.total > 0)
      .map((s) => ({
        name: this.typeLabel(s.type),
        y: Math.round((Number(s.total) || 0) * 100) / 100,
        color:
          s.type === 'cash'
            ? '#10b981'
            : s.type === 'bank'
              ? '#3b82f6'
              : s.type === 'wallet'
                ? '#8b5cf6'
                : '#f59e0b',
      }));

    if (this.chart) {
      this.chart.destroy();
      this.chart = undefined;
    }

    this.chart = Highcharts.chart('treasury-balance-donut', {
      chart: {
        type: 'pie',
        backgroundColor: 'transparent',
        height: 220,
        spacing: [8, 8, 8, 8],
      },
      title: { text: undefined },
      credits: { enabled: false },
      tooltip: {
        pointFormat: '<b>{point.y:,.2f}</b> ({point.percentage:.1f}%)',
      },
      plotOptions: {
        pie: {
          innerSize: '68%',
          dataLabels: { enabled: false },
          borderWidth: 0,
          showInLegend: false,
        },
      },
      series: [
        {
          type: 'pie',
          name: this.translate.instant('tr_treasury_balance_by_type'),
          data: data.length ? data : [{ name: '—', y: 1, color: '#e5e7eb' }],
        },
      ],
    } as Highcharts.Options);
  }

  ngOnDestroy(): void {
    if (this.chart) {
      this.chart.destroy();
      this.chart = undefined;
    }
    this.subscriptions.forEach((s) => s.unsubscribe());
  }
}
