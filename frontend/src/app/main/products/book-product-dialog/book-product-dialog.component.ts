import { Component, HostListener, Inject, OnDestroy, OnInit } from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  FormGroup,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { of, Subject } from 'rxjs';
import {
  catchError,
  debounceTime,
  distinctUntilChanged,
  finalize,
  map,
  switchMap,
  takeUntil,
} from 'rxjs/operators';
import { environment } from 'src/environments/environment';
import { AuthenticationService } from '@core/services/authentication.service';
import { Product } from '@core/models/products.model';
import { resolveActorBranchContext } from '@core/utils/branch-utils';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { CloudinaryUploadService } from '@shared/services/cloudinary-upload.service';
import { OrdersSerivce } from '@shared/services/orders.service';
import { ProductBookingsService } from '@shared/services/product-bookings.service';
import { InvoiceReprintService } from '@shared/services/invoice-reprint.service';
import {
  PaymentSplitsDialogComponent,
  PaymentSplitsDialogData,
} from '@shared/components/payment-splits-dialog/payment-splits-dialog.component';
import {
  PaymentSplitsResult,
  paymentSplitsNetTotal,
} from '@shared/utils/payment-app-fee.util';
import { BookingReceiptData } from '@shared/components/booking-receipt-print/booking-receipt-print.component';

@Component({
  selector: 'app-book-product-dialog',
  templateUrl: './book-product-dialog.component.html',
  styleUrls: ['./book-product-dialog.component.scss'],
})
export class BookProductDialogComponent implements OnInit, OnDestroy {
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

  confirmedPayment: PaymentSplitsResult | null = null;
  printBookingReceipt = true;

  /** True when GET /clients/by-phone returned a client. */
  isExistingClient = false;
  clientLookupLoading = false;
  private lastNotifiedClientId: string | null = null;
  private readonly destroy$ = new Subject<void>();

  constructor(
    private fb: FormBuilder,
    private dialogRef: MatDialogRef<BookProductDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public data: { product: Product; maxQuantity: number },
    private auth: AuthenticationService,
    private cloudinaryUpload: CloudinaryUploadService,
    private bookings: ProductBookingsService,
    private orders: OrdersSerivce,
    private notify: AppNotificationService,
    private translate: TranslateService,
    private dialog: MatDialog,
    private invoiceReprint: InvoiceReprintService
  ) {
    this.product = data.product;
    this.maxQuantity = Math.max(1, Math.floor(Number(data.maxQuantity)) || 1);
    this.form = this.fb.group({
      quantity: [
        1,
        [Validators.required, Validators.min(1), Validators.max(this.maxQuantity)],
      ],
      customerPhone: ['', [Validators.required, this.phoneFormatValidator]],
      customerName: ['', Validators.required],
      registeredAddress: [''],
      pickupType: ['branch_pickup', Validators.required],
      shippingAddress: [''],
      transferReferencePhone: [''],
    });
  }

