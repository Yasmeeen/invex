import { Component, OnDestroy, OnInit, Optional } from '@angular/core';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { Globals } from '@core/globals';
import { Branch } from '@core/models/products.model';
import { PaginationData } from '@core/models/users-interfaces.model';
import { canPickBranchRole } from '@core/utils/role-utils';
import { TranslateService } from '@ngx-translate/core';
import { ConfirmationDialogComponent } from '@shared/components/confirmation-dialog/confirmation-dialog.component';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { BranchesServce } from '@shared/services/branches.service';
import {
  MoneyAccount,
  MoneyAccountChannel,
  StoreSettingsService,
} from '@shared/services/store-settings.service';
import { MoneyAccountsService } from '@shared/services/money-accounts.service';
import { PaymentMethodsService, PaymentMethodRecord } from '@shared/services/payment-methods.service';
import {
  MoneyAccountBalance,
  TreasuryAccountsService,
} from '@shared/services/treasury-accounts.service';
import { Subscription } from 'rxjs';
import {
  MoneyAccountFormDialogComponent,
  MoneyAccountFormResult,
} from '../money-account-form-dialog/money-account-form-dialog.component';
import { TreasuryTransferDialogComponent } from '../../../treasury/treasury-transfer-dialog/treasury-transfer-dialog.component';
import { TreasuryDepositDialogComponent } from '../../../treasury/treasury-deposit-dialog/treasury-deposit-dialog.component';
import { TreasurySettleDialogComponent } from '../../../treasury/treasury-settle-dialog/treasury-settle-dialog.component';

interface AccountUiRow {
  key: string;
  label: string;
  kind: 'cash' | 'treasury' | 'settlement';
  channel: MoneyAccountChannel | '';
  accountNumber: string;
  phone: string;
  enabled: boolean;
  expectedBalance: number | null;
}

type AccountKpiType = 'cash' | 'bank' | 'wallet' | 'settlement';

interface AccountKpi {
  type: AccountKpiType;
  total: number;
  count: number;
  labelKey: string;
  icon: string;
}

@Component({
  selector: 'app-purchase-treasury-dialog',
  templateUrl: './purchase-treasury-dialog.component.html',
  styleUrls: ['./purchase-treasury-dialog.component.scss'],
})
export class PurchaseTreasuryDialogComponent implements OnInit, OnDestroy {
  treasuryRows: AccountUiRow[] = [];
  saving = false;
  listLoading = true;
  loadingBalances = false;
  isFilterOpen = false;
  searchQuery = '';
  channelFilter: '' | AccountKpiType = '';
  page = 1;
  readonly paginationPerPage = 10;
  selectedBranchIds: string[] = [];
  branches: Branch[] = [];
  private lockedBranchId = '';

  private subscriptions: Subscription[] = [];
  private paymentMethods: PaymentMethodRecord[] = [];
  private accountBalances: MoneyAccountBalance[] = [];

  constructor(
    @Optional() private dialogRef: MatDialogRef<PurchaseTreasuryDialogComponent>,
    private dialog: MatDialog,
    private storeSettingsService: StoreSettingsService,
    private moneyAccounts: MoneyAccountsService,
    private paymentMethodsApi: PaymentMethodsService,
    private treasury: TreasuryAccountsService,
    private branchesService: BranchesServce,
    private notify: AppNotificationService,
    private translate: TranslateService,
    private globals: Globals,
    private router: Router
  ) {}

  get isDialog(): boolean {
    return !!this.dialogRef;
  }

  get showBranchFilter(): boolean {
    return canPickBranchRole(this.globals.currentUser?.role);
  }

  get effectiveBranchIds(): string[] {
    if (!this.showBranchFilter) {
      return this.lockedBranchId ? [this.lockedBranchId] : [];
    }
    if (this.selectedBranchIds?.length) {
      return this.selectedBranchIds.map((id) => String(id));
    }
    return (this.branches || []).map((b) => String(b._id));
  }

