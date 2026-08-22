import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { InstallmentPlan } from '@shared/services/installment-plans.service';

export interface InstallmentPlanFormData {
  mode: 'add' | 'edit';
  plan?: Partial<InstallmentPlan>;
  defaultSortOrder?: number;
}

export interface InstallmentPlanFormResult {
  name: string;
  months: number;
  interestPercent: number;
  enabled: boolean;
  sortOrder: number;
}

@Component({
  selector: 'app-installment-plan-form-dialog',
  templateUrl: './installment-plan-form-dialog.component.html',
  styleUrls: ['./installment-plan-form-dialog.component.scss'],
})
export class InstallmentPlanFormDialogComponent {
  name = '';
  months = 12;
  interestPercent = 0;
  enabled = true;
  sortOrder = 0;

  constructor(
    private dialogRef: MatDialogRef<
      InstallmentPlanFormDialogComponent,
      InstallmentPlanFormResult | false
    >,
    @Inject(MAT_DIALOG_DATA) public data: InstallmentPlanFormData
  ) {
    const plan = data.plan || {};
    this.name = String(plan.name || '');
    this.months = Number(plan.months) > 0 ? Math.floor(Number(plan.months)) : 12;
    this.interestPercent = Number.isFinite(Number(plan.interestPercent))
      ? Number(plan.interestPercent)
      : 0;
    this.enabled = plan.enabled !== false;
    this.sortOrder =
      plan.sortOrder != null
        ? Math.floor(Number(plan.sortOrder) || 0)
        : Math.floor(Number(data.defaultSortOrder) || 0);
  }

  get titleKey(): string {
    return this.data.mode === 'edit' ? 'tr_installment_plan_edit' : 'tr_installment_plan_add';
  }

  get cannotSave(): boolean {
    const name = String(this.name || '').trim();
    const months = Math.floor(Number(this.months));
    const interestPercent = Number(this.interestPercent);
    return !name || !Number.isFinite(months) || months < 1 || !Number.isFinite(interestPercent) || interestPercent < 0;
  }

  cancel(): void {
    this.dialogRef.close(false);
  }

  submit(): void {
    if (this.cannotSave) return;
    this.dialogRef.close({
      name: String(this.name || '').trim().slice(0, 120),
      months: Math.floor(Number(this.months)),
      interestPercent: Number(this.interestPercent),
      enabled: this.enabled !== false,
      sortOrder: Math.floor(Number(this.sortOrder) || 0),
    });
  }
}