  ngOnInit(): void {
    this.form
      .get('pickupType')
      ?.valueChanges.subscribe((v) => {
        const addr = this.form.get('shippingAddress');
        if (v === 'online_shipping') {
          addr?.setValidators([Validators.required]);
        } else {
          addr?.clearValidators();
          addr?.setValue('');
        }
        addr?.updateValueAndValidity({ emitEvent: false });
      });

    const phoneControl = this.form.get('customerPhone');
    const nameControl = this.form.get('customerName');
    const regAddrControl = this.form.get('registeredAddress');

    phoneControl?.valueChanges
      .pipe(
        map((p: string) => String(p ?? '').trim()),
        debounceTime(400),
        distinctUntilChanged(),
        takeUntil(this.destroy$),
        switchMap((phone: string) => {
          if (!phone) {
            this.resetClientLookupUi();
            return of(null);
          }
          this.clientLookupLoading = true;
          return this.orders.getClientByPhone(phone).pipe(
            catchError(() => {
              this.isExistingClient = false;
              this.lastNotifiedClientId = null;
              nameControl?.enable({ emitEvent: false });
              regAddrControl?.enable({ emitEvent: false });
              regAddrControl?.setValidators([Validators.required]);
              regAddrControl?.updateValueAndValidity({ emitEvent: false });
              nameControl?.setValue('', { emitEvent: false });
              regAddrControl?.setValue('', { emitEvent: false });
              return of(null);
            }),
            finalize(() => {
              this.clientLookupLoading = false;
            })
          );
        })
      )
      .subscribe((client: any) => {
        if (client) {
          const dedupeKey =
            client._id != null
              ? String(client._id)
              : String(client.phoneNumber || '');
          if (dedupeKey && dedupeKey !== this.lastNotifiedClientId) {
            this.lastNotifiedClientId = dedupeKey;
            this.translate
              .get('tr_cashier_client_registered')
              .subscribe((msg) => this.notify.push(msg, 'success'));
          }

          this.isExistingClient = true;
          nameControl?.setValue(client.name || '', { emitEvent: false });
          regAddrControl?.setValue(client.address || '', { emitEvent: false });
          nameControl?.disable({ emitEvent: false });
          regAddrControl?.disable({ emitEvent: false });
          regAddrControl?.clearValidators();
          regAddrControl?.updateValueAndValidity({ emitEvent: false });
        }
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private resetClientLookupUi(): void {
    this.lastNotifiedClientId = null;
    this.isExistingClient = false;
    const nameControl = this.form.get('customerName');
    const regAddrControl = this.form.get('registeredAddress');
    nameControl?.enable({ emitEvent: false });
    regAddrControl?.enable({ emitEvent: false });
    regAddrControl?.clearValidators();
    nameControl?.setValue('', { emitEvent: false });
    regAddrControl?.setValue('', { emitEvent: false });
    regAddrControl?.updateValueAndValidity({ emitEvent: false });
  }

  /**
   * Phone format: digits only (optional leading '+'), length 7..15.
   * Spaces, hyphens, and parentheses are ignored.
   */
  private phoneFormatValidator(control: AbstractControl): ValidationErrors | null {
    const raw = String(control.value ?? '').trim();
    if (!raw) {
      return null;
    }
    const normalized = raw.replace(/[\s\-()]/g, '');
    const ok = /^\+?\d{7,15}$/.test(normalized);
    return ok ? null : { phoneFormat: true };
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

  depositSummaryText(): string {
    if (!this.confirmedPayment) {
      return '';
    }
    const methods = this.confirmedPayment.paymentSplits.filter((s) => s.amount > 0).length;
    const total = paymentSplitsNetTotal(this.confirmedPayment.paymentSplits);
    return this.translate.instant('tr_payment_splits_summary', { count: methods, total });
  }

  openPaymentSplitsDialog(): void {
    const data: PaymentSplitsDialogData = {
      invoiceNetTotal: 0,
      mode: 'deposit',
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

  private hasNonCashDeposit(): boolean {
    const splits = this.confirmedPayment?.paymentSplits || [];
    return splits.some(
      (s) => s.amount > 0 && String(s.method || '').trim().toLowerCase() !== 'cash'
    );
  }

  submit(): void {
    if (this.saving || this.isUploadingDepositProof || this.clientLookupLoading) {
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

    const splits = (this.confirmedPayment?.paymentSplits || []).filter((s) => s.amount > 0);
    const depositAmount = splits.length ? paymentSplitsNetTotal(splits) : 0;
    if (depositAmount < 0) {
      this.notify.push(this.translate.instant('tr_booking_api_valid_deposit_required'), 'error');
      return;
    }

    const user = this.auth.getUserFromLocalStorage();
    const uid = user?._id;
    if (!uid) {
      this.notify.push(this.translate.instant('tr_unexpected_error_message'), 'error');
      return;
    }
    const v = this.form.getRawValue();
    const regAddr = String(v.registeredAddress || '').trim();
    const shipAddr = String(v.shippingAddress || '').trim();

    if (!this.isExistingClient && !regAddr) {
      this.notify.push(this.translate.instant('tr_booking_registered_address_required'), 'error');
      return;
    }

    if (
      v.pickupType === 'online_shipping' &&
      regAddr &&
      shipAddr &&
      regAddr === shipAddr
    ) {
      this.notify.push(
        this.translate.instant('tr_booking_shipping_must_differ_from_registered'),
        'error'
      );
      return;
    }

    const refPhone = String(v.transferReferencePhone || '').trim();
    const needsRef = this.hasNonCashDeposit() || this.depositProofUrls.length > 0;
    if (needsRef && !refPhone) {
      this.notify.push(this.translate.instant('tr_booking_transfer_reference_required'), 'error');
      return;
    }

    const productBranch = this.product.branch as { _id?: string } | string | null | undefined;
    const forcedBranchId =
      typeof productBranch === 'object' && productBranch
        ? productBranch._id
        : productBranch
          ? String(productBranch)
          : null;
    const branchCtx = resolveActorBranchContext(user, forcedBranchId);

    this.saving = true;
    const urls = [...this.depositProofUrls];
    this.bookings
      .createBooking({
        productId: this.product._id,
        quantity,
        customerName: v.customerName.trim(),
        customerPhone: v.customerPhone.trim(),
        registeredAddress: regAddr,
        pickupType: v.pickupType,
        shippingAddress: v.pickupType === 'online_shipping' ? shipAddr : '',
        depositAmount,
        paymentSplits: splits.length ? splits : undefined,
        paymentFeeAllocations: this.confirmedPayment?.feeAllocations?.length
          ? this.confirmedPayment.feeAllocations
          : undefined,
        depositTransferImageUrls: urls.length ? urls : undefined,
        depositTransferImageUrl: urls.length === 1 ? urls[0] : undefined,
        transferReferencePhone: refPhone,
        userId: uid,
        branchId: branchCtx.branchId || undefined,
      })
      .subscribe({
        next: (res) => {
          this.notify.push(this.translate.instant('tr_booking_created'), 'success');
          if (this.printBookingReceipt) {
            this.printCreatedBookingReceipt(res?.booking, quantity, depositAmount, splits, v);
          }
          this.dialogRef.close(true);
        },
        error: (err) => {
          this.saving = false;
          const body = err?.error;
          let raw = '';
          if (typeof body === 'string') {
            raw = body;
          } else if (body?.error) {
            raw = String(body.error);
          } else if (body?.message) {
            raw = String(body.message);
          } else if (Array.isArray(body?.details)) {
            raw = body.details.join(', ');
          }
          const msg =
            this.translateBookingCreateApiError(raw) ||
            this.translate.instant('tr_booking_create_failed');
          this.notify.push(msg, 'error');
        },
      });
  }

  private printCreatedBookingReceipt(
    booking: any,
    quantity: number,
    depositAmount: number,
    splits: Array<{ method: string; amount: number }>,
    formValue: any
  ): void {
    const unitPrice =
      Number(booking?.productUnitPrice) ||
      Number(this.product.price) ||
      0;
    const receipt: BookingReceiptData = {
      _id: booking?._id,
      customerName: booking?.customerName || formValue.customerName,
      customerPhone: booking?.customerPhone || formValue.customerPhone,
      productName: booking?.productNameSnapshot || this.product.name,
      productCode: booking?.productCodeSnapshot || this.product.code,
      quantity: Number(booking?.quantity) || quantity,
      unitPrice,
      depositAmount: Number(booking?.depositAmount) || depositAmount,
      depositPayments: Array.isArray(booking?.depositPayments)
        ? booking.depositPayments
        : splits,
      pickupType: booking?.pickupType || formValue.pickupType,
      shippingAddress: booking?.shippingAddress || formValue.shippingAddress,
      createdAt: booking?.createdAt || booking?.bookingDate,
      bookingDate: booking?.bookingDate,
    };
    this.invoiceReprint.printBooking(receipt);
  }

  /** Map backend booking POST error strings to i18n (API always returns English). */
  private translateBookingCreateApiError(raw: string): string {
    const s = String(raw || '').trim();
    if (!s) {
      return '';
    }
    const exact: Record<string, string> = {
      'Invalid transfer reference phone': 'tr_booking_api_invalid_transfer_reference_phone',
      'Transfer reference phone is required when deposit or transfer proof is provided':
        'tr_booking_transfer_reference_required',
      'Transfer reference phone is required when non-cash deposit or transfer proof is provided':
        'tr_booking_transfer_reference_required',
      'Shipping address must differ from the registered customer address':
        'tr_booking_shipping_must_differ_from_registered',
      'Registered address is required for new customers': 'tr_booking_registered_address_required',
      'Invalid phone number': 'tr_client_phone_invalid',
      'Phone number already registered': 'tr_booking_api_phone_already_registered',
      'Customer phone is required': 'tr_client_phone_required',
      'Customer name is required': 'tr_booking_api_customer_name_required',
      'Invalid pickup type': 'tr_booking_api_invalid_pickup_type',
      'Shipping address is required for online shipping': 'tr_booking_api_shipping_required_online',
      'Valid deposit amount is required': 'tr_booking_api_valid_deposit_required',
      'Invalid deposit transfer image URL': 'tr_booking_api_invalid_deposit_image_url',
      'Invalid deposit transfer image URL(s)': 'tr_booking_api_invalid_deposit_image_urls',
      'Valid productId is required': 'tr_booking_api_invalid_product_id',
      'userId is required': 'tr_booking_api_user_required',
      'Product not found': 'tr_booking_api_product_not_found',
    };
    const key = exact[s];
    if (key) {
      return this.translate.instant(key);
    }
    const units = /^Only (\d+) unit\(s\) available to book$/.exec(s);
    if (units) {
      return this.translate.instant('tr_booking_api_only_n_units_available', { n: units[1] });
    }
    const maxImg = /^At most (\d+) deposit images allowed$/.exec(s);
    if (maxImg) {
      return this.translate.instant('tr_booking_api_max_deposit_images', { max: maxImg[1] });
    }
    return s;
  }
}
