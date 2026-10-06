import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

export interface AdminMinimumCollectionDialogData {
  minimumCollectionAmount?: number | null;
  installmentAmount?: number | null;
  installmentSaleNumber?: number | null;
  orderNumber?: number | null;
  clientName?: string | null;
  productNames?: string | null;
}

export interface AdminMinimumCollectionDialogResult {
  minimumCollectionAmount: number;
  reason: string;
  cleared: boolean;
}

@Component({
  selector: 'app-admin-minimum-collection-dialog',
  templateUrl: './admin-minimum-collection-dialog.component.html',
  styleUrls: ['./admin-installment-dialogs.scss'],
})
export class AdminMinimumCollectionDialogComponent {
  amount: number | null = null;
  reason = '';

  constructor(
    private dialogRef: MatDialogRef<
      AdminMinimumCollectionDialogComponent,
      AdminMinimumCollectionDialogResult | false
    >,
    @Inject(MAT_DIALOG_DATA) public data: AdminMinimumCollectionDialogData
  ) {
    const current = Number(data?.minimumCollectionAmount);
    this.amount = Number.isFinite(current) && current > 0 ? current : null;
  }

  get installmentAmount(): number {
    const n = Number(this.data?.installmentAmount);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  get canClear(): boolean {
    const current = Number(this.data?.minimumCollectionAmount);
    return Number.isFinite(current) && current > 0.001;
  }

  get canSubmit(): boolean {
    const n = Number(this.amount);
    if (!Number.isFinite(n) || n <= 0) return false;
    if (this.installmentAmount > 0 && n >= this.installmentAmount - 0.001) return false;
    return true;
  }

  get tooHigh(): boolean {
    const n = Number(this.amount);
    return (
      Number.isFinite(n) &&
      n > 0 &&
      this.installmentAmount > 0 &&
      n >= this.installmentAmount - 0.001
    );
  }

  cancel(): void {
    this.dialogRef.close(false);
  }

  clear(): void {
    this.dialogRef.close({
      minimumCollectionAmount: 0,
      reason: String(this.reason || '').trim(),
      cleared: true,
    });
  }

  submit(): void {
    if (!this.canSubmit) return;
    this.dialogRef.close({
      minimumCollectionAmount: Math.round(Number(this.amount) * 100) / 100,
      reason: String(this.reason || '').trim(),
      cleared: false,
    });
  }
}
