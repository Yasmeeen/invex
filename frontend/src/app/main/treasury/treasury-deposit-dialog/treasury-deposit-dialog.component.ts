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

export interface TreasuryDepositBranchOption {
  _id: string;
  name?: string;
}

export interface TreasuryDepositDialogData {
  branchId?: string;
  branches?: TreasuryDepositBranchOption[];
  accounts?: MoneyAccountBalance[];
  preferAccount?: string;
}

interface DepositAccountOption {
  key: string;
  label: string;
  kind: string;
  expectedBalance: number | null;
}

@Component({
  selector: 'app-treasury-deposit-dialog',
  templateUrl: './treasury-deposit-dialog.component.html',
  styleUrls: ['./treasury-deposit-dialog.component.scss'],
})
export class TreasuryDepositDialogComponent implements OnInit {
  accountKey = '';
  amount: number | null = null;
  note = '';
  saving = false;
  loadingBalances = false;
  selectedBranchId = '';
  branches: TreasuryDepositBranchOption[] = [];
  accountOptions: DepositAccountOption[] = [];
  private balancesByKey = new Map<string, number>();

  constructor(
    private dialogRef: MatDialogRef<TreasuryDepositDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: TreasuryDepositDialogData,
    private treasury: TreasuryAccountsService,
    private storeSettings: StoreSettingsService,
    private notify: AppNotificationService,
    private translate: TranslateService,
    private globals: Globals
  ) {}

  ngOnInit(): void {
    this.branches = this.data.branches || [];
    this.selectedBranchId = String(this.data.branchId || '');
    if (!this.selectedBranchId && this.branches.length === 1) {
      this.selectedBranchId = String(this.branches[0]._id || '');
    }
    this.seedAccountOptions();
    if (this.selectedBranchId && this.data.accounts?.length) {
      this.indexBalances(this.data.accounts);
    }
    if (this.data.preferAccount) {
      this.accountKey = String(this.data.preferAccount).toLowerCase();
    }
    this.loadBalances();
  }

  get showBranchPicker(): boolean {
    return this.branches.length > 1;
  }

  get availableBalance(): number | null {
    const key = String(this.accountKey || '').toLowerCase();
    if (!key) return null;
    if (this.balancesByKey.has(key)) return this.balancesByKey.get(key) as number;
    const opt = this.accountOptions.find((a) => String(a.key).toLowerCase() === key);
    return opt && opt.expectedBalance != null ? Number(opt.expectedBalance) : null;
  }

  get cannotSubmit(): boolean {
    const amt = Number(this.amount);
    return (
      !this.selectedBranchId ||
      !this.accountKey ||
      this.saving ||
      this.loadingBalances ||
      !Number.isFinite(amt) ||
      amt <= 0
    );
  }

  onBranchChange(): void {
    this.balancesByKey.clear();
    this.loadBalances();
  }

  submit(): void {
    const uid = this.globals.currentUser?._id;
    const amt = Number(this.amount);
    if (!uid) return;
    if (!this.selectedBranchId) {
      this.notify.push(this.translate.instant('tr_treasury_pick_one_branch'), 'error');
      return;
    }
    if (!this.accountKey) {
      this.notify.push(this.translate.instant('tr_treasury_deposit_account_invalid'), 'error');
      return;
    }
    if (!Number.isFinite(amt) || amt <= 0) {
      this.notify.push(this.translate.instant('tr_treasury_amount_invalid'), 'error');
      return;
    }
    this.saving = true;
    this.treasury
      .createDeposit({
        userId: uid,
        branch: this.selectedBranchId,
        accountKey: this.accountKey,
        amount: amt,
        note: this.note,
      })
      .subscribe({
        next: () => {
          this.saving = false;
          this.notify.push(this.translate.instant('tr_treasury_deposit_success'), 'success');
          this.dialogRef.close(true);
        },
        error: (err) => {
          this.saving = false;
          this.notify.push(
            err?.error?.error || this.translate.instant('tr_unexpected_error_message'),
            'error'
          );
        },
      });
  }

  cancel(): void {
    this.dialogRef.close(false);
  }

  private seedAccountOptions(): void {
    const fromList = (this.data.accounts || []).filter((a) => a.kind !== 'settlement');
    const money = (this.storeSettings.snapshot.moneyAccounts || []).filter(
      (a) => a.kind !== 'settlement'
    );
    if (fromList.length) {
      this.accountOptions = fromList.map((a) => this.toOption(a));
    } else if (money.length) {
      this.accountOptions = money.map((a) => this.toOption(a));
    } else {
      this.accountOptions = [];
    }
  }

  private toOption(a: {
    key?: string;
    label?: string;
    kind?: string;
    expectedBalance?: number;
  }): DepositAccountOption {
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

  private indexBalances(accounts?: Array<{ key?: string; kind?: string; expectedBalance?: number }>): void {
    for (const a of accounts || []) {
      if (a?.kind === 'settlement') continue;
      const key = String(a?.key || '').toLowerCase();
      if (!key || !Number.isFinite(Number(a.expectedBalance))) continue;
      this.balancesByKey.set(key, Number(a.expectedBalance) || 0);
    }
  }

  private loadBalances(): void {
    const uid = this.globals.currentUser?._id;
    if (!uid || !this.selectedBranchId) return;
    this.loadingBalances = true;
    this.treasury
      .listAccounts({ userId: uid, branch: this.selectedBranchId, includeSettlement: false })
      .subscribe({
        next: (res) => {
          const accounts = (res.accounts || []).filter((a) => a.kind !== 'settlement');
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
}
