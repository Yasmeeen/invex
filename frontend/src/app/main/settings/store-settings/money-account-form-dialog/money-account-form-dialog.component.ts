import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { MoneyAccountChannel, MoneyAccountKind } from '@shared/services/store-settings.service';

export type MoneyAccountFormType = 'bank' | 'wallet' | 'settlement';

export interface MoneyAccountFormData {
  mode: 'add' | 'edit';
  key?: string;
  label?: string;
  kind?: MoneyAccountKind;
  channel?: MoneyAccountChannel | '';
  accountNumber?: string;
  phone?: string;
  enabled?: boolean;
}

export interface MoneyAccountFormResult {
  key: string;
  label: string;
  kind: 'treasury' | 'settlement';
  channel: MoneyAccountChannel | '';
  accountNumber: string;
  phone: string;
  enabled: boolean;
}

@Component({
  selector: 'app-money-account-form-dialog',
  templateUrl: './money-account-form-dialog.component.html',
  styleUrls: ['./money-account-form-dialog.component.scss'],
})
export class MoneyAccountFormDialogComponent {
  label = '';
  accountType: MoneyAccountFormType = 'bank';
  accountNumber = '';
  phone = '';
  enabled = true;

  constructor(
    private dialogRef: MatDialogRef<MoneyAccountFormDialogComponent, MoneyAccountFormResult | false>,
    @Inject(MAT_DIALOG_DATA) public data: MoneyAccountFormData,
    private translate: TranslateService
  ) {
    this.label = String(data.label || '').trim();
    this.enabled = data.enabled !== false;
    if (this.isCash) {
      this.accountType = 'bank';
      this.accountNumber = '';
      this.phone = '';
      this.enabled = true;
    } else if (data.kind === 'settlement') {
      this.accountType = 'settlement';
      this.accountNumber = '';
      this.phone = '';
    } else {
      this.accountType = data.channel === 'wallet' ? 'wallet' : 'bank';
      this.accountNumber = String(data.accountNumber || '').trim();
      this.phone = String(data.phone || '').trim();
    }
  }

  get isCash(): boolean {
    return String(this.data.key || '').toLowerCase() === 'cash';
  }

  get typeLocked(): boolean {
    return this.data.mode === 'edit';
  }

  get isSettlement(): boolean {
    return this.accountType === 'settlement';
  }

  get titleKey(): string {
    if (this.isCash) return 'tr_money_account_edit_cash_title';
    if (this.data.mode === 'add' && this.isSettlement) return 'tr_money_account_add_settlement';
    return this.data.mode === 'add' ? 'tr_money_accounts_add' : 'tr_money_account_edit_title';
  }

  onTypeChange(next: string): void {
    if (this.typeLocked) return;
    this.accountType = next === 'wallet' ? 'wallet' : next === 'settlement' ? 'settlement' : 'bank';
    if (this.accountType !== 'bank') this.accountNumber = '';
    if (this.accountType !== 'wallet') this.phone = '';
  }

  cancel(): void {
    this.dialogRef.close(false);
  }

  submit(): void {
    const label = String(this.label || '').trim().slice(0, 120);
    if (!label) {
      return;
    }
    if (this.isCash) {
      this.dialogRef.close({
        key: 'cash',
        label: label || this.translate.instant('tr_treasury_cash'),
        kind: 'treasury',
        channel: '',
        accountNumber: '',
        phone: '',
        enabled: true,
      });
      return;
    }
    if (this.accountType === 'settlement') {
      this.dialogRef.close({
        key: String(this.data.key || '').trim().toLowerCase(),
        label,
        kind: 'settlement',
        channel: '',
        accountNumber: '',
        phone: '',
        enabled: this.enabled !== false,
      });
      return;
    }
    const channel: 'bank' | 'wallet' = this.accountType === 'wallet' ? 'wallet' : 'bank';
    this.dialogRef.close({
      key: String(this.data.key || '').trim().toLowerCase(),
      label,
      kind: 'treasury',
      channel,
      accountNumber: channel === 'bank' ? String(this.accountNumber || '').trim().slice(0, 80) : '',
      phone: channel === 'wallet' ? String(this.phone || '').trim().slice(0, 40) : '',
      enabled: this.enabled !== false,
    });
  }
}
