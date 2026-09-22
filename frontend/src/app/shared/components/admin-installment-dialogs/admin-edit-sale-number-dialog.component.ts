import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

export interface AdminEditSaleNumberDialogData {
  installmentSaleNumber?: number | null;
  orderNumber?: number | null;
  clientName?: string | null;
  productNames?: string | null;
}

export interface AdminEditSaleNumberDialogResult {
  installmentSaleNumber: number;
  reason: string;
}

@Component({
  selector: 'app-admin-edit-sale-number-dialog',
  templateUrl: './admin-edit-sale-number-dialog.component.html',
  styleUrls: ['./admin-installment-dialogs.scss'],
})
export class AdminEditSaleNumberDialogComponent {
  saleNumber: number | null = null;
  reason = '';

  constructor(
    private dialogRef: MatDialogRef<
      AdminEditSaleNumberDialogComponent,
      AdminEditSaleNumberDialogResult | false
    >,
    @Inject(MAT_DIALOG_DATA) public data: AdminEditSaleNumberDialogData
  ) {
    const n = Number(data?.installmentSaleNumber);
    this.saleNumber = Number.isFinite(n) && n > 0 ? n : null;
  }

  get canSubmit(): boolean {
    const n = Math.floor(Number(this.saleNumber));
    return Number.isFinite(n) && n >= 1;
  }

  cancel(): void {
    this.dialogRef.close(false);
  }

  submit(): void {
    if (!this.canSubmit) return;
    this.dialogRef.close({
      installmentSaleNumber: Math.floor(Number(this.saleNumber)),
      reason: String(this.reason || '').trim(),
    });
  }
}
