import { Component, OnDestroy, OnInit, Optional } from '@angular/core';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { PaginationData } from '@core/models/users-interfaces.model';
import { TranslateService } from '@ngx-translate/core';
import { ConfirmationDialogComponent } from '@shared/components/confirmation-dialog/confirmation-dialog.component';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { TreasurySettleDialogComponent } from '../../../treasury/treasury-settle-dialog/treasury-settle-dialog.component';
import {
  MoneyAccount,
  PaymentMethodEffectMode,
  PaymentMethodShowIn,
  StoreSettingsService,
} from '@shared/services/store-settings.service';
import { MoneyAccountsService } from '@shared/services/money-accounts.service';
import { PaymentMethodsService, PaymentMethodRecord } from '@shared/services/payment-methods.service';
import { forkJoin, Subscription } from 'rxjs';
import {
  PaymentMethodFormDialogComponent,
  PaymentMethodFormResult,
} from '../payment-method-form-dialog/payment-method-form-dialog.component';

interface CatalogUiRow {
  key: string;
  label: string;
  showIn: PaymentMethodShowIn;
  effectMode: PaymentMethodEffectMode;
  feePercent: number;
  lockedKey: boolean;
  accountKey: string;
  settlementBankAccountKey: string;
  linkedAccountLabel?: string;
  linkedAccountKind?: string;
  linkedAccountChannel?: string;
}

@Component({
  selector: 'app-payment-app-fees-dialog',
  templateUrl: './payment-app-fees-dialog.component.html',
  styleUrls: ['./payment-app-fees-dialog.component.scss'],
})
export class PaymentAppFeesDialogComponent implements OnInit, OnDestroy {
  rows: CatalogUiRow[] = [];
  accounts: MoneyAccount[] = [];
  saving = false;
  isFilterOpen = true;
  searchQuery = '';
  showInFilter: '' | PaymentMethodShowIn = '';
  effectFilter: '' | PaymentMethodEffectMode = '';
  page = 1;
  readonly paginationPerPage = 10;

  private subscriptions: Subscription[] = [];

  constructor(
    @Optional() private dialogRef: MatDialogRef<PaymentAppFeesDialogComponent>,
    private dialog: MatDialog,
    private storeSettingsService: StoreSettingsService,
    private paymentMethodsApi: PaymentMethodsService,
    private moneyAccounts: MoneyAccountsService,
    private notify: AppNotificationService,
    private translate: TranslateService
  ) {}

  get isDialog(): boolean {
    return !!this.dialogRef;
  }

  get filteredRows(): CatalogUiRow[] {
    const q = this.searchQuery.trim().toLowerCase();
    return this.rows.filter((row) => {
      if (this.showInFilter) {
        if (this.showInFilter === 'both') {
          if (row.showIn !== 'both') return false;
        } else if (row.showIn !== this.showInFilter && row.showIn !== 'both') {
          return false;
        }
      }
      if (this.effectFilter && row.effectMode !== this.effectFilter) return false;
      if (!q) return true;
      return (
        row.label.toLowerCase().includes(q) ||
        row.key.toLowerCase().includes(q) ||
        this.linkedAccountLabel(row).toLowerCase().includes(q) ||
        this.settlementBankLabel(row).toLowerCase().includes(q)
      );
    });
  }

  get pagedRows(): CatalogUiRow[] {
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
    this.reloadFromApis();
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach((s) => s.unsubscribe());
  }

  onFiltersChanged(): void {
    this.page = 1;
  }

  paginationUpdate(page: number): void {
    this.page = page;
  }

  methodIcon(row: CatalogUiRow): string {
    if (row.key === 'cash') return 'fa-money';
    if (row.effectMode === 'settlement') return 'fa-credit-card';
    if (row.effectMode === 'none') return 'fa-clock-o';
    const channel = row.linkedAccountChannel || this.accounts.find((a) => a.key === row.accountKey)?.channel;
    if (channel === 'wallet') return 'fa-mobile';
    return 'fa-university';
  }

  methodIconChannel(row: CatalogUiRow): string {
    if (row.key === 'cash') return 'cash';
    if (row.effectMode === 'settlement') return 'settlement';
    if (row.effectMode === 'none') return 'none';
    const channel = row.linkedAccountChannel || this.accounts.find((a) => a.key === row.accountKey)?.channel;
    if (channel === 'wallet') return 'wallet';
    return 'bank';
  }

