import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

export interface AdminDeleteClientDialogData {
  clientName?: string | null;
  clientPhone?: string | null;
  /** Number of installment sales that still have unpaid rows. */
  openInstallmentSalesCount?: number;
  /** Total remaining on unpaid installment rows. */
  openInstallmentsRemainingAmount?: number;
  /** Total installment sales that will be deleted (open + paid). */
  installmentSalesCount?: number;
}

export interface AdminDeleteClientDialogResult {
  reason: string;
}

@Component({
  selector: 'app-admin-delete-client-dialog',
  templateUrl: './admin-delete-client-dialog.component.html',
  styleUrls: ['./admin-installment-dialogs.scss'],
})
export class AdminDeleteClientDialogComponent {
  reason = '';

  constructor(
    private dialogRef: MatDialogRef<
      AdminDeleteClientDialogComponent,
      AdminDeleteClientDialogResult | false
    >,
    @Inject(MAT_DIALOG_DATA) public data: AdminDeleteClientDialogData
  ) {}

  get hasOpenInstallments(): boolean {
    return (Number(this.data?.openInstallmentSalesCount) || 0) > 0
      || (Number(this.data?.openInstallmentsRemainingAmount) || 0) > 0.001;
  }

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
