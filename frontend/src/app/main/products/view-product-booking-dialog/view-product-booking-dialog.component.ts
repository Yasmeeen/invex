import { Component, Inject, OnInit } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { AuthenticationService } from '@core/services/authentication.service';
import { Product, ProductActiveBooking } from '@core/models/products.model';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { ProductBookingsService, ProductBookingsSummary } from '@shared/services/product-bookings.service';
import { ConfirmationDialogComponent } from '@shared/components/confirmation-dialog/confirmation-dialog.component';
import { canPickBranchRole, isBranchManager } from '@core/utils/role-utils';
import { BookProductDialogComponent } from '../book-product-dialog/book-product-dialog.component';

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

  constructor(
    private dialogRef: MatDialogRef<ViewProductBookingDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public data: { product: Product; canAddBooking?: boolean },
    private dialog: MatDialog,
    private auth: AuthenticationService,
    private bookingsApi: ProductBookingsService,
    private notify: AppNotificationService,
    private translate: TranslateService
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
        this.bookings = res.bookings || [];
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

  close(): void {
    this.dialogRef.close(this.refreshParent);
  }

  pickupLabel(b: ProductActiveBooking): string {
    return b.pickupType === 'online_shipping'
      ? this.translate.instant('tr_booking_online_shipping')
      : this.translate.instant('tr_booking_branch_pickup');
  }

  canCancel(booking: ProductActiveBooking): boolean {
    const u = this.auth.getUserFromLocalStorage();
    if (!u?._id) {
      return false;
    }
    if (canPickBranchRole(u.role)) {
      return true;
    }
    const creatorId =
      typeof booking.createdBy === 'object' ? booking.createdBy?._id : booking.createdBy;
    return !!creatorId && String(creatorId) === String(u._id);
  }

  /**
   * Super Admin / Co Admin: any active unconfirmed booking.
   * Branch Manager: same branch only, not central warehouse stock.
   */
  canConfirm(booking: ProductActiveBooking): boolean {
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
        const msg =
          err?.error?.error || this.translate.instant('tr_booking_confirm_failed');
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
