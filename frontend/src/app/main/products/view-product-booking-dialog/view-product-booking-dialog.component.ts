import { Component, HostListener, Inject, OnInit } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { AuthenticationService } from '@core/services/authentication.service';
import { Product, ProductActiveBooking } from '@core/models/products.model';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { ProductBookingsService, ProductBookingsSummary } from '@shared/services/product-bookings.service';
import { ConfirmationDialogComponent } from '@shared/components/confirmation-dialog/confirmation-dialog.component';
import { canPickBranchRole, isBranchManager, isModerator } from '@core/utils/role-utils';
import { BookProductDialogComponent } from '../book-product-dialog/book-product-dialog.component';
import { InvoiceReprintService } from '@shared/services/invoice-reprint.service';
import { BookingReceiptData } from '@shared/components/booking-receipt-print/booking-receipt-print.component';
import { paymentMethodDisplayLabel } from '@shared/utils/cashier-payment-methods.util';
import { StoreSettingsService } from '@shared/services/store-settings.service';

@Component({
  selector: 'app-view-product-booking-dialog',
  templateUrl: './view-product-booking-dialog.component.html',
  styleUrls: ['./view-product-booking-dialog.component.scss'],
})
export class ViewProductBookingDialogComponent implements OnInit {
  product: Product;
  /** Whether user may book on this product (branch / role); still needs summary.availableToBook > 0. */
  canAddBooking = false;

  loading = true;
  loadError = false;
  bookings: ProductActiveBooking[] = [];
  summary: ProductBookingsSummary | null = null;

  cancellingId: string | null = null;
  confirmingId: string | null = null;
  private refreshParent = false;
  /** Lightbox URL for deposit proof preview. */
  depositPreviewUrl: string | null = null;

  constructor(
    private dialogRef: MatDialogRef<ViewProductBookingDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public data: { product: Product; canAddBooking?: boolean },
    private dialog: MatDialog,
    private auth: AuthenticationService,
    private bookingsApi: ProductBookingsService,
    private notify: AppNotificationService,
    private translate: TranslateService,
    private invoiceReprint: InvoiceReprintService,
    private storeSettings: StoreSettingsService
  ) {
    this.product = data.product;
    this.canAddBooking = !!data.canAddBooking;
  }

  ngOnInit(): void {
    this.reload();
  }

  reload(): void {
    const user = this.auth.getUserFromLocalStorage();
    const uid = user?._id;
    if (!uid) {
      this.loading = false;
      this.loadError = true;
      return;
    }
    this.loading = true;
    this.loadError = false;
    this.bookingsApi.getForProduct(this.product._id, uid).subscribe({
      next: (res) => {
        this.bookings = (res.bookings || []).map((b: ProductActiveBooking) => {
          const row = b as ProductActiveBooking & {
            deposit_transfer_image_url?: string;
            deposit_transfer_image_urls?: string[];
            transfer_reference_phone?: string;
          };
          const single =
            row.depositTransferImageUrl ??
            (typeof row.deposit_transfer_image_url === 'string' ? row.deposit_transfer_image_url : '');
          const urlsFromApi = row.depositTransferImageUrls ?? row.deposit_transfer_image_urls;
          const urls = Array.isArray(urlsFromApi)
            ? urlsFromApi.map((x) => String(x || '').trim()).filter(Boolean)
            : [];
          const merged = urls.length
            ? urls
            : String(single || '').trim()
              ? [String(single).trim()]
              : [];
          const transferRef =
            row.transferReferencePhone ?? row.transfer_reference_phone ?? '';
          return {
            ...b,
            depositTransferImageUrls: merged.length ? merged : undefined,
            depositTransferImageUrl: merged[0] || undefined,
            transferReferencePhone: String(transferRef || '').trim() || undefined,
          };
        });
        this.summary = res.summary;
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.loadError = true;
        this.notify.push(this.translate.instant('tr_unexpected_error_message'), 'error');
      },
    });
  }

  get showAddBooking(): boolean {
    return this.canAddBooking && (this.summary?.availableToBook ?? 0) > 0;
  }

  @HostListener('document:keydown.escape', ['$event'])
  onEscape(event?: KeyboardEvent): void {
    if (this.depositPreviewUrl) {
      event?.preventDefault?.();
      this.closeDepositPreview();
    }
  }

  openDepositPreview(url: string): void {
    const u = String(url || '').trim();
    this.depositPreviewUrl = u || null;
  }

