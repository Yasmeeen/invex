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
  accountOptions: { key: string; label: string; kind: string }[] = [];

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
      this.accountOptions = fromList.map((a) => ({
        key: a.key,
        label: a.label,
        kind: a.kind,
      }));
    } else if (money.length) {
      this.accountOptions = money.map((a) => ({
        key: a.key,
        label: a.label,
        kind: a.kind,
      }));
    } else if (fromList.length) {
      this.accountOptions = fromList.map((a) => ({
        key: a.key,
        label: a.label,
        kind: a.kind,
      }));
    } else {
      this.accountOptions = (this.storeSettings.snapshot.purchaseTreasuryMethods || []).map(
        (t) => ({ key: t.key, label: t.label, kind: t.key === 'cash' ? 'cash' : 'treasury' })
      );
    }

    if (this.data.preferFrom) {
      this.fromAccountKey = this.data.preferFrom;
    }
    if (this.data.isSettlement && !this.toAccountKey) {
      const bank = this.accountOptions.find((a) => a.kind === 'treasury' && a.key !== 'cash');
      if (bank) this.toAccountKey = bank.key;
    }
  }

  get titleKey(): string {
    return this.data.isSettlement ? 'tr_treasury_settlement' : 'tr_treasury_transfer';
  }

  submit(): void {
    const uid = this.globals.currentUser?._id;
    const amt = Number(this.amount);
    if (!uid || !this.data.branchId) return;
    if (!this.fromAccountKey || !this.toAccountKey || this.fromAccountKey === this.toAccountKey) {
      this.notify.push(this.translate.instant('tr_treasury_transfer_accounts_invalid'), 'error');
      return;
    }
    if (!Number.isFinite(amt) || amt <= 0) {
      this.notify.push(this.translate.instant('tr_treasury_amount_invalid'), 'error');
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
}
