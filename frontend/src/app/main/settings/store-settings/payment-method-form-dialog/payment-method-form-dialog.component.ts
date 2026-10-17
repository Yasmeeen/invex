import { Component, Inject, OnDestroy, OnInit } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { Branch } from '@core/models/products.model';
import { BranchesServce } from '@shared/services/branches.service';
import {
  MoneyAccount,
  PaymentMethodEffectMode,
  PaymentMethodShowIn,
} from '@shared/services/store-settings.service';
import { paymentMethodAlwaysAllBranches } from '@shared/utils/branch-scope.util';
import { Subscription } from 'rxjs';

export interface PaymentMethodFormData {
  mode: 'add' | 'edit';
  key?: string;
  label?: string;
  showIn?: PaymentMethodShowIn;
  effectMode?: PaymentMethodEffectMode;
  feePercent?: number;
  accountKey?: string;
  settlementBankAccountKey?: string;
  branchIds?: string[];
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
  branchIds: string[];
  lockedKey: boolean;
}

@Component({
  selector: 'app-payment-method-form-dialog',
  templateUrl: './payment-method-form-dialog.component.html',
  styleUrls: ['./payment-method-form-dialog.component.scss'],
})
export class PaymentMethodFormDialogComponent implements OnInit, OnDestroy {
  label = '';
  showIn: PaymentMethodShowIn = 'sale';
  effectMode: PaymentMethodEffectMode = 'instant';
  feePercent = 0;
  accountKey = '';
  settlementBankAccountKey = '';
  selectedBranchIds: string[] = [];
  branches: Branch[] = [];
  private subscriptions: Subscription[] = [];

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
    private translate: TranslateService,
    private branchesService: BranchesServce
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

  ngOnInit(): void {
    this.subscriptions.push(
      this.branchesService.getBranchs({ page: 1, limit: 1000 }).subscribe({
        next: (res: any) => {
          this.branches = res?.branches || [];
          this.initBranchSelection();
        },
        error: () => {
          this.branches = [];
        },
      })
    );
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

  get showBranchPicker(): boolean {
    return !paymentMethodAlwaysAllBranches(this.data.key, this.effectMode);
  }

  get cannotSave(): boolean {
    if (!String(this.label || '').trim()) return true;
    if (this.showSettlementLink && !this.accountKey) return true;
    if (this.showBranchPicker && !this.selectedBranchIds.length) return true;
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
      this.selectedBranchIds = [];
      return;
    }
    if (this.isCredit) {
      this.effectMode = 'none';
      this.accountKey = '';
      this.settlementBankAccountKey = '';
      this.selectedBranchIds = [];
      return;
    }
    if (this.effectMode === 'none') {
      this.feePercent = 0;
      this.accountKey = '';
      this.settlementBankAccountKey = '';
    } else if (this.effectMode === 'settlement') {
      const linked = String(this.accountKey || this.data.accountKey || '')
        .trim()
        .toLowerCase();
      this.accountKey = this.settlementAccounts.some((a) => a.key === linked) ? linked : '';
      if (!this.settlementBankAccountKey) {
        const misr = this.bankAccounts.find((a) => a.key === 'bank_misr');
        this.settlementBankAccountKey = misr?.key || this.bankAccounts[0]?.key || '';
      }
      this.selectedBranchIds = [];
      return;
    } else {
      this.settlementBankAccountKey = '';
      if (!this.accounts.some((a) => a.key === this.accountKey)) {
        this.accountKey = '';
      }
    }
    if (this.showBranchPicker && this.branches.length && !this.selectedBranchIds.length) {
      this.selectedBranchIds = this.branches.map((b) => String(b._id));
    }
  }

  cancel(): void {
    this.dialogRef.close(false);
  }

  submit(): void {
    const label = String(this.label || '').trim().slice(0, 120);
    if (!label || this.cannotSave) return;

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
      branchIds: this.showBranchPicker
        ? this.selectedBranchIds.map((id) => String(id))
        : [],
      lockedKey: this.lockedKey,
    });
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach((s) => s.unsubscribe());
  }

  private initBranchSelection(): void {
    if (!this.showBranchPicker) {
      this.selectedBranchIds = [];
      return;
    }
    const existing = (this.data.branchIds || []).map((id) => String(id)).filter(Boolean);
    if (existing.length) {
      this.selectedBranchIds = existing;
      return;
    }
    this.selectedBranchIds = this.branches.map((b) => String(b._id));
  }
}
