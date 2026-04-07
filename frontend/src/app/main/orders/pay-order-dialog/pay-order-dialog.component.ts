import { Component, Inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { OrdersSerivce } from '@shared/services/orders.service';
import { AuthenticationService } from '@core/services/authentication.service';
import { TranslateService } from '@ngx-translate/core';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { Order } from '@core/models/products.model';

export type PayOrderDialogData = { order: Order };

@Component({
  selector: 'app-pay-order-dialog',
  templateUrl: './pay-order-dialog.component.html',
  styleUrls: ['./pay-order-dialog.component.scss'],
})
export class PayOrderDialogComponent {
  saving = false;
  form: FormGroup;
  readonly order: Order;

  constructor(
    private fb: FormBuilder,
    private orders: OrdersSerivce,
    private auth: AuthenticationService,
    private translate: TranslateService,
    private notify: AppNotificationService,
    private ref: MatDialogRef<PayOrderDialogComponent>,
    @Inject(MAT_DIALOG_DATA) data: PayOrderDialogData
  ) {
    this.order = data.order;
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const iso = `${yyyy}-${mm}-${dd}`;

    this.form = this.fb.group({
      amount: [0, [Validators.required, Validators.min(0.01)]],
      paidAt: [iso, [Validators.required]],
      note: [''],
    });
  }

  remaining(): number {
    const total = Number(this.order?.totalPrice) || 0;
    const paid = Number(this.order?.amountPaid) || 0;
    return Math.max(0, Math.round((total - paid) * 100) / 100);
  }

  submit(): void {
    if (this.saving) return;
    this.form.markAllAsTouched();
    if (!this.form.valid) return;

    const v = this.form.getRawValue();
    const amount = Number(v.amount);
    const paidAt = String(v.paidAt || '').trim();
    const note = String(v.note || '').trim();

    this.saving = true;
    const u = this.auth.getUserFromLocalStorage();
    this.orders
      .addPayment(String(this.order._id), {
        amount,
        paidAt,
        userId: u?._id,
        note,
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

