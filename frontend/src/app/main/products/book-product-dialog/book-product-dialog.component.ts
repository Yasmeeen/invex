import { Component, HostListener, Inject, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { environment } from 'src/environments/environment';
import { AuthenticationService } from '@core/services/authentication.service';
import { Product } from '@core/models/products.model';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { CloudinaryUploadService } from '@shared/services/cloudinary-upload.service';
import { ProductBookingsService } from '@shared/services/product-bookings.service';

@Component({
  selector: 'app-book-product-dialog',
  templateUrl: './book-product-dialog.component.html',
  styleUrls: ['./book-product-dialog.component.scss'],
})
export class BookProductDialogComponent implements OnInit {
  form: FormGroup;
  saving = false;
  isUploadingDepositProof = false;
  readonly maxImageBytes = 5 * 1024 * 1024;
  readonly depositProofFolder = 'booking-deposits';
  readonly maxDepositProofImages = 10;
  /** Uploaded proof URLs (multiple). */
  depositProofUrls: string[] = [];
  /** Full-screen preview URL (lightbox). */
  depositPreviewUrl: string | null = null;
  product: Product;
  readonly maxQuantity: number;
  readonly pickupTypeOptions: Array<{ id: string; labelKey: string }> = [
    { id: 'branch_pickup', labelKey: 'tr_booking_branch_pickup' },
    { id: 'online_shipping', labelKey: 'tr_booking_online_shipping' },
  ];

  constructor(
    private fb: FormBuilder,
    private dialogRef: MatDialogRef<BookProductDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public data: { product: Product; maxQuantity: number },
    private auth: AuthenticationService,
    private cloudinaryUpload: CloudinaryUploadService,
    private bookings: ProductBookingsService,
    private notify: AppNotificationService,
    private translate: TranslateService
  ) {
    this.product = data.product;
    this.maxQuantity = Math.max(1, Math.floor(Number(data.maxQuantity)) || 1);
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
      transferReferencePhone: [''],
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

  @HostListener('document:keydown.escape', ['$event'])
  onEscape(event?: KeyboardEvent): void {
    if (this.depositPreviewUrl) {
      event?.preventDefault?.();
      this.closeDepositPreview();
    }
  }

  close(): void {
    this.closeDepositPreview();
    this.dialogRef.close(false);
  }

  openDepositPreview(url: string): void {
    const u = String(url || '').trim();
    this.depositPreviewUrl = u || null;
  }

  closeDepositPreview(): void {
    this.depositPreviewUrl = null;
  }

  isCloudinaryConfigured(): boolean {
    return !!environment.cloudinary?.cloudName;
  }

  onDepositProofSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }
    if (this.depositProofUrls.length >= this.maxDepositProofImages) {
      this.notify.push(this.translate.instant('tr_booking_deposit_proof_max_images'), 'error');
      input.value = '';
      return;
    }
    if (!file.type.startsWith('image/')) {
      this.notify.push(this.translate.instant('tr_product_image_invalid_type'), 'error');
      input.value = '';
      return;
    }
    if (file.size > this.maxImageBytes) {
      this.notify.push(this.translate.instant('tr_product_image_too_large'), 'error');
      input.value = '';
      return;
    }
    if (!this.isCloudinaryConfigured()) {
      this.notify.push(this.translate.instant('tr_cloudinary_not_configured'), 'error');
      input.value = '';
      return;
    }
    this.isUploadingDepositProof = true;
    this.cloudinaryUpload.uploadProductImage(file, this.depositProofFolder).subscribe({
      next: (url) => {
        this.isUploadingDepositProof = false;
        if (url) {
          this.depositProofUrls = [...this.depositProofUrls, url];
          this.notify.push(this.translate.instant('tr_booking_deposit_proof_upload_ok'), 'success');
        }
        input.value = '';
      },
      error: () => {
        this.isUploadingDepositProof = false;
        this.notify.push(this.translate.instant('tr_product_image_upload_failed'), 'error');
        input.value = '';
      },
    });
  }

  removeDepositProofAt(index: number): void {
    const removed = this.depositProofUrls[index];
    if (removed && this.depositPreviewUrl === removed) {
      this.depositPreviewUrl = null;
    }
    this.depositProofUrls = this.depositProofUrls.filter((_, i) => i !== index);
  }

  clearDepositProofs(): void {
    this.depositProofUrls = [];
    this.depositPreviewUrl = null;
  }

  submit(): void {
    if (this.saving || this.isUploadingDepositProof) {
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
    const dep = Number(v.depositAmount);
    const refPhone = String(v.transferReferencePhone || '').trim();
    const needsRef = dep > 0 || this.depositProofUrls.length > 0;
    if (needsRef && !refPhone) {
      this.notify.push(this.translate.instant('tr_booking_transfer_reference_required'), 'error');
      return;
    }
    this.saving = true;
    const urls = [...this.depositProofUrls];
    this.bookings
      .createBooking({
        productId: this.product._id,
        quantity,
        customerName: v.customerName.trim(),
        customerPhone: v.customerPhone.trim(),
        pickupType: v.pickupType,
        shippingAddress: v.pickupType === 'online_shipping' ? String(v.shippingAddress || '').trim() : '',
        depositAmount: Number(v.depositAmount),
        depositTransferImageUrls: urls.length ? urls : undefined,
        depositTransferImageUrl: urls.length === 1 ? urls[0] : undefined,
        transferReferencePhone: refPhone,
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
