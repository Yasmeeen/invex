import { Component, Inject, OnDestroy, OnInit } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { Branch } from '@core/models/products.model';
import { BranchesServce } from '@shared/services/branches.service';
import { MoneyAccountChannel, MoneyAccountKind } from '@shared/services/store-settings.service';
import { moneyAccountAlwaysAllBranches } from '@shared/utils/branch-scope.util';
import { Subscription } from 'rxjs';

export type MoneyAccountFormType = 'bank' | 'wallet' | 'vault' | 'settlement';

export interface MoneyAccountFormData {
  mode: 'add' | 'edit';
  key?: string;
  label?: string;
  kind?: MoneyAccountKind;
  channel?: MoneyAccountChannel | '';
  accountNumber?: string;
  phone?: string;
  enabled?: boolean;
  branchIds?: string[];
}

export interface MoneyAccountFormResult {
  key: string;
  label: string;
  kind: 'treasury' | 'vault' | 'settlement';
  channel: MoneyAccountChannel | '';
  accountNumber: string;
  phone: string;
  enabled: boolean;
  branchIds: string[];
}

@Component({
  selector: 'app-money-account-form-dialog',
  templateUrl: './money-account-form-dialog.component.html',
  styleUrls: ['./money-account-form-dialog.component.scss'],
})
export class MoneyAccountFormDialogComponent implements OnInit, OnDestroy {
  label = '';
  accountType: MoneyAccountFormType = 'bank';
  accountNumber = '';
  phone = '';
  enabled = true;
  selectedBranchIds: string[] = [];
  branches: Branch[] = [];
  private subscriptions: Subscription[] = [];

  constructor(
    private dialogRef: MatDialogRef<MoneyAccountFormDialogComponent, MoneyAccountFormResult | false>,
    @Inject(MAT_DIALOG_DATA) public data: MoneyAccountFormData,
    private translate: TranslateService,
    private branchesService: BranchesServce
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
    } else if (data.kind === 'vault') {
      this.accountType = 'vault';
      this.accountNumber = '';
      this.phone = '';
    } else {
      this.accountType = data.channel === 'wallet' ? 'wallet' : 'bank';
      this.accountNumber = String(data.accountNumber || '').trim();
      this.phone = String(data.phone || '').trim();
    }
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

  get typeLocked(): boolean {
    return this.data.mode === 'edit';
  }

  get isSettlement(): boolean {
    return this.accountType === 'settlement';
  }

  get isVault(): boolean {
    return this.accountType === 'vault';
  }

  get showBranchPicker(): boolean {
    if (this.isCash || this.isSettlement) return false;
    return !moneyAccountAlwaysAllBranches(
      this.accountType === 'vault' ? 'vault' : 'treasury',
      this.data.key
    );
  }

  get titleKey(): string {
    if (this.isCash) return 'tr_money_account_edit_cash_title';
    if (this.data.mode === 'add' && this.isVault) return 'tr_money_account_add_vault';
    if (this.data.mode === 'add' && this.isSettlement) return 'tr_money_account_add_settlement';
    return this.data.mode === 'add' ? 'tr_money_accounts_add' : 'tr_money_account_edit_title';
  }

  get cannotSave(): boolean {
    if (!String(this.label || '').trim()) return true;
    if (this.showBranchPicker && !this.selectedBranchIds.length) return true;
    return false;
  }

  onTypeChange(next: string): void {
    if (this.typeLocked) return;
    if (next === 'wallet') this.accountType = 'wallet';
    else if (next === 'settlement') this.accountType = 'settlement';
    else if (next === 'vault') this.accountType = 'vault';
    else this.accountType = 'bank';
    if (this.accountType !== 'bank') this.accountNumber = '';
    if (this.accountType !== 'wallet') this.phone = '';
    if (this.showBranchPicker && !this.selectedBranchIds.length) {
      this.selectedBranchIds = this.branches.map((b) => String(b._id));
    }
  }

  cancel(): void {
    this.dialogRef.close(false);
  }

  submit(): void {
    const label = String(this.label || '').trim().slice(0, 120);
    if (!label || this.cannotSave) {
      return;
    }
    const branchIds = this.showBranchPicker
      ? this.selectedBranchIds.map((id) => String(id))
      : [];
    if (this.isCash) {
      this.dialogRef.close({
        key: 'cash',
        label: label || this.translate.instant('tr_treasury_cash'),
        kind: 'treasury',
        channel: '',
        accountNumber: '',
        phone: '',
        enabled: true,
        branchIds: [],
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
        branchIds: [],
      });
      return;
    }
    if (this.accountType === 'vault') {
      this.dialogRef.close({
        key: String(this.data.key || '').trim().toLowerCase(),
        label,
        kind: 'vault',
        channel: '',
        accountNumber: '',
        phone: '',
        enabled: this.enabled !== false,
        branchIds,
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
      branchIds,
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
    // Legacy empty = all branches; pre-select all so edit preserves that unless narrowed.
    this.selectedBranchIds = this.branches.map((b) => String(b._id));
  }
}
