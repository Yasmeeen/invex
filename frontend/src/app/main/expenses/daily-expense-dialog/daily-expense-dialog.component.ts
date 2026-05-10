import { Component, Inject, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { Branch } from '@core/models/products.model';
import { AuthenticationService } from '@core/services/authentication.service';
import { canPickBranchRole } from '@core/utils/role-utils';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { BranchesServce } from '@shared/services/branches.service';
import { DailyExpensesService } from '@shared/services/daily-expenses.service';

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
export class DailyExpenseDialogComponent implements OnInit {
  form: FormGroup;
  saving = false;
  branches: Branch[] = [];
  /** Super Admin / Co Admin without forced branch: choose branch in dialog. */
  showBranchPicker = false;
  private fixedBranchId: string | null = null;

  constructor(
    private fb: FormBuilder,
    private dialogRef: MatDialogRef<DailyExpenseDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public data: DailyExpenseDialogData,
    private auth: AuthenticationService,
    private dailyExpenses: DailyExpensesService,
    private branchesService: BranchesServce,
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
      amount: ['', [Validators.required, Validators.min(0.01)]],
      expenseType: ['', [Validators.required, Validators.maxLength(200)]],
      notes: ['', Validators.maxLength(2000)],
    });
  }

  ngOnInit(): void {
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

    const amount = Math.round(Number(raw.amount) * 100) / 100;
    if (!Number.isFinite(amount) || amount <= 0) {
      return;
    }

    this.saving = true;
    this.dailyExpenses
      .create({
        branch: branchId,
        amount,
        expenseType: String(raw.expenseType || '').trim(),
        notes: String(raw.notes || '').trim(),
        userId: this.data.userId,
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
