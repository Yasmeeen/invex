import { Component, Inject, OnDestroy, OnInit } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { OrdersSerivce } from '@shared/services/orders.service';
import { Subscription } from 'rxjs';

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
export class AdminEditSaleNumberDialogComponent implements OnInit, OnDestroy {
  saleNumber: number | null = null;
  reason = '';
  suggestedSaleNumber: number | null = null;
  loadingSuggestion = false;

  private sub?: Subscription;

  constructor(
    private dialogRef: MatDialogRef<
      AdminEditSaleNumberDialogComponent,
      AdminEditSaleNumberDialogResult | false
    >,
    @Inject(MAT_DIALOG_DATA) public data: AdminEditSaleNumberDialogData,
    private orders: OrdersSerivce
  ) {
    const n = Number(data?.installmentSaleNumber);
    this.saleNumber = Number.isFinite(n) && n > 0 ? n : null;
  }

  ngOnInit(): void {
    this.loadingSuggestion = true;
    this.sub = this.orders.getNextInstallmentSaleNumber().subscribe({
      next: (res) => {
        this.loadingSuggestion = false;
        const next = Math.floor(Number(res?.nextInstallmentSaleNumber));
        if (!Number.isFinite(next) || next < 1) {
          this.suggestedSaleNumber = 1;
        } else {
          this.suggestedSaleNumber = next;
        }
        // Prefill with sequential suggestion when the sale has no number yet.
        if (this.saleNumber == null) {
          this.saleNumber = this.suggestedSaleNumber;
        }
      },
      error: () => {
        this.loadingSuggestion = false;
        if (this.saleNumber == null) {
          this.suggestedSaleNumber = 1;
          this.saleNumber = 1;
        }
      },
    });
  }

  get canSubmit(): boolean {
    const n = Math.floor(Number(this.saleNumber));
    return Number.isFinite(n) && n >= 1;
  }

  useSuggested(): void {
    if (this.suggestedSaleNumber == null) return;
    this.saleNumber = this.suggestedSaleNumber;
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

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}