  effectLabelKey(row: CatalogUiRow): string {
    if (row.effectMode === 'settlement') return 'tr_pay_effect_settlement';
    if (row.effectMode === 'none') return 'tr_pay_effect_none';
    return 'tr_pay_effect_instant';
  }

  showInLabelKey(row: CatalogUiRow): string {
    if (row.showIn === 'purchase') return 'tr_pay_show_in_purchase';
    if (row.showIn === 'both') return 'tr_pay_show_in_both';
    return 'tr_pay_show_in_sale';
  }

  linkedAccountLabel(row: CatalogUiRow): string {
    if (row.effectMode === 'none' || !row.accountKey) return '—';
    if (row.linkedAccountLabel) return row.linkedAccountLabel;
    const acc = this.accounts.find((a) => a.key === row.accountKey);
    if (acc?.label) return acc.label;
    if (row.effectMode === 'settlement') return row.label || row.accountKey;
    return row.accountKey;
  }

  linkedAccountSubLabel(row: CatalogUiRow): string {
    if (row.effectMode === 'none' || !row.accountKey) return '';
    if (row.effectMode === 'settlement') {
      return this.translate.instant('tr_treasury_type_settlement');
    }
    const kind = row.linkedAccountKind || this.accounts.find((a) => a.key === row.accountKey)?.kind;
    const channel =
      row.linkedAccountChannel || this.accounts.find((a) => a.key === row.accountKey)?.channel;
    if (kind === 'cash') return this.translate.instant('tr_treasury_type_cash');
    if (kind === 'settlement') return this.translate.instant('tr_treasury_type_settlement');
    if (channel === 'wallet') return this.translate.instant('tr_money_account_channel_wallet');
    return this.translate.instant('tr_money_account_channel_bank');
  }

  settlementBankLabel(row: CatalogUiRow): string {
    if (row.effectMode !== 'settlement' || !row.settlementBankAccountKey) return '';
    const acc = this.accounts.find((a) => a.key === row.settlementBankAccountKey);
    return acc?.label || row.settlementBankAccountKey;
  }

  hasLinkedAccount(row: CatalogUiRow): boolean {
    if (row.effectMode === 'none') return false;
    return !!row.accountKey || (row.effectMode === 'settlement' && !!this.settlementBankLabel(row));
  }

  /** Instant methods with no treasury home — money accepted but not posted to accounts. */
  needsAccountLinkWarning(row: CatalogUiRow): boolean {
    return row.effectMode === 'instant' && !row.accountKey && row.key !== 'cash';
  }

  openAdd(): void {
    this.openForm({
      mode: 'add',
      showIn: 'sale',
      effectMode: 'instant',
      feePercent: 0,
      accountKey: '',
      settlementBankAccountKey: '',
      lockedKey: false,
    });
  }

  openSettle(row: CatalogUiRow): void {
    if (row.effectMode !== 'settlement' || this.saving) return;
    if (!row.settlementBankAccountKey) {
      this.notify.push(this.translate.instant('tr_payment_settle_need_bank'), 'error');
      return;
    }
    const ref = this.dialog.open(TreasurySettleDialogComponent, {
      width: '420px',
      panelClass: 'treasury-transfer-dialog-panel',
      data: {
        methodKey: row.key,
        label: row.label,
        settlementBankAccountKey: row.settlementBankAccountKey,
        settlementBankLabel: this.settlementBankLabel(row),
      },
    });
    this.subscriptions.push(ref.afterClosed().subscribe());
  }

  openEdit(row: CatalogUiRow): void {
    this.openForm({
      mode: 'edit',
      key: row.key,
      label: row.label,
      showIn: row.showIn,
      effectMode: row.effectMode,
      feePercent: row.feePercent,
      accountKey: row.accountKey,
      settlementBankAccountKey: row.settlementBankAccountKey,
      lockedKey: row.lockedKey,
    });
  }

