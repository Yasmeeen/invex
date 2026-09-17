import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

export interface AdminEditInstallmentDialogData {
  installmentSaleNumber?: number | null;
  orderNumber?: number | null;
  sequence?: number | null;
  dueDate?: string | Date | null;
  amount?: number | null;
  paidAmount?: number | null;
  installmentCount?: number | null;
}

export interface AdminEditInstallmentDialogResult {
  reason: string;
  dueDate: string;
  amount: number;
  applyDueDateShiftToAll: boolean;
}

@Component({
  selector: 'app-admin-edit-installment-dialog',
  templateUrl: './admin-edit-installment-dialog.component.html',
  styleUrls: ['./admin-installment-dialogs.scss'],
})
export class AdminEditInstallmentDialogComponent {
  reason = '';
  dueDate = '';
  amount: number | null = null;
  applyDueDateShiftToAll = false;

  constructor(
    private dialogRef: MatDialogRef<
      AdminEditInstallmentDialogComponent,
      AdminEditInstallmentDialogResult | false
    >,
    @Inject(MAT_DIALOG_DATA) public data: AdminEditInstallmentDialogData
  ) {
    this.dueDate = this.toDateInput(data?.dueDate);
    this.amount =
      data?.amount != null && Number.isFinite(Number(data.amount))
        ? Number(data.amount)
        : null;
  }

  get canSubmit(): boolean {
    const dueOk = !!String(this.dueDate || '').trim();
    const amountOk =
      this.amount != null && Number.isFinite(Number(this.amount)) && Number(this.amount) >= 0;
    const paid = Number(this.data?.paidAmount || 0);
    const amountVsPaid = !(amountOk && Number(this.amount) + 0.001 < paid);
    return dueOk && amountOk && amountVsPaid;
  }

  get showApplyToAll(): boolean {
    return Number(this.data?.installmentCount || 0) > 1;
  }

  cancel(): void {
    this.dialogRef.close(false);
  }

  submit(): void {
    if (!this.canSubmit) return;
    this.dialogRef.close({
      reason: String(this.reason || '').trim(),
      dueDate: String(this.dueDate || '').trim(),
      amount: Number(this.amount),
      applyDueDateShiftToAll: this.showApplyToAll && !!this.applyDueDateShiftToAll,
    });
  }

  private toDateInput(value?: string | Date | null): string {
    if (!value) return '';
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
}
