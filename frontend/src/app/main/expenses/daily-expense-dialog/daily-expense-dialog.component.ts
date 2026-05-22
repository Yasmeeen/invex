import { Component, Inject, OnDestroy, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { Branch } from '@core/models/products.model';
import { AuthenticationService } from '@core/services/authentication.service';
import { canPickBranchRole } from '@core/utils/role-utils';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { BranchesServce } from '@shared/services/branches.service';
import {
  DailyExpensesService,
  ExpenseTreasurySplit,
} from '@shared/services/daily-expenses.service';
import { StoreSettingsService } from '@shared/services/store-settings.service';
import { Subscription } from 'rxjs';

export interface DailyExpenseDialogData {
  userId: string;
  /** When set, expense is recorded for this branch only. */
  forcedBranchId?: string | null;
}

@Component({
  selector: 'app-daily-expense-dialog',
  templateUrl: './daily-expense-dialog.component.html',
  styleUrls: ['./daily-expense-dialog.component.scss'],
})
export class DailyExpenseDialogComponent implements OnInit, OnDestroy {
  form: FormGroup;
  saving = false;
  branches: Branch[] = [];
  showBranchPicker = false;
  private fixedBranchId: string | null = null;
  private subscriptions: Subscription[] = [];

  treasuryMethodOptions: { key: string; label: string }[] = [];
  selectedTreasuryKeys: string[] = ['cash'];
  treasuryAmounts: Record<string, number> = {};

  constructor(
    private fb: FormBuilder,
    private dialogRef: MatDialogRef<DailyExpenseDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public data: DailyExpenseDialogData,
    private auth: AuthenticationService,
    private dailyExpenses: DailyExpensesService,
    private branchesService: BranchesServce,
    private storeSettings: StoreSettingsService,
    private notify: AppNotificationService,
    private translate: TranslateService
  ) {
    const actor = this.auth.getUserFromLocalStorage();
    const forced = data.forcedBranchId ? String(data.forcedBranchId).trim() : '';

    if (forced) {
      this.fixedBranchId = forced;
      this.showBranchPicker = false;
    } else if (canPickBranchRole(actor?.role)) {
      this.showBranchPicker = true;
      this.fixedBranchId = null;
    } else {
      const b = actor?.branch as { _id?: string } | string | undefined;
      const bmBranch =
        typeof b === 'string'
          ? String(b).trim()
          : b?._id
            ? String(b._id).trim()
            : '';
      this.fixedBranchId = bmBranch || null;
      this.showBranchPicker = false;
    }

    this.form = this.fb.group({
      branchId: [this.fixedBranchId || '', this.showBranchPicker ? Validators.required : []],
      expenseType: ['', [Validators.required, Validators.maxLength(200)]],
      notes: ['', Validators.maxLength(2000)],
    });
  }

  ngOnInit(): void {
    this.syncTreasuryOptions();
    this.subscriptions.push(
      this.storeSettings.settings$.subscribe(() => this.syncTreasuryOptions())
    );

    if (this.fixedBranchId) {
      this.form.patchValue({ branchId: this.fixedBranchId });
      this.form.get('branchId')?.disable();
      return;
    }

    if (this.showBranchPicker) {
      this.branchesService.getBranchs({ page: 1, limit: 1000 }).subscribe({
        next: (res: any) => {
          this.branches = res?.branches || [];
          const first = this.branches[0]?._id;
          if (first && !this.form.get('branchId')?.value) {
            this.form.patchValue({ branchId: first });
          }
        },
        error: () => {
          this.notify.push(this.translate.instant('tr_unexpected_error_message'), 'error');
        },
      });
      return;
    }

    if (!this.form.get('branchId')?.value) {
      this.notify.push(this.translate.instant('tr_branch_required'), 'error');
      this.dialogRef.close(false);
    }
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach((s) => s.unsubscribe());
  }

  private syncTreasuryOptions(): void {
    const m = this.storeSettings.snapshot.purchaseTreasuryMethods;
    if (Array.isArray(m) && m.length) {
      this.treasuryMethodOptions = m.map((x) => ({
        key: String(x.key || '').trim().toLowerCase(),
        label: String(x.label || x.key || '').trim(),
      }));
    } else {
      this.treasuryMethodOptions = [
        { key: 'cash', label: this.translate.instant('tr_pay_cash') },
      ];
    }

    const keys = new Set(this.treasuryMethodOptions.map((o) => o.key));
    const valid = this.selectedTreasuryKeys.filter((k) => keys.has(k));
    if (!valid.length) {
      const cash = this.treasuryMethodOptions.find((o) => o.key === 'cash');
      this.selectedTreasuryKeys = [cash ? cash.key : this.treasuryMethodOptions[0]?.key || 'cash'];
    } else {
      this.selectedTreasuryKeys = valid;
    }
    this.reconcileTreasuryAmountsKeys(this.selectedTreasuryKeys);
  }

  treasuryOptionLabel(key: string): string {
    return this.treasuryMethodOptions.find((o) => o.key === key)?.label || key;
  }

  onSelectedTreasuryChange(ids: string[] | null): void {
    const raw = Array.isArray(ids) ? ids.filter((x) => !!String(x || '').trim()) : [];
    if (!raw.length) {
      this.selectedTreasuryKeys = ['cash'];
      this.reconcileTreasuryAmountsKeys(['cash']);
      return;
    }
    this.reconcileTreasuryAmountsKeys(raw);
  }

  private reconcileTreasuryAmountsKeys(ids: string[]): void {
    const next: Record<string, number> = {};
    for (const id of ids) {
      next[id] = Number(this.treasuryAmounts[id]) || 0;
    }
    this.treasuryAmounts = next;
    this.selectedTreasuryKeys = ids;
  }

  trackTreasuryKey(_index: number, key: string): string {
    return key;
  }

  treasuryOverflowTitle(items: readonly { key?: string; label?: string }[] | null | undefined): string {
    if (!items?.length || items.length <= 2) {
      return '';
    }
    return items
      .slice(2)
      .map((row) => String(row?.label || row?.key || '').trim())
      .filter(Boolean)
      .join(', ');
  }

  treasurySplitsTotal(): number {
    const sum = this.selectedTreasuryKeys.reduce(
      (acc, key) => acc + (Number(this.treasuryAmounts[key]) || 0),
      0
    );
    return Math.round(sum * 100) / 100;
  }

  private buildTreasurySplitsPayload(): ExpenseTreasurySplit[] | null {
    const splits = this.selectedTreasuryKeys
      .map((key) => ({
        key,
        label: this.treasuryOptionLabel(key),
        amount: Math.round((Number(this.treasuryAmounts[key]) || 0) * 100) / 100,
      }))
      .filter((s) => s.amount > 0);

    if (!splits.length) {
      this.notify.push(this.translate.instant('tr_daily_expense_treasury_required'), 'error');
      return null;
    }

    const total = this.treasurySplitsTotal();
    if (total <= 0) {
      this.notify.push(this.translate.instant('tr_daily_expense_amount_required'), 'error');
      return null;
    }

    return splits;
  }

  submit(): void {
    if (this.showBranchPicker) {
      this.form.get('branchId')?.enable();
    }

    this.form.markAllAsTouched();
    if (!this.form.valid) {
      return;
    }

    const raw = this.form.getRawValue();
    const branchId = String(raw.branchId || '').trim();
    if (!branchId) {
      this.notify.push(this.translate.instant('tr_branch_required'), 'error');
      return;
    }

    const splits = this.buildTreasurySplitsPayload();
    if (!splits) {
      return;
    }

    const amount = this.treasurySplitsTotal();

    this.saving = true;
    this.dailyExpenses
      .create({
        branch: branchId,
        amount,
        expenseType: String(raw.expenseType || '').trim(),
        notes: String(raw.notes || '').trim(),
        userId: this.data.userId,
        expenseTreasurySplits: splits,
      })
      .subscribe({
        next: () => {
          this.saving = false;
          this.notify.push(this.translate.instant('tr_daily_expense_saved'), 'success');
          this.dialogRef.close(true);
        },
        error: (err) => {
          this.saving = false;
          const msg = err?.error?.error || this.translate.instant('tr_unexpected_error_message');
          this.notify.push(msg, 'error');
        },
      });
  }

  cancel(): void {
    this.dialogRef.close(false);
  }
}
