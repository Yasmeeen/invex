import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { MoneyAccountChannel } from '@shared/services/store-settings.service';

export interface MoneyAccountFormData {
  mode: 'add' | 'edit';
  key?: string;
  label?: string;
  channel?: MoneyAccountChannel | '';
  accountNumber?: string;
  phone?: string;
  enabled?: boolean;
}

export interface MoneyAccountFormResult {
  key: string;
  label: string;
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
  /** Always `bank` or `wallet` for non-cash rows. */
  channel: 'bank' | 'wallet' = 'bank';
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
      this.channel = 'bank';
      this.accountNumber = '';
      this.phone = '';
      this.enabled = true;
    } else {
      this.channel = data.channel === 'wallet' ? 'wallet' : 'bank';
      this.accountNumber = String(data.accountNumber || '').trim();
      this.phone = String(data.phone || '').trim();
    }
  }

  get isCash(): boolean {
    return String(this.data.key || '').toLowerCase() === 'cash';
  }

  get titleKey(): string {
    if (this.isCash) return 'tr_money_account_edit_cash_title';
    return this.data.mode === 'add' ? 'tr_money_accounts_add' : 'tr_money_account_edit_title';
  }

  onChannelChange(next: string): void {
    this.channel = next === 'wallet' ? 'wallet' : 'bank';
    if (this.channel === 'bank') {
      this.phone = '';
    } else {
      this.accountNumber = '';
    }
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
        channel: '',
        accountNumber: '',
        phone: '',
        enabled: true,
      });
      return;
    }
    const channel: 'bank' | 'wallet' = this.channel === 'wallet' ? 'wallet' : 'bank';
    this.dialogRef.close({
      key: String(this.data.key || '').trim().toLowerCase(),
      label,
      channel,
      accountNumber: channel === 'bank' ? String(this.accountNumber || '').trim().slice(0, 80) : '',
      phone: channel === 'wallet' ? String(this.phone || '').trim().slice(0, 40) : '',
      enabled: this.enabled !== false,
    });
  }
}
