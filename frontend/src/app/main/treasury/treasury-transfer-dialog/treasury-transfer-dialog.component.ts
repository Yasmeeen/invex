import { Component, Inject, OnDestroy, OnInit } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Globals } from '@core/globals';
import { canPickBranchRole } from '@core/utils/role-utils';
import { TranslateService } from '@ngx-translate/core';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { BranchesServce } from '@shared/services/branches.service';
import { StoreSettingsService } from '@shared/services/store-settings.service';
import {
  MoneyAccountBalance,
  TreasuryAccountsService,
} from '@shared/services/treasury-accounts.service';
import { Subscription } from 'rxjs';

export interface TreasuryTransferBranchOption {
  _id: string;
  name?: string;
}

export interface TreasuryTransferDialogData {
  branchId?: string;
  branches?: TreasuryTransferBranchOption[];
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
export class TreasuryTransferDialogComponent implements OnInit, OnDestroy {
  fromAccountKey = '';
  toAccountKey = '';
  amount: number | null = null;
  note = '';
  saving = false;
  loadingBalances = false;
  selectedBranchId = '';
  branches: TreasuryTransferBranchOption[] = [];
  accountOptions: TransferAccountOption[] = [];
  private balancesByKey = new Map<string, number>();
  private subscriptions: Subscription[] = [];

  constructor(
    private dialogRef: MatDialogRef<TreasuryTransferDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: TreasuryTransferDialogData,
    private treasury: TreasuryAccountsService,
    private storeSettings: StoreSettingsService,
    private branchesService: BranchesServce,
    private notify: AppNotificationService,
    private translate: TranslateService,
    private globals: Globals
  ) {}

  ngOnInit(): void {
    this.storeSettings.load();
    this.branches = this.data.branches || [];
    this.selectedBranchId = String(this.data.branchId || '');
    this.seedAccountOptions();
    if (this.data.preferFrom) {
      this.fromAccountKey = this.data.preferFrom;
    }
    this.applySettlementDefault();

    if (this.canPickBranch && this.branches.length < 2) {
      this.subscriptions.push(
        this.branchesService.getBranchs({ page: 1, limit: 1000 }).subscribe({
          next: (res: any) => {
            this.branches = res?.branches || this.branches;
            this.loadFromBalance();
          },
          error: () => this.loadFromBalance(),
        })
      );
    } else {
      this.loadFromBalance();
    }
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach((s) => s.unsubscribe());
  }

  get canPickBranch(): boolean {
    return canPickBranchRole(this.globals.currentUser?.role);
  }

  get involvesCash(): boolean {
    return this.isCashKey(this.fromAccountKey) || this.isCashKey(this.toAccountKey);
  }

  get showBranchPicker(): boolean {
    return this.involvesCash && this.canPickBranch && this.branches.length > 0;
  }

  get titleKey(): string {
    return this.data.isSettlement ? 'tr_treasury_settlement' : 'tr_treasury_transfer';
  }

  get availableFromBalance(): number | null {
    const key = String(this.fromAccountKey || '').toLowerCase();
    if (!key || !this.balancesByKey.has(key)) return null;
    return this.balancesByKey.get(key) as number;
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
    if (!this.fromAccountKey || !this.toAccountKey || this.fromAccountKey === this.toAccountKey) {
      return true;
    }
    if (this.involvesCash && this.canPickBranch && !this.selectedBranchId) return true;
    return this.fromHasNoBalance || this.amountExceedsBalance;
  }

  get availableFromBalanceLabel(): string {
    return this.formatMoney(this.availableFromBalance);
  }

  onAccountsChanged(): void {
    if (!this.involvesCash) {
      this.selectedBranchId = '';
    } else if (!this.selectedBranchId && this.branches.length === 1) {
      this.selectedBranchId = String(this.branches[0]._id || '');
    }
    this.loadFromBalance();
  }

  onBranchChange(): void {
    this.loadFromBalance();
  }

  submit(): void {
    const uid = this.globals.currentUser?._id;
    const amt = Number(this.amount);
    if (!uid) return;
    if (this.involvesCash && this.canPickBranch && !this.selectedBranchId) {
      this.notify.push(this.translate.instant('tr_treasury_cash_branch_required'), 'error');
      return;
    }
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
    const body: {
      userId: string;
      branch?: string;
      fromAccountKey: string;
      toAccountKey: string;
      amount: number;
      note?: string;
      isSettlement?: boolean;
    } = {
      userId: uid,
      fromAccountKey: this.fromAccountKey,
      toAccountKey: this.toAccountKey,
      amount: amt,
      note: this.note,
      isSettlement: !!this.data.isSettlement,
    };
    if (this.involvesCash && this.selectedBranchId) {
      body.branch = this.selectedBranchId;
    }
    this.subscriptions.push(
      this.treasury.createTransfer(body).subscribe({
        next: () => {
          this.saving = false;
          this.notify.push(this.translate.instant('tr_treasury_transfer_success'), 'success');
          this.dialogRef.close(true);
        },
        error: (err) => this.onTransferError(err),
      })
    );
  }

  cancel(): void {
    this.dialogRef.close(false);
  }

  private isCashKey(key: string): boolean {
    const k = String(key || '')
      .trim()
      .toLowerCase();
    if (k === 'cash') return true;
    const opt = this.accountOptions.find((a) => a.key === k);
    return opt?.kind === 'cash';
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
      kind: String(a?.kind || (key === 'cash' ? 'cash' : 'treasury')),
      expectedBalance: expected,
    };
  }

  private seedAccountOptions(): void {
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
  }

  private applySettlementDefault(): void {
    if (!this.data.isSettlement || this.toAccountKey) return;
    const map = this.storeSettings.snapshot.paymentMethodAccountMap || [];
    const row = map.find(
      (r) =>
        r.accountKey === this.fromAccountKey &&
        r.mode === 'settlement' &&
        r.settlementBankAccountKey
    );
    if (row?.settlementBankAccountKey) {
      this.toAccountKey = row.settlementBankAccountKey;
      return;
    }
    const bank = this.accountOptions.find((a) => a.kind === 'treasury' && a.key !== 'cash');
    if (bank) this.toAccountKey = bank.key;
  }

  private loadFromBalance(): void {
    const uid = this.globals.currentUser?._id;
    const from = String(this.fromAccountKey || '').toLowerCase();
    if (!uid || !from) {
      this.balancesByKey.clear();
      return;
    }
    if (this.isCashKey(from) && this.canPickBranch && !this.selectedBranchId) {
      this.balancesByKey.delete(from);
      return;
    }
    this.loadingBalances = true;
    const params: { key: string; userId: string; branch?: string } = { key: from, userId: uid };
    if (this.isCashKey(from) && this.selectedBranchId) {
      params.branch = this.selectedBranchId;
    }
    this.subscriptions.push(
      this.treasury.getAccount(params).subscribe({
        next: (res) => {
          this.balancesByKey.set(from, Number(res?.expectedBalance) || 0);
          this.loadingBalances = false;
        },
        error: () => {
          this.loadingBalances = false;
        },
      })
    );
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
          amount: this.formatMoney(
            Number.isFinite(available) ? available : this.availableFromBalance
          ),
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