  closeDepositPreview(): void {
    this.depositPreviewUrl = null;
  }

  close(): void {
    this.closeDepositPreview();
    this.dialogRef.close(this.refreshParent);
  }

  pickupLabel(b: ProductActiveBooking): string {
    return b.pickupType === 'online_shipping'
      ? this.translate.instant('tr_booking_online_shipping')
      : this.translate.instant('tr_booking_branch_pickup');
  }

  depositPaymentLabel(method: string | undefined | null): string {
    return paymentMethodDisplayLabel(
      method,
      this.storeSettings.snapshot.paymentAppFeePercents,
      this.translate
    );
  }

  depositPaymentLines(b: ProductActiveBooking): Array<{ method: string; amount: number }> {
    const list = b.depositPayments;
    if (Array.isArray(list) && list.length) {
      return list
        .map((p) => ({
          method: String(p?.method || '').trim(),
          amount: Math.round((Number(p?.amount) || 0) * 100) / 100,
        }))
        .filter((p) => p.method && p.amount > 0);
    }
    const dep = Number(b.depositAmount) || 0;
    return dep > 0 ? [{ method: 'cash', amount: dep }] : [];
  }

  bookingRemaining(b: ProductActiveBooking): number {
    const qty = Math.max(1, Math.floor(Number(b.quantity) || 1));
    const unit =
      Number(b.productUnitPrice) >= 0 && b.productUnitPrice != null
        ? Number(b.productUnitPrice)
        : Number(this.product.price) || 0;
    const total = Math.round(unit * qty * 100) / 100;
    const dep = Math.round((Number(b.depositAmount) || 0) * 100) / 100;
    return Math.round(Math.max(0, total - dep) * 100) / 100;
  }

  printBookingReceipt(b: ProductActiveBooking): void {
    const qty = Math.max(1, Math.floor(Number(b.quantity) || 1));
    const unit =
      Number(b.productUnitPrice) >= 0 && b.productUnitPrice != null
        ? Number(b.productUnitPrice)
        : Number(this.product.price) || 0;
    const receipt: BookingReceiptData = {
      _id: b._id,
      customerName: b.customerName,
      customerPhone: b.customerPhone,
      productName: b.productNameSnapshot || this.product.name,
      productCode: b.productCodeSnapshot || this.product.code,
      quantity: qty,
      unitPrice: unit,
      depositAmount: Number(b.depositAmount) || 0,
      depositPayments: this.depositPaymentLines(b),
      pickupType: b.pickupType,
      shippingAddress: b.shippingAddress,
      createdAt: b.createdAt,
      bookingDate: b.bookingDate,
    };
    this.invoiceReprint.printBooking(receipt);
  }

  /** Deposit transfer proof URLs (one or many). */
  depositProofUrls(b: ProductActiveBooking): string[] {
    const fromArr = b.depositTransferImageUrls;
    if (Array.isArray(fromArr) && fromArr.length) {
      return fromArr.map((u) => String(u || '').trim()).filter(Boolean);
    }
    const u = String(b.depositTransferImageUrl || '').trim();
    return u ? [u] : [];
  }

  /** @deprecated Use depositProofUrls; kept for any legacy template refs. */
  depositProofUrl(b: ProductActiveBooking): string {
    const urls = this.depositProofUrls(b);
    return urls[0] || '';
  }

  canCancel(booking: ProductActiveBooking): boolean {
    const u = this.auth.getUserFromLocalStorage();
    if (!u?._id) {
      return false;
    }
    if (isModerator(u.role)) {
      return false;
    }
    if (canPickBranchRole(u.role)) {
      return true;
    }
    const creatorId =
      typeof booking.createdBy === 'object' ? booking.createdBy?._id : booking.createdBy;
    return !!creatorId && String(creatorId) === String(u._id);
  }

  /** Active bookings exceed current product stock (e.g. after sales); confirmations must be blocked. */
  get bookingExceedsStock(): boolean {
    if (!this.summary) {
      return false;
    }
    const booked = Number(this.summary.totalBookedQty) || 0;
    const stock = Number(this.summary.stock) || 0;
    return booked > stock;
  }

