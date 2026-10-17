import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { Branch } from '@core/models/products.model';
import { ClientHistoryOrderRow } from '@core/models/users-interfaces.model';
import { previewEarlySettlement } from '@core/utils/early-settlement.util';
import { AuthenticationService } from '@core/services/authentication.service';
import { TranslateService } from '@ngx-translate/core';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { OrdersSerivce } from '@shared/services/orders.service';
import {
  PaymentSplitsDialogComponent,
  PaymentSplitsDialogData,
} from '@shared/components/payment-splits-dialog/payment-splits-dialog.component';
import {
  PaymentSplitsResult,
  paymentSplitsNetTotal,
  round2,
} from '@shared/utils/payment-app-fee.util';

export interface EarlySettlementDialogData {
  order: ClientHistoryOrderRow;
  clientName?: string;
  forcedBranchId?: string | null;
  showBranchPicker?: boolean;
  branches?: Branch[];
}

@Component({
  selector: 'app-early-settlement-dialog',
  templateUrl: './early-settlement-dialog.component.html',
  styleUrls: ['./early-settlement-dialog.component.scss'],
})
export class EarlySettlementDialogComponent {
  amount: number | null = null;
  branchId = '';
  saving = false;
  readonly order: ClientHistoryOrderRow;
  readonly showBranchPicker: boolean;
  readonly branches: Branch[];

  constructor(
    private orders: OrdersSerivce,
    private auth: AuthenticationService,
    private translate: TranslateService,
    private notify: AppNotificationService,
    private dialog: MatDialog,
    private ref: MatDialogRef<EarlySettlementDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) data: EarlySettlementDialogData
  ) {
    this.order = data.order;
    this.showBranchPicker = !!data.showBranchPicker;
    this.branches = data.branches || [];
    this.branchId = String(data.forcedBranchId || '').trim();
    if (this.showBranchPicker && !this.branchId && this.branches[0]?._id) {
      this.branchId = String(this.branches[0]._id);
    }
  }

  get preview() {
    return previewEarlySettlement(this.order, Number(this.amount));
  }

  get amountInvalid(): boolean {
    if (this.amount == null || (this.amount as unknown) === '') return false;
    const raw = Number(this.amount);
    return !Number.isFinite(raw) || raw <= 0.001 || raw > this.preview.due + 0.001;
  }

  absAmount(value: number): number {
    return Math.abs(round2(value));
  }

  pay(): void {
    if (this.saving || !this.preview.valid) {
      this.notify.push(this.translate.instant('tr_early_settlement_invalid_amount'), 'error');
      return;
    }
    const branchId = String(this.branchId || '').trim();
    if (!branchId) {
      this.notify.push(this.translate.instant('tr_branch_required'), 'error');
      return;
    }

    const data: PaymentSplitsDialogData = {
      invoiceNetTotal: this.preview.settlement,
      mode: 'installment',
    };
    this.dialog
      .open(PaymentSplitsDialogComponent, {
        width: '560px',
        maxWidth: '95vw',
        panelClass: 'payment-splits-dialog-panel',
        backdropClass: 'payment-splits-dialog-backdrop',
        data,
      })
      .afterClosed()
      .subscribe((result: PaymentSplitsResult | null) => {
        if (!result) return;
        const net = paymentSplitsNetTotal(result.paymentSplits);
        if (Math.abs(net - this.preview.settlement) > 0.02) {
          this.notify.push(this.translate.instant('tr_early_settlement_payment_mismatch'), 'error');
          return;
        }
        this.submit(result, branchId);
      });
  }

  private submit(payment: PaymentSplitsResult, branchId: string): void {
    const orderId = this.order?._id;
    if (!orderId || this.saving) return;
    const splits = payment.paymentSplits.filter((s) => s.amount > 0);
    const u = this.auth.getUserFromLocalStorage();
    const today = new Date();
    const paidAt = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
      today.getDate()
    ).padStart(2, '0')}`;

    this.saving = true;
    this.orders
      .earlySettle(String(orderId), {
        settlementAmount: this.preview.settlement,
        paymentSplits: splits,
        paymentFeeAllocations: payment.feeAllocations,
        paidAt,
        userId: u?._id,
        branchId,
        note: 'سداد معجل',
      })
      .subscribe({
        next: () => {
          this.saving = false;
          this.notify.push(this.translate.instant('tr_early_settlement_ok'), 'success');
          this.ref.close(true);
        },
        error: (err) => {
          this.saving = false;
          const msg =
            err?.error?.error ||
            err?.error?.message ||
            this.translate.instant('tr_unexpected_error_message');
          this.notify.push(msg, 'error');
        },
      });
  }

  close(): void {
    if (this.saving) return;
    this.ref.close(false);
  }
}