  get singleBranchId(): string {
    const ids = this.effectiveBranchIds;
    return ids.length === 1 ? ids[0] : '';
  }

  get listReady(): boolean {
    return !this.listLoading;
  }

  get summaries(): AccountKpi[] {
    const buckets: Record<AccountKpiType, AccountKpi> = {
      cash: {
        type: 'cash',
        total: 0,
        count: 0,
        labelKey: 'tr_treasury_type_cash',
        icon: 'fa-money',
      },
      bank: {
        type: 'bank',
        total: 0,
        count: 0,
        labelKey: 'tr_treasury_type_bank',
        icon: 'fa-university',
      },
      wallet: {
        type: 'wallet',
        total: 0,
        count: 0,
        labelKey: 'tr_treasury_type_wallet',
        icon: 'fa-mobile',
      },
      settlement: {
        type: 'settlement',
        total: 0,
        count: 0,
        labelKey: 'tr_treasury_kpi_settlements',
        icon: 'fa-credit-card',
      },
    };
    for (const row of this.treasuryRows) {
      const t = this.rowDisplayChannel(row);
      buckets[t].total += Number(row.expectedBalance) || 0;
      buckets[t].count += 1;
    }
    return [buckets.cash, buckets.bank, buckets.wallet, buckets.settlement];
  }

  get totalBalance(): number {
    return this.summaries.reduce((sum, s) => sum + s.total, 0);
  }

  get totalAccountsCount(): number {
    return this.treasuryRows.length;
  }

  get filteredRows(): AccountUiRow[] {
    const q = this.searchQuery.trim().toLowerCase();
    return this.treasuryRows.filter((row) => {
      const ch = this.rowDisplayChannel(row);
      if (this.channelFilter && ch !== this.channelFilter) return false;
      if (!q) return true;
      return (
        String(row.label || '')
          .toLowerCase()
          .includes(q) ||
        String(row.key || '')
          .toLowerCase()
          .includes(q) ||
        String(row.accountNumber || '')
          .toLowerCase()
          .includes(q) ||
        String(row.phone || '')
          .toLowerCase()
          .includes(q)
      );
    });
  }