  /**
   * Super Admin / Co Admin: any active unconfirmed booking.
   * Branch Manager: same branch only, not central warehouse stock.
   */
  canConfirm(booking: ProductActiveBooking): boolean {
    if (this.bookingExceedsStock) {
      return false;
    }
    if (booking.confirmed || booking.status === 'cancelled') {
      return false;
    }
    const u = this.auth.getUserFromLocalStorage();
    if (!u?._id) {
      return false;
    }
    if (canPickBranchRole(u.role)) {
      return true;
    }
    if (!isBranchManager(u.role)) {
      return false;
    }
    if (this.product.inWarehouse) {
      return false;
    }
    const pb = this.product.branch as { _id?: string } | string | undefined;
    const pid = typeof pb === 'object' && pb ? String(pb._id) : pb ? String(pb) : '';
    const ub = u.branch as { _id?: string } | string | undefined;
    const uid = typeof ub === 'object' && ub ? String(ub._id) : ub ? String(ub) : '';
    return !!pid && !!uid && pid === uid;
  }

  openNewBooking(): void {
    this.closeDepositPreview();
    const max = this.summary?.availableToBook ?? 0;
    if (max < 1) {
      return;
    }
    this.dialog
      .open(BookProductDialogComponent, {
        width: '640px',
        data: { product: this.product, maxQuantity: max },
        disableClose: true,
      })
      .afterClosed()
      .subscribe((ok) => {
        if (ok) {
          this.refreshParent = true;
          this.reload();
        }
      });
  }

  confirmCancel(booking: ProductActiveBooking): void {
    const confirmationData = {
      title: this.translate.instant('tr_confirmation_message'),
      buttons: [
        {
          label: this.translate.instant('tr_action.cancel'),
          actionCallback: 'cancel',
          type: 'btn-secondary',
        },
        {
          label: this.translate.instant('tr_product_cancel_booking'),
          actionCallback: 'confirm',
          type: 'btn-danger',
        },
      ],
    };
    this.dialog
      .open(ConfirmationDialogComponent, {
        width: '450px',
        data: confirmationData,
        disableClose: true,
      })
      .afterClosed()
      .subscribe((result) => {
        if (result === 'confirm') {
          this.doCancel(booking._id);
        }
      });
  }

  confirmBooking(b: ProductActiveBooking): void {
    const confirmationData = {
      title: this.translate.instant('tr_booking_confirm_dialog_title'),
      buttons: [
        {
          label: this.translate.instant('tr_action.cancel'),
          actionCallback: 'cancel',
          type: 'btn-secondary',
        },
        {
          label: this.translate.instant('tr_booking_confirm_action'),
          actionCallback: 'confirm',
          type: 'btn-primary',
        },
      ],
    };
    this.dialog
      .open(ConfirmationDialogComponent, {
        width: '450px',
        data: confirmationData,
        disableClose: true,
      })
      .afterClosed()
      .subscribe((result) => {
        if (result === 'confirm') {
          this.doConfirm(b._id);
        }
      });
  }

  private doConfirm(bookingId: string): void {
    const user = this.auth.getUserFromLocalStorage();
    const uid = user?._id;
    if (!uid) {
      this.notify.push(this.translate.instant('tr_unexpected_error_message'), 'error');
      return;
    }
    this.confirmingId = bookingId;
    this.bookingsApi.confirmBooking(bookingId, { userId: uid }).subscribe({
      next: () => {
        this.confirmingId = null;
        this.refreshParent = true;
        this.notify.push(this.translate.instant('tr_booking_confirmed_toast'), 'success');
        this.reload();
      },
      error: (err) => {
        this.confirmingId = null;
        const code = err?.error?.code;
        const msg =
          code === 'INSUFFICIENT_STOCK_FOR_BOOKING'
            ? this.translate.instant('tr_booking_confirm_out_of_stock')
            : err?.error?.error || this.translate.instant('tr_booking_confirm_failed');
        this.notify.push(msg, 'error');
      },
    });
  }

  private doCancel(bookingId: string): void {
    const user = this.auth.getUserFromLocalStorage();
    const uid = user?._id;
    if (!uid) {
      this.notify.push(this.translate.instant('tr_unexpected_error_message'), 'error');
      return;
    }
    this.cancellingId = bookingId;
    this.bookingsApi.cancelBooking(bookingId, { userId: uid }).subscribe({
      next: () => {
        this.cancellingId = null;
        this.refreshParent = true;
        this.notify.push(this.translate.instant('tr_booking_cancelled'), 'success');
        this.reload();
      },
      error: (err) => {
        this.cancellingId = null;
        const msg =
          err?.error?.error || this.translate.instant('tr_booking_cancel_failed');
        this.notify.push(msg, 'error');
      },
    });
  }
}