  removeRow(row: CatalogUiRow): void {
    if (row.key === 'cash' || row.key === 'credit' || this.saving) return;
    const name = String(row.label || row.key).trim();
    const ref = this.dialog.open(ConfirmationDialogComponent, {
      width: '420px',
      disableClose: true,
      data: {
        title: this.translate.instant('tr_payment_method_delete_title'),
        message: this.translate.instant('tr_payment_method_delete_confirm', { name }),
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
        this.saving = true;
        this.subscriptions.push(
          this.paymentMethodsApi.delete(row.key).subscribe({
            next: () => this.afterMethodMutation(),
            error: () => this.onMethodMutationError(),
          })
        );
      })
    );
  }

  cancel(): void {
    this.dialogRef?.close(false);
  }

  private openForm(data: {
    mode: 'add' | 'edit';
    key?: string;
    label?: string;
    showIn?: PaymentMethodShowIn;
    effectMode?: PaymentMethodEffectMode;
    feePercent?: number;
    accountKey?: string;
    settlementBankAccountKey?: string;
    lockedKey?: boolean;
  }): void {
    const ref = this.dialog.open(PaymentMethodFormDialogComponent, {
      width: '480px',
      panelClass: 'payment-method-form-dialog-panel',
      backdropClass: 'payment-method-form-dialog-backdrop',
      data: { ...data, accounts: this.accounts },
    });
    this.subscriptions.push(
      ref.afterClosed().subscribe((result: PaymentMethodFormResult | false | undefined) => {
        if (!result) return;
        if (data.mode === 'add') this.applyAdd(result);
        else this.applyEdit(result);
      })
    );
  }

  private applyAdd(result: PaymentMethodFormResult): void {
    this.saving = true;
    this.subscriptions.push(
      this.paymentMethodsApi
        .create({
          label: result.label,
          showIn: result.showIn,
          effectMode: result.effectMode,
          feePercent: result.feePercent,
          accountKey: result.accountKey,
          settlementBankAccountKey: result.settlementBankAccountKey,
        })
        .subscribe({
          next: () => this.afterMethodMutation(),
          error: () => this.onMethodMutationError(),
        })
    );
  }

  private applyEdit(result: PaymentMethodFormResult): void {
    if (!result.key) return;
    this.saving = true;
    this.subscriptions.push(
      this.paymentMethodsApi
        .update(result.key, {
          label: result.label,
          showIn: result.showIn,
          effectMode: result.effectMode,
          feePercent: result.feePercent,
          accountKey: result.accountKey,
          settlementBankAccountKey: result.settlementBankAccountKey,
        })
        .subscribe({
          next: () => this.afterMethodMutation(),
          error: () => this.onMethodMutationError(),
        })
    );
  }

  private reloadFromApis(): void {
    this.subscriptions.push(
      forkJoin({
        methods: this.paymentMethodsApi.list(),
        accounts: this.moneyAccounts.list({ includeSettlement: true }),
      }).subscribe({
        next: ({ methods, accounts }) => {
          this.accounts = accounts.accounts?.length
            ? accounts.accounts
            : [{ key: 'cash', label: this.translate.instant('tr_pay_cash'), kind: 'cash' }];
          this.rows = (methods.paymentMethods || []).map((r) => this.toUiRow(r));
        },
        error: () => {
          this.notify.push(this.translate.instant('tr_unexpected_error_message'), 'error');
        },
      })
    );
  }

  private toUiRow(r: PaymentMethodRecord): CatalogUiRow {
    const key = String(r.key || '').toLowerCase();
    const effectMode = r.effectMode || 'instant';
    const accountKey =
      key === 'cash' ? 'cash' : effectMode === 'settlement' ? key : r.accountKey || '';
    return {
      key,
      label: r.label,
      showIn: r.showIn || 'sale',
      effectMode,
      feePercent: key === 'cash' || key === 'credit' ? 0 : Number(r.feePercent) || 0,
      lockedKey: true,
      accountKey,
      settlementBankAccountKey: r.settlementBankAccountKey || '',
      linkedAccountLabel: r.linkedAccount?.label || '',
      linkedAccountKind: r.linkedAccount?.kind || '',
      linkedAccountChannel: r.linkedAccount?.channel || '',
    };
  }

  private afterMethodMutation(): void {
    this.saving = false;
    this.notify.push(this.translate.instant('tr_settings_saved'), 'success');
    this.storeSettingsService.load();
    this.reloadFromApis();
  }

  private onMethodMutationError(): void {
    this.saving = false;
    this.notify.push(this.translate.instant('tr_unexpected_error_message'), 'error');
    this.reloadFromApis();
  }
}