  get pagedRows(): AccountUiRow[] {
    const start = (this.page - 1) * this.paginationPerPage;
    return this.filteredRows.slice(start, start + this.paginationPerPage);
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.filteredRows.length / this.paginationPerPage));
  }

  get paginationData(): PaginationData {
    const totalCount = this.filteredRows.length;
    const totalPages = this.totalPages;
    const currentPage = Math.min(Math.max(1, this.page), totalPages);
    return {
      currentPage,
      totalPages,
      totalCount,
      nextPage: currentPage < totalPages ? currentPage + 1 : currentPage,
      prevPage: currentPage > 1 ? currentPage - 1 : 1,
    };
  }

  ngOnInit(): void {
    this.loadPaymentMethods();
    this.resolveBranchAndLoadList();
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach((s) => s.unsubscribe());
  }

  onFiltersChanged(): void {
    this.page = 1;
  }

  onBranchChanged(): void {
    this.selectedBranchIds = Array.isArray(this.selectedBranchIds) ? this.selectedBranchIds : [];
    this.page = 1;
    this.loadList();
  }

  selectKpi(type: '' | AccountKpiType): void {
    this.channelFilter = type;
    this.onFiltersChanged();
  }

  paginationUpdate(page: number): void {
    this.page = page;
  }

  rowDisplayChannel(row: AccountUiRow): AccountKpiType {
    if (row.kind === 'settlement') return 'settlement';
    if (row.key === 'cash' || row.kind === 'cash') return 'cash';
    return row.channel === 'wallet' ? 'wallet' : 'bank';
  }

  canManageRow(row: AccountUiRow): boolean {
    return row.key !== 'cash';
  }

  channelIcon(row: AccountUiRow): string {
    const ch = this.rowDisplayChannel(row);
    if (ch === 'cash') return 'fa-money';
    if (ch === 'wallet') return 'fa-mobile';
    if (ch === 'settlement') return 'fa-credit-card';
    return 'fa-university';
  }

  typeLabelKey(row: AccountUiRow): string {
    const ch = this.rowDisplayChannel(row);
    if (ch === 'cash') return 'tr_treasury_type_cash';
    if (ch === 'wallet') return 'tr_money_account_channel_wallet';
    if (ch === 'settlement') return 'tr_treasury_type_settlement';
    return 'tr_money_account_channel_bank';
  }

  openAdd(): void {
    const kind: 'settlement' | 'treasury' =
      this.channelFilter === 'settlement' ? 'settlement' : 'treasury';
    const channel =
      kind === 'settlement' ? '' : this.channelFilter === 'wallet' ? 'wallet' : 'bank';
    this.openFormDialog({ mode: 'add', kind, channel, enabled: true });
  }

  openTransfer(): void {
    if (this.saving) return;
    const branches = this.showBranchFilter ? this.branches : [];
    const branchId =
      this.singleBranchId || (branches.length === 1 ? String(branches[0]._id) : '');
    const ref = this.dialog.open(TreasuryTransferDialogComponent, {
      width: '480px',
      panelClass: 'treasury-transfer-dialog-panel',
      data: {
        branchId,
        branches,
        accounts: this.singleBranchId ? this.accountBalances : undefined,
      },
    });
    this.subscriptions.push(
      ref.afterClosed().subscribe((ok) => {
        if (ok) this.loadList({ silent: true });
      })
    );
  }

  openDeposit(row?: AccountUiRow): void {
    if (this.saving) return;
    if (row?.kind === 'settlement') return;
    const branches = this.showBranchFilter ? this.branches : [];
    const branchId =
      this.singleBranchId || (branches.length === 1 ? String(branches[0]._id) : '');
    const ref = this.dialog.open(TreasuryDepositDialogComponent, {
      width: '480px',
      panelClass: 'treasury-transfer-dialog-panel',
      data: {
        branchId,
        branches,
        accounts: this.singleBranchId ? this.accountBalances : undefined,
        preferAccount: row?.key,
      },
    });
    this.subscriptions.push(
      ref.afterClosed().subscribe((ok) => {
        if (ok) this.loadList({ silent: true });
      })
    );
  }

  openEdit(row: AccountUiRow): void {
    if (!this.canManageRow(row)) return;
    this.openFormDialog({
      mode: 'edit',
      key: row.key,
      label: row.label,
      kind: row.kind === 'settlement' ? 'settlement' : 'treasury',
      channel: row.channel,
      accountNumber: row.accountNumber,
      phone: row.phone,
      enabled: row.enabled !== false,
    });
  }

  removeRow(row: AccountUiRow): void {
    if (!this.canManageRow(row) || this.saving) return;
    const idx = this.treasuryRows.findIndex((r) => r === row || r.key === row.key);
    if (idx < 0) return;

    const name = String(row.label || row.key).trim();
    const bal = row.expectedBalance;
    const hasBalance = bal !== null && Number.isFinite(bal) && Math.abs(bal) >= 0.01;
    const balanceUnknown = bal === null;
    const amount = this.formatBalanceAmount(bal);

    const message = this.translate.instant('tr_money_account_delete_confirm', { name });
    const details: string[] = [];
    if (hasBalance) {
      details.push(this.translate.instant('tr_money_account_delete_has_balance', { name, amount }));
      details.push(this.translate.instant('tr_money_account_delete_has_balance_hint'));
    } else if (balanceUnknown) {
      details.push(this.translate.instant('tr_money_account_delete_balance_unknown'));
    }

    const linked = this.linkedPaymentMethodLabels(row.key);
    if (linked.receiving.length) {
      details.push(
        this.translate.instant('tr_money_account_delete_linked_methods', {
          methods: this.joinMethodNames(linked.receiving),
        })
      );
    }
    if (linked.settlement.length) {
      details.push(
        this.translate.instant('tr_money_account_delete_linked_settlement', {
          methods: this.joinMethodNames(linked.settlement),
        })
      );
    }

    const ref = this.dialog.open(ConfirmationDialogComponent, {
      width: '480px',
      disableClose: true,
      data: {
        title: this.translate.instant('tr_money_account_delete_title'),
        message,
        details,
        buttons: [
          {
            label: this.translate.instant('tr_action.cancel'),
            actionCallback: 'cancel',
            type: 'btn-secondary',
          },
          {
            label: this.translate.instant('tr_action.delete'),
            actionCallback: 'delete',
            type: 'btn-danger',
          },
        ],
      },
    });
    this.subscriptions.push(
      ref.afterClosed().subscribe((result) => {
        if (result !== 'delete') return;
        this.deleteAccount(row.key);
      })
    );
  }

  private formatBalanceAmount(value: number | null): string {
    const n = Number(value);
    if (!Number.isFinite(n)) return '0.00';
    return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  private joinMethodNames(names: string[]): string {
    const sep = this.translate.currentLang === 'ar' ? '، ' : ', ';
    return names.join(sep);
  }

  private linkedPaymentMethodLabels(accountKey: string): { receiving: string[]; settlement: string[] } {
    const key = String(accountKey || '').toLowerCase();
    const receiving: string[] = [];
    const settlement: string[] = [];
    const seenReceiving = new Set<string>();
    const seenSettlement = new Set<string>();
    for (const row of this.paymentMethods) {
      const method = String(row.key || '').toLowerCase();
      if (!method || method === 'cash' || method === 'credit' || method === 'mixed') continue;
      if (String(row.accountKey || '').toLowerCase() === key && !seenReceiving.has(method)) {
        seenReceiving.add(method);
        receiving.push(String(row.label || method).trim());
      }
      if (
        String(row.settlementBankAccountKey || '').toLowerCase() === key &&
        !seenSettlement.has(method)
      ) {
        seenSettlement.add(method);
        settlement.push(String(row.label || method).trim());
      }
    }
    return { receiving, settlement };
  }

  openQuickSettle(row: AccountUiRow): void {
    if (row.kind !== 'settlement') return;
    const ref = this.dialog.open(TreasurySettleDialogComponent, {
      width: '420px',
      panelClass: 'treasury-transfer-dialog-panel',
      data: {
        methodKey: row.key,
        label: row.label,
      },
    });
    this.subscriptions.push(
      ref.afterClosed().subscribe((ok) => {
        if (ok) this.loadList({ silent: true });
      })
    );
  }

  openStatement(row: AccountUiRow): void {
    this.router.navigate(['/treasury', row.key]);
  }

  toggleEnabled(row: AccountUiRow): void {
    if (!this.canManageRow(row) || this.saving) return;
    this.saving = true;
    this.subscriptions.push(
      this.moneyAccounts.update(row.key, { enabled: row.enabled === false }).subscribe({
        next: () => this.afterAccountMutation(),
        error: () => this.onAccountMutationError(),
      })
    );
  }

  cancel(): void {
    this.dialogRef?.close(false);
  }

  private openFormDialog(data: {
    mode: 'add' | 'edit';
    key?: string;
    label?: string;
    kind?: 'cash' | 'treasury' | 'settlement';
    channel?: MoneyAccountChannel | '';
    accountNumber?: string;
    phone?: string;
    enabled?: boolean;
  }): void {
    const ref = this.dialog.open(MoneyAccountFormDialogComponent, {
      width: '440px',
      panelClass: 'money-account-form-dialog-panel',
      backdropClass: 'money-account-form-dialog-backdrop',
      data,
    });
    this.subscriptions.push(
      ref.afterClosed().subscribe((result: MoneyAccountFormResult | false | undefined) => {
        if (!result) return;
        if (data.mode === 'add') {
          this.applyAdd(result);
        } else {
          this.applyEdit(result);
        }
      })
    );
  }

  private applyAdd(result: MoneyAccountFormResult): void {
    this.saving = true;
    this.subscriptions.push(
      this.moneyAccounts
        .create({
          label: result.label,
          kind: result.kind === 'settlement' ? 'settlement' : 'treasury',
          channel: result.kind === 'settlement' ? '' : result.channel === 'wallet' ? 'wallet' : 'bank',
          accountNumber: result.accountNumber,
          phone: result.phone,
          enabled: result.enabled !== false,
        })
        .subscribe({
          next: () => this.afterAccountMutation(),
          error: () => this.onAccountMutationError(),
        })
    );
  }

  private applyEdit(result: MoneyAccountFormResult): void {
    if (!result.key) return;
    this.saving = true;
    this.subscriptions.push(
      this.moneyAccounts
        .update(result.key, {
          label: result.label,
          channel: result.kind === 'settlement' ? '' : result.channel === 'wallet' ? 'wallet' : 'bank',
          accountNumber: result.accountNumber,
          phone: result.phone,
          enabled: result.enabled !== false,
        })
        .subscribe({
          next: () => this.afterAccountMutation(),
          error: () => this.onAccountMutationError(),
        })
    );
  }

  private deleteAccount(key: string): void {
    if (!key || key === 'cash' || this.saving) return;
    this.saving = true;
    this.subscriptions.push(
      this.moneyAccounts.delete(key).subscribe({
        next: () => this.afterAccountMutation(),
        error: () => this.onAccountMutationError(),
      })
    );
  }

  private afterAccountMutation(): void {
    this.saving = false;
    this.notify.push(this.translate.instant('tr_settings_saved'), 'success');
    this.storeSettingsService.load();
    this.loadPaymentMethods();
    this.loadList({ silent: true });
  }

  private onAccountMutationError(): void {
    this.saving = false;
    this.notify.push(this.translate.instant('tr_unexpected_error_message'), 'error');
    this.loadList({ silent: true });
  }

  private loadPaymentMethods(): void {
    this.subscriptions.push(
      this.paymentMethodsApi.list().subscribe({
        next: (res) => {
          this.paymentMethods = res.paymentMethods || [];
        },
        error: () => {},
      })
    );
  }

  private loadRowsFromSettings(): void {
    const money = this.storeSettingsService.snapshot.moneyAccounts || [];
    const methods = this.storeSettingsService.snapshot.purchaseTreasuryMethods || [];
    const editable = money.filter((a) => a.kind === 'cash' || a.kind === 'treasury');

    if (money.length > 1 || (money.length === 1 && money[0].key !== 'cash')) {
      this.treasuryRows = money.map((a) => this.toUiRow(a));
      this.clampPage();
      return;
    }

    // moneyAccounts may be cash-only while purchaseTreasuryMethods still has the saved list
    if (methods.length > 1) {
      const extrasByKey = new Map(editable.map((a) => [a.key, a]));
      this.treasuryRows = methods.map((m) =>
        this.toUiRow(
          extrasByKey.get(String(m.key || '').toLowerCase()) || {
            key: m.key,
            label: m.label,
            kind: m.key === 'cash' ? 'cash' : 'treasury',
            channel: m.key === 'cash' ? '' : this.guessChannel(m.key),
            accountNumber: '',
            phone: '',
            enabled: true,
          }
        )
      );
      this.clampPage();
      return;
    }

    if (editable.length) {
      this.treasuryRows = editable.map((a) => this.toUiRow(a));
      this.clampPage();
      return;
    }

    this.treasuryRows = [
      this.toUiRow({
        key: 'cash',
        label: this.translate.instant('tr_treasury_cash'),
        kind: 'cash',
        channel: '',
        accountNumber: '',
        phone: '',
        enabled: true,
      }),
    ];
    this.clampPage();
  }

  private clampPage(): void {
    const max = this.totalPages;
    if (this.page > max) this.page = max;
    if (this.page < 1) this.page = 1;
  }

  private resolveBranchAndLoadList(): void {
    const uid = this.globals.currentUser?._id;
    if (!uid) {
      this.listLoading = false;
      return;
    }

    if (canPickBranchRole(this.globals.currentUser?.role)) {
      this.subscriptions.push(
        this.branchesService.getBranchs({ page: 1, limit: 1000 }).subscribe({
          next: (res: any) => {
            this.branches = res?.branches || [];
            this.selectedBranchIds = [];
            this.loadList();
          },
          error: () => {
            this.lockedBranchId = String(this.globals.currentUser?.branch || '');
            this.loadList();
          },
        })
      );
    } else {
      this.lockedBranchId = String(this.globals.currentUser?.branch || '');
      this.loadList();
    }
  }

  private applyAccountsFromApi(accounts: MoneyAccountBalance[]): void {
    this.accountBalances = accounts || [];
    this.treasuryRows = this.accountBalances.map((a) => this.toUiRowFromApi(a));
    this.clampPage();
  }

  private toUiRowFromApi(a: MoneyAccountBalance): AccountUiRow {
    const kind: AccountUiRow['kind'] =
      a.kind === 'cash' ? 'cash' : a.kind === 'settlement' ? 'settlement' : 'treasury';
    const row = this.toUiRow({
      key: a.key,
      label: a.label,
      kind,
      channel: a.channel === 'wallet' || a.channel === 'bank' ? a.channel : '',
      accountNumber: a.accountNumber || '',
      phone: a.phone || '',
      enabled: a.enabled !== false,
    });
    row.expectedBalance = Number.isFinite(Number(a.expectedBalance)) ? Number(a.expectedBalance) : 0;
    return row;
  }

  private loadList(opts?: { silent?: boolean }): void {
    const uid = this.globals.currentUser?._id;
    if (!uid) {
      this.listLoading = false;
      return;
    }
    if (!this.showBranchFilter && !this.lockedBranchId) {
      this.listLoading = false;
      return;
    }
    const branch = !this.showBranchFilter
      ? this.lockedBranchId
      : this.selectedBranchIds.length === 1
        ? this.selectedBranchIds[0]
        : undefined;
    if (!opts?.silent) this.listLoading = true;
    this.loadingBalances = true;
    this.subscriptions.push(
      this.treasury
        .listAccounts({ userId: uid, branch, includeSettlement: true })
        .subscribe({
          next: (res) => {
            this.applyAccountsFromApi(res.accounts || []);
            this.listLoading = false;
            this.loadingBalances = false;
          },
          error: () => {
            this.listLoading = false;
            this.loadingBalances = false;
            if (!this.treasuryRows.length) this.loadRowsFromSettings();
          },
        })
    );
  }

  private guessChannel(key: string): MoneyAccountChannel {
    const k = String(key || '').toLowerCase();
    if (
      k.includes('vodafone') ||
      k.includes('etisalat') ||
      k.includes('orange') ||
      k.includes('wallet') ||
      k.includes('_cash') ||
      (k.endsWith('cash') && k !== 'cash')
    ) {
      return 'wallet';
    }
    return 'bank';
  }

  private toUiRow(a: MoneyAccount): AccountUiRow {
    const key = String(a.key || '').toLowerCase();
    let channel: MoneyAccountChannel | '' =
      a.channel === 'bank' || a.channel === 'wallet' ? a.channel : '';
    if (key !== 'cash' && !channel) {
      channel = this.guessChannel(key);
    }
    if (key === 'cash') channel = '';
    return {
      key,
      label: a.label || '',
      kind: a.kind === 'settlement' ? 'settlement' : a.kind === 'cash' || key === 'cash' ? 'cash' : 'treasury',
      channel,
      accountNumber: a.accountNumber || '',
      phone: a.phone || '',
      enabled: key === 'cash' ? true : a.enabled !== false,
      expectedBalance: null,
    };
  }
}
