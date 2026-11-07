import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

export interface AdminReverseInstallmentDialogData {
  sequence?: number | null;
  dueDate?: string | Date | null;
  paidAmount?: number | null;
  paymentMethod?: string | null;
  installmentSaleNumber?: number | null;
  clientName?: string | null;
}

export interface AdminReverseInstallmentDialogResult {
  reason: string;
  reverseDrawer: boolean;
}

@Component({
  selector: 'app-admin-reverse-installment-dialog',
  templateUrl: './admin-reverse-installment-dialog.component.html',
  styleUrls: ['./admin-installment-dialogs.scss'],
})
export class AdminReverseInstallmentDialogComponent {
  reason = '';
  /** Drawer outflow is a book correction, not cash handed back to the client. */
  moneyChoice: 'drawer' | 'keep' = 'drawer';

  constructor(
    private dialogRef: MatDialogRef<
      AdminReverseInstallmentDialogComponent,
      AdminReverseInstallmentDialogResult | false
    >,
    @Inject(MAT_DIALOG_DATA) public data: AdminReverseInstallmentDialogData
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
    this.dialogRef.close({ reason, reverseDrawer: this.moneyChoice === 'drawer' });
  }
}
