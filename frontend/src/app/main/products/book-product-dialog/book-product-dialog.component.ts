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

  constructor(
    private fb: FormBuilder,
    private dialogRef: MatDialogRef<BookProductDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public data: { product: Product },
    private auth: AuthenticationService,
    private bookings: ProductBookingsService,
    private notify: AppNotificationService,
    private translate: TranslateService
  ) {
    this.product = data.product;
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    this.form = this.fb.group({
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
    if (this.form.invalid || this.saving) {
      this.form.markAllAsTouched();
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
          const msg = err?.error?.error || this.translate.instant('tr_booking_create_failed');
          this.notify.push(msg, 'error');
        },
      });
  }
}
