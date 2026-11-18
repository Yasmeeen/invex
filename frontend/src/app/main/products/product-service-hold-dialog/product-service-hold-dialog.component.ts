import { Component, Inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { Product } from '@core/models/products.model';
import { AuthenticationService } from '@core/services/authentication.service';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { ProductsSerivce } from '@shared/services/products.service';

@Component({
  selector: 'app-product-service-hold-dialog',
  templateUrl: './product-service-hold-dialog.component.html',
  styleUrls: ['./product-service-hold-dialog.component.scss'],
})
export class ProductServiceHoldDialogComponent {
  form: FormGroup;
  saving = false;
  releasing = false;
  product: Product;
  maxQuantity: number;

  constructor(
    private fb: FormBuilder,
    private dialogRef: MatDialogRef<ProductServiceHoldDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA)
    public data: { product: Product; maxQuantity: number },
    private auth: AuthenticationService,
    private products: ProductsSerivce,
    private notify: AppNotificationService,
    private translate: TranslateService
  ) {
    this.product = data.product;
    this.maxQuantity = Math.max(0, Number(data.maxQuantity) || 0);
    const current = Math.max(0, Number(this.product.serviceHoldQuantity) || 0);
    const initialQty = current > 0 ? Math.min(current, this.maxQuantity || current) : this.maxQuantity;
    this.form = this.fb.group({
      reason: [this.initialReason(), [Validators.required, Validators.maxLength(200)]],
      note: [this.product.serviceHoldNote || ''],
      quantity: [initialQty > 0 ? initialQty : 1, [Validators.required, Validators.min(0.001)]],
    });
  }

  private initialReason(): string {
    const raw = String(this.product.serviceHoldReason || '').trim();
    if (raw === 'maintenance') return this.translate.instant('tr_product_hold_maintenance');
    if (raw === 'at_agent') return this.translate.instant('tr_product_hold_agent');
    return raw;
  }

  get alreadyHeld(): boolean {
    return Math.max(0, Number(this.product.serviceHoldQuantity) || 0) > 0;
  }

  get showQuantity(): boolean {
    return this.maxQuantity > 1;
  }

  close(): void {
    this.dialogRef.close(false);
  }

  private userId(): string {
    const user = this.auth.getUserFromLocalStorage();
    return user?._id != null ? String(user._id) : '';
  }

  private fail(error: any): void {
    const code = error?.error?.code;
    const key =
      code === 'SERVICE_HOLD_NO_FREE_UNITS'
        ? 'tr_product_hold_none_free'
        : code === 'HOLD_REASON_REQUIRED'
          ? 'tr_product_hold_reason_required'
          : code === 'FORBIDDEN'
            ? 'tr_product_only_own_branch'
            : '';
    this.notify.push(
      key ? this.translate.instant(key) : error?.error?.error || this.translate.instant('tr_unexpected_error_message'),
      'error'
    );
  }

  submit(): void {
    if (this.form.invalid || this.saving || this.releasing) {
      this.form.markAllAsTouched();
      return;
    }
    const uid = this.userId();
    if (!uid) {
      this.notify.push(this.translate.instant('tr_unexpected_error_message'), 'error');
      return;
    }
    const reason = String(this.form.value.reason || '').trim();
    if (!reason) {
      this.form.get('reason')?.setErrors({ required: true });
      this.notify.push(this.translate.instant('tr_product_hold_reason_required'), 'error');
      return;
    }
    const quantity = this.showQuantity ? Number(this.form.value.quantity) : this.maxQuantity || 1;
    if (quantity > this.maxQuantity + 0.0001) {
      this.notify.push(this.translate.instant('tr_product_hold_none_free'), 'error');
      return;
    }
    this.saving = true;
    this.products
      .setProductServiceHold(this.product._id, {
        userId: uid,
        active: true,
        reason,
        note: String(this.form.value.note || '').trim(),
        quantity,
      })
      .subscribe({
        next: () => {
          this.saving = false;
          this.notify.push(this.translate.instant('tr_product_hold_saved'), 'success');
          this.dialogRef.close(true);
        },
        error: (error) => {
          this.saving = false;
          this.fail(error);
        },
      });
  }

  release(): void {
    if (this.saving || this.releasing) return;
    const uid = this.userId();
    if (!uid) {
      this.notify.push(this.translate.instant('tr_unexpected_error_message'), 'error');
      return;
    }
    this.releasing = true;
    this.products
      .setProductServiceHold(this.product._id, { userId: uid, active: false })
      .subscribe({
        next: () => {
          this.releasing = false;
          this.notify.push(this.translate.instant('tr_product_hold_released'), 'success');
          this.dialogRef.close(true);
        },
        error: (error) => {
          this.releasing = false;
          this.fail(error);
        },
      });
  }
}
