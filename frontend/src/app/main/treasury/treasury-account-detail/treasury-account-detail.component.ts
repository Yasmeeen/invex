import { Component, OnDestroy, OnInit } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { ActivatedRoute, Router } from '@angular/router';
import { Globals } from '@core/globals';
import { PaginationData } from '@core/models/users-interfaces.model';
import { canPickBranchRole } from '@core/utils/role-utils';
import { TranslateService } from '@ngx-translate/core';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { BranchesServce } from '@shared/services/branches.service';
import {
  MoneyAccountKind,
  TreasuryAccountsService,
  TreasuryLedgerEntry,
} from '@shared/services/treasury-accounts.service';
import { Subscription } from 'rxjs';
import { TreasuryOpeningDialogComponent } from '../treasury-opening-dialog/treasury-opening-dialog.component';
import { TreasuryTransferDialogComponent } from '../treasury-transfer-dialog/treasury-transfer-dialog.component';
import { TreasuryDepositDialogComponent } from '../treasury-deposit-dialog/treasury-deposit-dialog.component';
import { TreasurySettleDialogComponent } from '../treasury-settle-dialog/treasury-settle-dialog.component';

@Component({
  selector: 'app-treasury-account-detail',
  templateUrl: './treasury-account-detail.component.html',
  styleUrls: ['./treasury-account-detail.component.scss'],
})
export class TreasuryAccountDetailComponent implements OnInit, OnDestroy {
  accountKey = '';
  filterBranchId = '';
  branches: { _id: string; name?: string }[] = [];
  label = '';
  kind: MoneyAccountKind = 'treasury';
  channel = '';
  accountNumber = '';
  phone = '';
  expectedBalance = 0;
  openingBalance = 0;
  entries: TreasuryLedgerEntry[] = [];
  linkedPaymentMethods: Array<{ key: string; label: string }> = [];
  selectedMethodKeys: string[] = [];
  methodTotals: Array<{ key: string; label: string; inTotal: number; outTotal: number; net: number }> = [];
  loading = true;
  isNotAuthorized = false;
  dateFrom = '';
  dateTo = '';
  dateFromModel: Date | null = null;
  dateToModel: Date | null = null;
  isFilterOpen = true;
  paginationData: PaginationData;
  page = 1;
  limit = 30;

