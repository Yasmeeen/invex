import { Component, Inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Vendor } from '@core/models/products.model';
import { AuthenticationService } from '@core/services/authentication.service';
import { TranslateService } from '@ngx-translate/core';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { VendorsSerivce } from '@shared/services/vendors.service';
import { PAYMENT_METHOD_OPTIONS } from '@shared/constants/payment-method-options';

export type VendorOpeningDebitDialogMode = 'set' | 'pay';

export type VendorOpeningDebitDialogData = {
  vendor: Vendor;
  mode: VendorOpeningDebitDialogMode;
  maxPayAmount?: number;
};

@Component({
  selector: 'app-vendor-opening-debit-dialog',
  templateUrl: './vendor-opening-debit-dialog.component.html',
  styleUrls: ['./vendor-opening-debit-dialog.component.scss'],
})
export class VendorOpeningDebitDialogComponent {
  saving = false;
  form: FormGroup;
  readonly mode: VendorOpeningDebitDialogMode;
  readonly vendor: Vendor;
  readonly maxPayAmount: number;

  readonly paymentMethods = PAYMENT_METHOD_OPTIONS.filter(
    (o) => o.id !== 'credit' && o.id !== 'mixed'
  );

  constructor(
    private fb: FormBuilder,
    private vendors: VendorsSerivce,
    private auth: AuthenticationService,
    private translate: TranslateService,
    private notify: AppNotificationService,
    private ref: MatDialogRef<VendorOpeningDebitDialogComponent>,
    @Inject(MAT_DIALOG_DATA) data: VendorOpeningDebitDialogData
  ) {
    this.mode = data.mode;
    this.vendor = data.vendor;
    this.maxPayAmount = Math.max(0, Number(data.maxPayAmount) || 0);

    this.form = this.fb.group({
      amount: ['', [Validators.required, Validators.min(0.01)]],
      method: ['cash'],
      note: [''],
    });

    if (this.mode === 'pay' && this.maxPayAmount > 0) {
      this.form.get('amount')?.addValidators(Validators.max(this.maxPayAmount));
    }
  }

  titleKey(): string {
    return this.mode === 'set'
      ? 'tr_vendor_opening_debit_set_title'
      : 'tr_vendor_opening_debit_pay_title';
  }

  submit(): void {
    if (this.form.invalid || this.saving) {
      this.form.markAllAsTouched();
      return;
    }

    const vendorId = this.vendor._id;
    if (!vendorId) return;

    const amount = Math.round((Number(this.form.value.amount) || 0) * 100) / 100;
    if (amount <= 0) {
      this.notify.push(this.translate.instant('tr_vendor_deferred_amount_required'), 'error');
      return;
    }

    const u = this.auth.getUserFromLocalStorage();
    const userId = u?._id;
    const note = String(this.form.value.note || '').trim();

    this.saving = true;

    if (this.mode === 'set') {
      this.vendors
        .setVendorOpeningDebitBalance(String(vendorId), { amount, note, userId })
        .subscribe({
          next: () => {
            this.saving = false;
            this.notify.push(
              this.translate.instant('tr_vendor_opening_debit_set_ok'),
              'success'
            );
            this.ref.close(true);
          },
          error: (err) => this.onError(err),
        });
      return;
    }

    this.vendors
      .payVendorOpeningDebitBalance(String(vendorId), {
        amount,
        method: String(this.form.value.method || 'cash'),
        note,
        userId,
      })
      .subscribe({
        next: () => {
          this.saving = false;
          this.notify.push(
            this.translate.instant('tr_vendor_opening_debit_pay_ok'),
            'success'
          );
          this.ref.close(true);
        },
        error: (err) => this.onError(err),
      });
  }

  private onError(err: { error?: { message?: string; error?: string } }): void {
    this.saving = false;
    const msg =
      err?.error?.message ||
      err?.error?.error ||
      this.translate.instant('tr_unexpected_error_message');
    this.notify.push(msg, 'error');
  }

  cancel(): void {
    this.ref.close(false);
  }
}
