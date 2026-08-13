import { Component, Inject, OnInit } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Globals } from '@core/globals';
import { TranslateService } from '@ngx-translate/core';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { StoreSettingsService } from '@shared/services/store-settings.service';
import {
  MoneyAccountBalance,
  TreasuryAccountsService,
} from '@shared/services/treasury-accounts.service';

export interface TreasuryTransferDialogData {
  branchId: string;
  accounts?: MoneyAccountBalance[];
  isSettlement?: boolean;
  preferFrom?: string;
}

interface TransferAccountOption {
  key: string;
  label: string;
  kind: string;
  expectedBalance: number | null;
}

@Component({
  selector: 'app-treasury-transfer-dialog',
  templateUrl: './treasury-transfer-dialog.component.html',
  styleUrls: ['./treasury-transfer-dialog.component.scss'],
})
export class TreasuryTransferDialogComponent implements OnInit {
  fromAccountKey = '';
  toAccountKey = '';
  amount: number | null = null;
  note = '';
  saving = false;
  loadingBalances = false;
  accountOptions: TransferAccountOption[] = [];
  private balancesByKey = new Map<string, number>();

  constructor(
    private dialogRef: MatDialogRef<TreasuryTransferDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: TreasuryTransferDialogData,
    private treasury: TreasuryAccountsService,
    private storeSettings: StoreSettingsService,
    private notify: AppNotificationService,
    private translate: TranslateService,
    private globals: Globals
  ) {}

  ngOnInit(): void {
    const fromList = this.data.accounts || [];
    const money = this.storeSettings.snapshot.moneyAccounts || [];
    if (fromList.length > 1) {
      this.accountOptions = fromList.map((a) => this.toOption(a));
    } else if (money.length) {
      this.accountOptions = money.map((a) => this.toOption(a));
    } else if (fromList.length) {
      this.accountOptions = fromList.map((a) => this.toOption(a));
    } else {
      this.accountOptions = (this.storeSettings.snapshot.purchaseTreasuryMethods || []).map((t) =>
        this.toOption({
          key: t.key,
          label: t.label,
          kind: t.key === 'cash' ? 'cash' : 'treasury',
        })
      );
    }
    this.indexBalances(fromList);
    this.loadBalances();

    if (this.data.preferFrom) {
      this.fromAccountKey = this.data.preferFrom;
    }

    if (this.data.isSettlement && !this.toAccountKey) {
      const map = this.storeSettings.snapshot.paymentMethodAccountMap || [];
      const row = map.find(
        (r) =>
          r.accountKey === this.fromAccountKey &&
          r.mode === 'settlement' &&
          r.settlementBankAccountKey
      );
      if (row?.settlementBankAccountKey) {
        this.toAccountKey = row.settlementBankAccountKey;
      } else {
        const bank = this.accountOptions.find((a) => a.kind === 'treasury' && a.key !== 'cash');
        if (bank) this.toAccountKey = bank.key;
      }
    }
  }

  get titleKey(): string {
    return this.data.isSettlement ? 'tr_treasury_settlement' : 'tr_treasury_transfer';
  }

  get availableFromBalance(): number | null {
    const key = String(this.fromAccountKey || '').toLowerCase();
    if (!key) return null;
    if (this.balancesByKey.has(key)) return this.balancesByKey.get(key) as number;
    const opt = this.accountOptions.find((a) => String(a.key).toLowerCase() === key);
    return opt && opt.expectedBalance != null ? Number(opt.expectedBalance) : null;
  }

  get fromHasNoBalance(): boolean {
    const bal = this.availableFromBalance;
    return bal != null && Math.round(bal * 100) <= 0;
  }

  get amountExceedsBalance(): boolean {
    const bal = this.availableFromBalance;
    const amt = Number(this.amount);
    if (bal == null || !Number.isFinite(amt) || amt <= 0) return false;
    return Math.round(amt * 100) > Math.round(bal * 100);
  }

  get cannotTransfer(): boolean {
    return this.fromHasNoBalance || this.amountExceedsBalance;
  }

  get availableFromBalanceLabel(): string {
    return this.formatMoney(this.availableFromBalance);
  }

