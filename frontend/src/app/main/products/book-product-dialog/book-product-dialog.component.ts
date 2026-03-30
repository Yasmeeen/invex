import { Component, Inject, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { AuthenticationService } from '@core/services/authentication.service';
import { Product } from '@core/models/products.model';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { ProductBookingsService } from '@shared/services/product-bookings.service';

@Component({
  selector: 'app-book-product-dialog',
  templateUrl: './book-product-dialog.component.html',
  styleUrls: ['./book-product-dialog.component.scss'],
})
export class BookProductDialogComponent implements OnInit {
  form: FormGroup;
  saving = false;
  product: Product;
  readonly maxQuantity: number;

  constructor(
    private fb: FormBuilder,
    private dialogRef: MatDialogRef<BookProductDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public data: { product: Product; maxQuantity: number },
    private auth: AuthenticationService,
    private bookings: ProductBookingsService,
    private notify: AppNotificationService,
    private translate: TranslateService
  ) {
    this.product = data.product;
    this.maxQuantity = Math.max(1, Math.floor(Number(data.maxQuantity)) || 1);
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    this.form = this.fb.group({
      quantity: [
        1,
        [Validators.required, Validators.min(1), Validators.max(this.maxQuantity)],
      ],
      customerName: ['', Validators.required],
      customerPhone: ['', Validators.required],
      pickupType: ['branch_pickup', Validators.required],
      shippingAddress: [''],
      depositAmount: [0, [Validators.required, Validators.min(0)]],
      bookingDate: [`${y}-${m}-${d}`, Validators.required],
    });
  }

  ngOnInit(): void {
    this.form.get('pickupType')?.valueChanges.subscribe((v) => {
      const addr = this.form.get('shippingAddress');
      if (v === 'online_shipping') {
        addr?.setValidators([Validators.required]);
      } else {
        addr?.clearValidators();
        addr?.setValue('');
      }
      addr?.updateValueAndValidity({ emitEvent: false });
    });
  }

  close(): void {
    this.dialogRef.close(false);
  }

  submit(): void {
    if (this.saving) {
      return;
    }
    this.form.markAllAsTouched();

    const qCtrl = this.form.get('quantity');
    const rawQ = qCtrl?.value;
    const quantity = Math.floor(Number(rawQ));

    if (!Number.isFinite(quantity) || quantity < 1) {
      this.notify.push(this.translate.instant('tr_booking_quantity_invalid'), 'error');
      return;
    }
    if (quantity > this.maxQuantity) {
      qCtrl?.setErrors({ max: { max: this.maxQuantity, actual: quantity } });
      qCtrl?.markAsTouched();
      this.notify.push(
        this.translate.instant('tr_booking_quantity_too_high', { max: this.maxQuantity }),
        'error'
      );
      return;
    }

    if (this.form.invalid) {
      this.notify.push(this.translate.instant('tr_booking_form_invalid'), 'error');
      return;
    }

    const user = this.auth.getUserFromLocalStorage();
    const uid = user?._id;
    if (!uid) {
      this.notify.push(this.translate.instant('tr_unexpected_error_message'), 'error');
      return;
    }
    const v = this.form.getRawValue();
    this.saving = true;
    this.bookings
      .createBooking({
        productId: this.product._id,
        quantity,
        customerName: v.customerName.trim(),
        customerPhone: v.customerPhone.trim(),
        pickupType: v.pickupType,
        shippingAddress: v.pickupType === 'online_shipping' ? String(v.shippingAddress || '').trim() : '',
        depositAmount: Number(v.depositAmount),
        bookingDate: v.bookingDate,
        userId: uid,
      })
      .subscribe({
        next: () => {
          this.notify.push(this.translate.instant('tr_booking_created'), 'success');
          this.dialogRef.close(true);
        },
        error: (err) => {
          this.saving = false;
          const body = err?.error;
          const msg =
            (typeof body === 'string' ? body : null) ||
            body?.error ||
            body?.message ||
            (Array.isArray(body?.details) ? body.details.join(', ') : '') ||
            this.translate.instant('tr_booking_create_failed');
          this.notify.push(msg, 'error');
        },
      });
  }
}