  private subscriptions: Subscription[] = [];

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private treasury: TreasuryAccountsService,
    private branchesService: BranchesServce,
    private dialog: MatDialog,
    private notify: AppNotificationService,
    private translate: TranslateService,
    public globals: Globals
  ) {}

  ngOnInit(): void {
    this.filterBranchId = this.route.snapshot.queryParamMap.get('branch') || '';
    if (!this.canPickBranch) {
      this.filterBranchId = String(this.globals.currentUser?.branch || '');
    }
    if (this.canPickBranch) {
      this.subscriptions.push(
        this.branchesService.getBranchs({ page: 1, limit: 1000 }).subscribe({
          next: (res: any) => (this.branches = res?.branches || []),
          error: () => (this.branches = []),
        })
      );
    }
    this.subscriptions.push(
      this.route.paramMap.subscribe((pm) => {
        this.accountKey = pm.get('accountKey') || '';
        this.loadAll();
      })
    );
  }

  get canPickBranch(): boolean {
    return canPickBranchRole(this.globals.currentUser?.role);
  }

  get isSettlement(): boolean {
    return this.kind === 'settlement';
  }

  get isCashAccount(): boolean {
    return this.accountKey === 'cash' || this.kind === 'cash';
  }

  get canSetOpening(): boolean {
    if (this.isCashAccount) return false;
    const r = this.globals.currentUser?.role;
    return r === 'Super Admin' || r === 'Co Admin' || r === 'Branch Manager';
  }

  get canDeposit(): boolean {
    return this.canSetOpening && !this.isSettlement;
  }

  get showBranchColumn(): boolean {
    return this.canPickBranch && !this.filterBranchId;
  }

  get pageTitle(): string {
    return this.prettyTreasuryKey(this.accountKey, this.label);
  }

  prettyTreasuryKey(key?: string, fallback = ''): string {
    const k = String(key || '')
      .trim()
      .toLowerCase();
    const fb = String(fallback || '').trim();
    if (fb && fb !== k) return fb;
    if (!k) return fb || '—';
    const i18nKey = `tr_treasury_${k}`;
    const tr = this.translate.instant(i18nKey);
    if (tr && tr !== i18nKey) return tr;
    return fb || k;
  }

  counterLabel(e: TreasuryLedgerEntry): string {
    const fromApi = String(e?.counterAccountLabel || '').trim();
    if (fromApi) return fromApi;
    return this.prettyTreasuryKey(e?.counterAccountKey);
  }

  noteLabel(e: TreasuryLedgerEntry): string {
    const note = String(e?.note || '').trim();
    if (!note) return '—';
    return this.prettyTreasuryKey(note, note);
  }

  private toIsoDateOnly(value: Date | string | null | undefined): string {
    if (!value) return '';
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  onDateFromChange(value: Date | null): void {
    this.dateFromModel = value;
    this.dateFrom = this.toIsoDateOnly(value);
  }

  onDateToChange(value: Date | null): void {
    this.dateToModel = value;
    this.dateTo = this.toIsoDateOnly(value);
  }

  loadAll(): void {
    this.loadHeader();
    this.loadLedger();
  }

  loadHeader(): void {
    const uid = this.globals.currentUser?._id;
    if (!uid || !this.accountKey) return;
    const params: { key: string; userId: string; branch?: string } = {
      key: this.accountKey,
      userId: uid,
    };
    if (!this.canPickBranch && this.filterBranchId) {
      params.branch = this.filterBranchId;
    }
    this.subscriptions.push(
      this.treasury.getAccount(params).subscribe({
        next: (res) => {
          this.label = res.account?.label || this.accountKey;
          this.kind = res.account?.kind || 'treasury';
          this.channel = res.account?.channel || '';
          this.accountNumber = res.account?.accountNumber || '';
          this.phone = res.account?.phone || '';
          this.expectedBalance = res.expectedBalance;
          this.openingBalance = res.openingBalance;
          this.linkedPaymentMethods = res.linkedPaymentMethods || [];
          const allowed = new Set(this.linkedPaymentMethods.map((x) => x.key));
          this.selectedMethodKeys = this.selectedMethodKeys.filter((m) => allowed.has(m));
        },
        error: (err) => {
          this.isNotAuthorized = err.status === 403;
          if (!this.isNotAuthorized) {
            this.notify.push(
              err?.error?.error || this.translate.instant('tr_unexpected_error_message'),
              'error'
            );
          }
        },
      })
    );
  }

  loadLedger(): void {
    const uid = this.globals.currentUser?._id;
    if (!uid || !this.accountKey) {
      this.loading = false;
      return;
    }
    this.loading = true;
    this.subscriptions.push(
      this.treasury
        .listLedger({
          key: this.accountKey,
          userId: uid,
          branch: this.filterBranchId || undefined,
          from: this.dateFrom || undefined,
          to: this.dateTo || undefined,
          methods: this.selectedMethodKeys,
          page: this.page,
          limit: this.limit,
        })
        .subscribe({
          next: (res) => {
            this.entries = res.entries || [];
            this.linkedPaymentMethods = res.linkedPaymentMethods || this.linkedPaymentMethods;
            this.methodTotals = res.methodTotals || [];
            this.paginationData = {
              currentPage: res.page,
              totalCount: res.total,
              totalPages: Math.max(1, Math.ceil(res.total / res.limit)),
              nextPage: res.page + 1,
              prevPage: res.page - 1,
            };
            this.loading = false;
          },
          error: (err) => {
            this.loading = false;
            this.isNotAuthorized = err.status === 403;
            if (!this.isNotAuthorized) {
              this.notify.push(
                err?.error?.error || this.translate.instant('tr_unexpected_error_message'),
                'error'
              );
            }
          },
        })
    );
  }

  applyFilters(): void {
    this.page = 1;
    this.loadLedger();
  }

  onPageChange(page: number): void {
    this.page = page;
    this.loadLedger();
  }

  sourceLabel(t: string): string {
    const key = `tr_treasury_source_${t}`;
    const tr = this.translate.instant(key);
    return tr === key ? t : tr;
  }

  methodLabel(key: string): string {
    const k = String(key || '').trim().toLowerCase();
    const row = this.linkedPaymentMethods.find((x) => String(x.key || '').toLowerCase() === k);
    return row?.label || this.prettyTreasuryKey(k, k);
  }

  back(): void {
    this.router.navigate(['/treasury']);
  }

  openTransfer(isSettlement = false): void {
    const ref = this.dialog.open(TreasuryTransferDialogComponent, {
      width: '480px',
      panelClass: 'treasury-transfer-dialog-panel',
      data: {
        branchId: isSettlement ? '' : this.filterBranchId,
        isSettlement,
        preferFrom: this.accountKey,
      },
    });
    this.subscriptions.push(
      ref.afterClosed().subscribe((ok) => {
        if (ok) this.loadAll();
      })
    );
  }

  openDeposit(): void {
    if (!this.canDeposit) return;
    const ref = this.dialog.open(TreasuryDepositDialogComponent, {
      width: '480px',
      panelClass: 'treasury-transfer-dialog-panel',
      data: {
        branchId: this.filterBranchId,
        preferAccount: this.accountKey,
      },
    });
    this.subscriptions.push(
      ref.afterClosed().subscribe((ok) => {
        if (ok) this.loadAll();
      })
    );
  }

  openQuickSettle(): void {
    const ref = this.dialog.open(TreasurySettleDialogComponent, {
      width: '420px',
      panelClass: 'treasury-transfer-dialog-panel',
      data: {
        methodKey: this.accountKey,
        label: this.label,
      },
    });
    this.subscriptions.push(
      ref.afterClosed().subscribe((ok) => {
        if (ok) this.loadAll();
      })
    );
  }

  openOpening(): void {
    const ref = this.dialog.open(TreasuryOpeningDialogComponent, {
      width: '420px',
      panelClass: 'treasury-transfer-dialog-panel',
      data: {
        branchId: this.canPickBranch ? '' : this.filterBranchId,
        applyAllBranches: this.canPickBranch,
        accountKey: this.accountKey,
        label: this.label,
        currentOpening: this.openingBalance,
      },
    });
    this.subscriptions.push(
      ref.afterClosed().subscribe((ok) => {
        if (ok) this.loadAll();
      })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach((s) => s.unsubscribe());
  }
}