  submit(): void {
    const uid = this.globals.currentUser?._id;
    const amt = Number(this.amount);
    if (!uid || !this.data.branchId) return;
    if (!Number.isFinite(amt) || amt <= 0) {
      this.notify.push(this.translate.instant('tr_treasury_amount_invalid'), 'error');
      return;
    }
    if (!this.assertSufficientFunds(amt)) return;

    if (!this.fromAccountKey || !this.toAccountKey || this.fromAccountKey === this.toAccountKey) {
      this.notify.push(this.translate.instant('tr_treasury_transfer_accounts_invalid'), 'error');
      return;
    }
    this.saving = true;
    this.treasury
      .createTransfer({
        userId: uid,
        branch: this.data.branchId,
        fromAccountKey: this.fromAccountKey,
        toAccountKey: this.toAccountKey,
        amount: amt,
        note: this.note,
        isSettlement: !!this.data.isSettlement,
      })
      .subscribe({
        next: () => {
          this.saving = false;
          this.notify.push(this.translate.instant('tr_treasury_transfer_success'), 'success');
          this.dialogRef.close(true);
        },
        error: (err) => this.onTransferError(err),
      });
  }

  cancel(): void {
    this.dialogRef.close(false);
  }

  private toOption(a: {
    key?: string;
    label?: string;
    kind?: string;
    expectedBalance?: number;
  }): TransferAccountOption {
    const key = String(a?.key || '').toLowerCase();
    const expected =
      a && Number.isFinite(Number(a.expectedBalance)) ? Number(a.expectedBalance) : null;
    return {
      key,
      label: String(a?.label || key),
      kind: String(a?.kind || 'treasury'),
      expectedBalance: expected,
    };
  }

  private indexBalances(accounts?: Array<{ key?: string; expectedBalance?: number }>): void {
    for (const a of accounts || []) {
      const key = String(a?.key || '').toLowerCase();
      if (!key || !Number.isFinite(Number(a.expectedBalance))) continue;
      this.balancesByKey.set(key, Number(a.expectedBalance) || 0);
    }
  }

  private loadBalances(): void {
    const uid = this.globals.currentUser?._id;
    if (!uid || !this.data.branchId) return;
    this.loadingBalances = true;
    this.treasury
      .listAccounts({ userId: uid, branch: this.data.branchId, includeSettlement: true })
      .subscribe({
        next: (res) => {
          const accounts = res.accounts || [];
          this.indexBalances(accounts);
          if (accounts.length) {
            this.accountOptions = accounts.map((a) => this.toOption(a));
          }
          this.loadingBalances = false;
        },
        error: () => {
          this.loadingBalances = false;
        },
      });
  }

  private assertSufficientFunds(amt: number): boolean {
    const bal = this.availableFromBalance;
    if (bal == null) return true;
    if (Math.round(bal * 100) <= 0) {
      this.notify.push(this.translate.instant('tr_treasury_transfer_no_balance'), 'error');
      return false;
    }
    if (Math.round(amt * 100) > Math.round(bal * 100)) {
      this.notify.push(
        this.translate.instant('tr_treasury_transfer_insufficient', {
          amount: this.formatMoney(bal),
        }),
        'error'
      );
      return false;
    }
    return true;
  }

  private onTransferError(err: any): void {
    this.saving = false;
    const code = String(err?.error?.error || '');
    if (code === 'INSUFFICIENT_FUNDS') {
      this.notify.push(this.translate.instant('tr_treasury_transfer_no_balance'), 'error');
      return;
    }
    if (code === 'AMOUNT_EXCEEDS_BALANCE') {
      const available = Number(err?.error?.available);
      this.notify.push(
        this.translate.instant('tr_treasury_transfer_insufficient', {
          amount: this.formatMoney(Number.isFinite(available) ? available : this.availableFromBalance),
        }),
        'error'
      );
      return;
    }
    this.notify.push(code || this.translate.instant('tr_unexpected_error_message'), 'error');
  }

  private formatMoney(value: number | null | undefined): string {
    const n = Number(value);
    if (!Number.isFinite(n)) return '0.00';
    return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
}
