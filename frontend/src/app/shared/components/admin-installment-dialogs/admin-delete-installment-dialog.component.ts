import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

export interface AdminDeleteInstallmentDialogData {
  sequence?: number | null;
  dueDate?: string | Date | null;
  amount?: number | null;
  installmentSaleNumber?: number | null;
  orderNumber?: number | null;
  clientName?: string | null;
}

export interface AdminDeleteInstallmentDialogResult {
  reason: string;
}

@Component({
  selector: 'app-admin-delete-installment-dialog',
  templateUrl: './admin-delete-installment-dialog.component.html',
  styleUrls: ['./admin-installment-dialogs.scss'],
})
export class AdminDeleteInstallmentDialogComponent {
  reason = '';

  constructor(
    private dialogRef: MatDialogRef<
      AdminDeleteInstallmentDialogComponent,
      AdminDeleteInstallmentDialogResult | false
    >,
    @Inject(MAT_DIALOG_DATA) public data: AdminDeleteInstallmentDialogData
  ) {}

  get canSubmit(): boolean {
    return String(this.reason || '').trim().length >= 3;
  }

  cancel(): void {
    this.dialogRef.close(false);
  }

  submit(): void {
    const reason = String(this.reason || '').trim();
    if (reason.length < 3) return;
    this.dialogRef.close({ reason });
  }
}
