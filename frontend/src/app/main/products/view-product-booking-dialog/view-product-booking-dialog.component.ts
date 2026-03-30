import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { AuthenticationService } from '@core/services/authentication.service';
import { Product, ProductActiveBooking } from '@core/models/products.model';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { ProductBookingsService } from '@shared/services/product-bookings.service';
import { ConfirmationDialogComponent } from '@shared/components/confirmation-dialog/confirmation-dialog.component';

@Component({
  selector: 'app-view-product-booking-dialog',
  templateUrl: './view-product-booking-dialog.component.html',
  styleUrls: ['./view-product-booking-dialog.component.scss'],
})
export class ViewProductBookingDialogComponent {
  product: Product;
  booking: ProductActiveBooking;
  cancelling = false;

  constructor(
    private dialogRef: MatDialogRef<ViewProductBookingDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public data: { product: Product; booking: ProductActiveBooking },
    private dialog: MatDialog,
    private auth: AuthenticationService,
    private bookings: ProductBookingsService,
    private notify: AppNotificationService,
    private translate: TranslateService
  ) {
    this.product = data.product;
    this.booking = data.booking;
  }

  close(): void {
    this.dialogRef.close(false);
  }

  pickupLabel(): string {
    return this.booking.pickupType === 'online_shipping'
      ? this.translate.instant('tr_booking_online_shipping')
      : this.translate.instant('tr_booking_branch_pickup');
  }

  confirmCancel(): void {
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
          this.doCancel();
        }
      });
  }

  private doCancel(): void {
    const user = this.auth.getUserFromLocalStorage();
    const uid = user?._id;
    if (!uid) {
      this.notify.push(this.translate.instant('tr_unexpected_error_message'), 'error');
      return;
    }
    this.cancelling = true;
    this.bookings.cancelBooking(this.booking._id, { userId: uid }).subscribe({
      next: () => {
        this.notify.push(this.translate.instant('tr_booking_cancelled'), 'success');
        this.dialogRef.close(true);
      },
      error: (err) => {
        this.cancelling = false;
        const msg = err?.error?.error || this.translate.instant('tr_booking_cancel_failed');
        this.notify.push(msg, 'error');
      },
    });
  }
}
