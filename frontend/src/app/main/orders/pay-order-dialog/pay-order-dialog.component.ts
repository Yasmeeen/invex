import { Component, Inject, OnDestroy, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Order } from '@core/models/products.model';
import { orderDisplayPaid, orderDisplayRemaining } from '@core/utils/order-display.util';
import { AuthenticationService } from '@core/services/authentication.service';
import { TranslateService } from '@ngx-translate/core';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { OrdersSerivce } from '@shared/services/orders.service';
import { StoreSettingsService } from '@shared/services/store-settings.service';
import {
  buildCashierPaymentMethods,
  CashierPaymentMethod,
} from '@shared/utils/cashier-payment-methods.util';
import { Subscription } from 'rxjs';

export type PayOrderDialogData = { order: Order };

@Component({
  selector: 'app-pay-order-dialog',
  templateUrl: './pay-order-dialog.component.html',
  styleUrls: ['./pay-order-dialog.component.scss'],
})
export class PayOrderDialogComponent implements OnInit, OnDestroy {
  form: FormGroup;
  saving = false;
  readonly order: Order;

  /** Customer payment methods (from store settings); credit excluded for installments. */
  paymentMethods: CashierPaymentMethod[] = [];
  paymentMethodsForSplit: CashierPaymentMethod[] = [];
  selectedPayMethods: string[] = ['cash'];
  payAmounts: Record<string, number> = {};

  private subscriptions: Subscription[] = [];

  constructor(
    private fb: FormBuilder,
    private orders: OrdersSerivce,
    private auth: AuthenticationService,
    private storeSettings: StoreSettingsService,
    private translate: TranslateService,
    private notify: AppNotificationService,
    private ref: MatDialogRef<PayOrderDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) data: PayOrderDialogData
  ) {
    this.order = data.order;
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

  ngOnInit(): void {
    this.rebuildPaymentMethods();
    this.subscriptions.push(
      this.storeSettings.settings$.subscribe(() => this.rebuildPaymentMethods())
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach((s) => s.unsubscribe());
  }

  displayPaid(): number {
    return orderDisplayPaid(this.order);
  }

  private rebuildPaymentMethods(): void {
    const all = buildCashierPaymentMethods(
      this.storeSettings.snapshot.paymentAppFeePercents,
      this.translate
    );
    this.paymentMethods = all.filter((m) => m.id !== 'credit');
    this.paymentMethodsForSplit = this.paymentMethods;
    const keys = new Set(this.paymentMethods.map((m) => m.id));
    const valid = this.selectedPayMethods.filter((k) => keys.has(k));
    if (!valid.length) {
      this.selectedPayMethods = ['cash'];
      this.payAmounts = { cash: 0 };
    } else {
      this.selectedPayMethods = valid;
      this.reconcilePayAmountsKeys(valid);
    }
  }

  paymentAppFeePercent(methodId: string | undefined | null): number {
    const m = String(methodId || '').trim().toLowerCase();
    const row = this.storeSettings.snapshot.paymentAppFeePercents?.find((x) => x.method === m);
    const p = Number(row?.percent);
    return Number.isFinite(p) && p > 0 ? Math.min(p, 100) : 0;
  }

  payAmountNetForInvoice(methodId: string, enteredGross: number): number {
    const pct = this.paymentAppFeePercent(methodId);
    const g = Number(enteredGross) || 0;
    if (pct <= 0) {
      return Math.round(g * 100) / 100;
    }
    return Math.round((g / (1 + pct / 100)) * 100) / 100;
  }

  getPayMethodDef(id: string): CashierPaymentMethod | undefined {
    return this.paymentMethods.find((m) => m.id === id);
  }

  payMethodDisplayLabel(methodId: string): string {
    const m = this.paymentMethods.find((x) => x.id === methodId);
    return m?.label || methodId;
  }

  onSelectedPayMethodsChange(ids: string[] | null): void {
    const raw = Array.isArray(ids) ? ids.filter((x) => !!String(x || '').trim()) : [];
    if (!raw.length) {
      this.selectedPayMethods = ['cash'];
      this.reconcilePayAmountsKeys(['cash']);
      return;
    }
    this.reconcilePayAmountsKeys(raw);
  }

  private reconcilePayAmountsKeys(ids: string[]): void {
    const next: Record<string, number> = {};
    for (const id of ids) {
      next[id] = Number(this.payAmounts[id]) || 0;
    }
    this.payAmounts = next;
    this.selectedPayMethods = ids;
  }

  trackPayMethodId(_index: number, id: string): string {
    return id;
  }

  payMethodsOverflowTitle(items: readonly CashierPaymentMethod[] | null | undefined): string {
    if (!items?.length || items.length <= 2) {
      return '';
    }
    return items
      .slice(2)
      .map((row) => row?.label || '')
      .filter(Boolean)
      .join(', ');
  }

  paymentSplitsTotal(): number {
    const sum = this.selectedPayMethods.reduce(
      (acc, id) => acc + this.payAmountNetForInvoice(id, Number(this.payAmounts[id]) || 0),
      0
    );
    return Math.round(sum * 100) / 100;
  }

  paymentRemaining(): number {
    return Math.round((this.remaining - this.paymentSplitsTotal()) * 100) / 100;
  }

  paymentOverAllocated(): boolean {
    return this.paymentSplitsTotal() > this.remaining + 0.001;
  }

  private buildPaymentSplitsPayload(): { method: string; amount: number }[] | null {
    const splits = this.selectedPayMethods
      .map((id) => ({
        method: id,
        amount: this.payAmountNetForInvoice(id, Number(this.payAmounts[id]) || 0),
      }))
      .filter((s) => s.amount > 0);

    if (!splits.length) {
      this.notify.push(this.translate.instant('tr_order_payment_method_required'), 'error');
      return null;
    }
    if (this.paymentOverAllocated()) {
      this.notify.push(this.translate.instant('tr_vendor_deferred_payment_over'), 'error');
      return null;
    }
    if (this.paymentSplitsTotal() <= 0) {
      this.notify.push(this.translate.instant('tr_vendor_deferred_amount_required'), 'error');
      return null;
    }
    return splits;
  }

  submit(): void {
    if (this.saving) return;
    this.form.markAllAsTouched();
    if (!this.form.valid) return;

    const orderId = this.order._id;
    if (!orderId) return;

    const splits = this.buildPaymentSplitsPayload();
    if (!splits) return;

    const v = this.form.getRawValue();
    const paidAt = String(v.paidAt || '').trim();
    const note = String(v.note || '').trim();
    const u = this.auth.getUserFromLocalStorage();

    this.saving = true;
    this.orders
      .addPayment(String(orderId), {
        amount: this.paymentSplitsTotal(),
        paymentSplits: splits,
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
