import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

export interface AdminDeleteSaleDialogData {
  installmentSaleNumber?: number | null;
  orderNumber?: number | null;
  clientName?: string | null;
  totalPrice?: number | null;
  productNames?: string | null;
}

export interface AdminDeleteSaleDialogResult {
  reason: string;
}

@Component({
  selector: 'app-admin-delete-sale-dialog',
  templateUrl: './admin-delete-sale-dialog.component.html',
  styleUrls: ['./admin-installment-dialogs.scss'],
})
export class AdminDeleteSaleDialogComponent {
  reason = '';

  constructor(
    private dialogRef: MatDialogRef<
      AdminDeleteSaleDialogComponent,
      AdminDeleteSaleDialogResult | false
    >,
    @Inject(MAT_DIALOG_DATA) public data: AdminDeleteSaleDialogData
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
