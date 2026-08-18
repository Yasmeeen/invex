import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import {
  MoneyAccount,
  PaymentMethodEffectMode,
  PaymentMethodShowIn,
} from '@shared/services/store-settings.service';

export interface PaymentMethodFormData {
  mode: 'add' | 'edit';
  key?: string;
  label?: string;
  showIn?: PaymentMethodShowIn;
  effectMode?: PaymentMethodEffectMode;
  feePercent?: number;
  accountKey?: string;
  settlementBankAccountKey?: string;
  lockedKey?: boolean;
}

export interface PaymentMethodFormResult {
  key: string;
  label: string;
  showIn: PaymentMethodShowIn;
  effectMode: PaymentMethodEffectMode;
  feePercent: number;
  accountKey: string;
  settlementBankAccountKey: string;
  lockedKey: boolean;
}

@Component({
  selector: 'app-payment-method-form-dialog',
  templateUrl: './payment-method-form-dialog.component.html',
  styleUrls: ['./payment-method-form-dialog.component.scss'],
})
export class PaymentMethodFormDialogComponent {
  label = '';
  showIn: PaymentMethodShowIn = 'sale';
  effectMode: PaymentMethodEffectMode = 'instant';
  feePercent = 0;
  accountKey = '';
  settlementBankAccountKey = '';

  readonly showInOptions: { value: PaymentMethodShowIn; labelKey: string }[] = [
    { value: 'sale', labelKey: 'tr_pay_show_in_sale' },
    { value: 'purchase', labelKey: 'tr_pay_show_in_purchase' },
    { value: 'both', labelKey: 'tr_pay_show_in_both' },
  ];

  readonly effectOptions: { value: PaymentMethodEffectMode; labelKey: string }[] = [
    { value: 'instant', labelKey: 'tr_pay_effect_instant' },
    { value: 'settlement', labelKey: 'tr_pay_effect_settlement' },
    { value: 'none', labelKey: 'tr_pay_effect_none' },
  ];

  readonly accounts: MoneyAccount[];
  readonly bankAccounts: MoneyAccount[];
  readonly settlementAccounts: MoneyAccount[];

  constructor(
    private dialogRef: MatDialogRef<PaymentMethodFormDialogComponent, PaymentMethodFormResult | false>,
    @Inject(MAT_DIALOG_DATA)
    public data: PaymentMethodFormData & { accounts: MoneyAccount[] },
    private translate: TranslateService
  ) {
    const all = Array.isArray(data.accounts) ? data.accounts : [];
    this.accounts = all.filter((a) => a.kind === 'cash' || a.kind === 'treasury');
    this.bankAccounts = this.accounts.filter((a) => a.kind === 'treasury' || a.kind === 'cash');
    this.settlementAccounts = all.filter((a) => a.kind === 'settlement' && a.enabled !== false);
    this.label = String(data.label || '').trim();
    this.showIn = data.showIn || 'sale';
    this.effectMode = this.isCash
      ? 'instant'
      : this.isCredit
        ? 'none'
        : data.effectMode || 'instant';
    this.feePercent = Number(data.feePercent) || 0;
    this.accountKey = this.isCash ? 'cash' : String(data.accountKey || '');
    this.settlementBankAccountKey = String(data.settlementBankAccountKey || '');
    this.onEffectChange();
  }

  get isCash(): boolean {
    return String(this.data.key || '').toLowerCase() === 'cash';
  }

  get isCredit(): boolean {
    return String(this.data.key || '').toLowerCase() === 'credit';
  }

  get lockedKey(): boolean {
    return !!this.data.lockedKey || this.isCash || this.isCredit;
  }

  get titleKey(): string {
    if (this.isCash) return 'tr_pay_cash';
    if (this.isCredit) return 'tr_pay_credit';
    return this.data.mode === 'add'
      ? 'tr_payment_methods_fees_add'
      : 'tr_payment_method_edit_title';
  }

  get needsAccountLink(): boolean {
    return !this.isCredit && this.effectMode === 'instant';
  }

  get showSettlementLink(): boolean {
    return !this.isCredit && this.effectMode === 'settlement';
  }

  get cannotSave(): boolean {
    if (!String(this.label || '').trim()) return true;
    if (this.showSettlementLink && !this.accountKey) return true;
    return false;
  }

  get feeEditable(): boolean {
    return !this.isCash && (this.isCredit || this.effectMode !== 'none');
  }

  onEffectChange(): void {
    if (this.isCash) {
      this.effectMode = 'instant';
      this.feePercent = 0;
      this.accountKey = 'cash';
      this.settlementBankAccountKey = '';
      return;
    }
    if (this.isCredit) {
      this.effectMode = 'none';
      this.accountKey = '';
      this.settlementBankAccountKey = '';
      return;
    }
    if (this.effectMode === 'none') {
      this.feePercent = 0;
      this.accountKey = '';
      this.settlementBankAccountKey = '';
      return;
    }
    if (this.effectMode === 'settlement') {
      const linked = String(this.accountKey || this.data.accountKey || '')
        .trim()
        .toLowerCase();
      this.accountKey = this.settlementAccounts.some((a) => a.key === linked) ? linked : '';
      if (!this.settlementBankAccountKey) {
        const misr = this.bankAccounts.find((a) => a.key === 'bank_misr');
        this.settlementBankAccountKey = misr?.key || this.bankAccounts[0]?.key || '';
      }
      return;
    }
    this.settlementBankAccountKey = '';
    if (!this.accounts.some((a) => a.key === this.accountKey)) {
      this.accountKey = '';
    }
  }

  cancel(): void {
    this.dialogRef.close(false);
  }

  submit(): void {
    const label = String(this.label || '').trim().slice(0, 120);
    if (!label) return;

    let effectMode: PaymentMethodEffectMode = this.effectMode || 'instant';
    if (this.isCash) effectMode = 'instant';
    if (this.isCredit) effectMode = 'none';

    let accountKey = '';
    let settlementBankAccountKey = '';
    if (this.isCash) {
      accountKey = 'cash';
    } else if (effectMode === 'settlement') {
      accountKey = String(this.accountKey || '')
        .trim()
        .toLowerCase();
      settlementBankAccountKey = String(this.settlementBankAccountKey || '')
        .trim()
        .toLowerCase();
    } else if (effectMode === 'instant') {
      accountKey = String(this.accountKey || '').trim().toLowerCase();
    }

    this.dialogRef.close({
      key: String(this.data.key || '').trim().toLowerCase(),
      label: label || (this.isCash ? this.translate.instant('tr_pay_cash') : label),
      showIn: this.showIn || 'sale',
      effectMode,
      feePercent:
        this.isCash || (!this.isCredit && effectMode === 'none')
          ? 0
          : Math.max(0, Math.min(100, Number(this.feePercent) || 0)),
      accountKey,
      settlementBankAccountKey,
      lockedKey: this.lockedKey,
    });
  }
}
