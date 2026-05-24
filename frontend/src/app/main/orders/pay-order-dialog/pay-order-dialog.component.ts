import { Component, Inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { Order } from '@core/models/products.model';
import { orderDisplayPaid, orderDisplayRemaining } from '@core/utils/order-display.util';
import { AuthenticationService } from '@core/services/authentication.service';
import { resolveActorBranchContext } from '@core/utils/branch-utils';
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
} from '@shared/utils/payment-app-fee.util';

export type PayOrderDialogData = { order: Order; forcedBranchId?: string | null };

@Component({
  selector: 'app-pay-order-dialog',
  templateUrl: './pay-order-dialog.component.html',
  styleUrls: ['./pay-order-dialog.component.scss'],
})
export class PayOrderDialogComponent {
  form: FormGroup;
  saving = false;
  readonly order: Order;
  readonly paymentBranchId: string | null;
  confirmedPayment: PaymentSplitsResult | null = null;

  constructor(
    private fb: FormBuilder,
    private orders: OrdersSerivce,
    private auth: AuthenticationService,
    private translate: TranslateService,
    private notify: AppNotificationService,
    private dialog: MatDialog,
    private ref: MatDialogRef<PayOrderDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) data: PayOrderDialogData
  ) {
    this.order = data.order;
    const actor = this.auth.getUserFromLocalStorage();
    const ctx = resolveActorBranchContext(actor, data.forcedBranchId);
    this.paymentBranchId = ctx.branchId;
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');

    this.form = this.fb.group({
      paidAt: [`${yyyy}-${mm}-${dd}`, [Validators.required]],
      note: ['', Validators.maxLength(500)],
    });
  }

  get remaining(): number {
    return orderDisplayRemaining(this.order);
  }

  displayPaid(): number {
    return orderDisplayPaid(this.order);
  }

  paymentSummaryText(): string {
    if (!this.confirmedPayment) {
      return '';
    }
    const methods = this.confirmedPayment.paymentSplits.filter((s) => s.amount > 0).length;
    const total = paymentSplitsNetTotal(this.confirmedPayment.paymentSplits);
    return this.translate.instant('tr_payment_splits_summary', { count: methods, total });
  }

  openPaymentSplitsDialog(): void {
    const data: PaymentSplitsDialogData = {
      invoiceNetTotal: this.remaining,
      mode: 'installment',
      initialState: this.confirmedPayment
        ? {
            selectedPayMethods: this.confirmedPayment.paymentSplits.map((s) => s.method),
            payAmounts: this.confirmedPayment.paymentSplits.reduce(
              (acc, s) => {
                acc[s.method] = s.amount;
                return acc;
              },
              {} as Record<string, number>
            ),
            feeSources: this.confirmedPayment.feeAllocations.map((f) => ({
              forMethod: f.forMethod,
              paidVia: f.paidVia === f.forMethod ? 'same' : f.paidVia,
            })),
          }
        : undefined,
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
        if (result) {
          this.confirmedPayment = result;
        }
      });
  }

  submit(): void {
    if (this.saving) {
      return;
    }
    this.form.markAllAsTouched();
    if (!this.form.valid) {
      return;
    }

    if (!this.confirmedPayment) {
      this.openPaymentSplitsDialog();
      return;
    }

    if (!this.paymentBranchId) {
      this.notify.push(this.translate.instant('tr_branch_required'), 'error');
      return;
    }

    this.postPayment(this.confirmedPayment);
  }

  private postPayment(payment: PaymentSplitsResult): void {
    const orderId = this.order._id;
    if (!orderId) {
      return;
    }

    const splits = payment.paymentSplits.filter((s) => s.amount > 0);
    const netTotal = paymentSplitsNetTotal(splits);
    if (netTotal <= 0) {
      this.notify.push(this.translate.instant('tr_vendor_deferred_amount_required'), 'error');
      return;
    }
    if (netTotal > this.remaining + 0.001) {
      this.notify.push(this.translate.instant('tr_vendor_deferred_payment_over'), 'error');
      return;
    }

    const v = this.form.getRawValue();
    const paidAt = String(v.paidAt || '').trim();
    const note = String(v.note || '').trim();
    const u = this.auth.getUserFromLocalStorage();

    this.saving = true;
    this.orders
      .addPayment(String(orderId), {
        amount: netTotal,
        paymentSplits: splits,
        paymentFeeAllocations: payment.feeAllocations,
        paidAt,
        userId: u?._id,
        note,
        branchId: this.paymentBranchId || undefined,
      })
      .subscribe({
        next: () => {
          this.saving = false;
          this.notify.push(this.translate.instant('tr_payment_added'), 'success');
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
    this.ref.close(false);
  }
}
