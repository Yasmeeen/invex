import { ChangeDetectorRef, Component, OnDestroy, ViewEncapsulation } from '@angular/core';
import { Subscription } from 'rxjs';
import {
  BookingReprintService,
} from '@shared/services/booking-reprint.service';
import { InvoiceReprintService } from '@shared/services/invoice-reprint.service';
import { BookingReceiptData } from '@shared/components/booking-receipt-print/booking-receipt-print.component';

/**
 * Isolated print host for booking receipts only.
 * Must never share DOM/print IDs with cashier sale invoices.
 */
@Component({
  selector: 'app-booking-reprint-host',
  templateUrl: './booking-reprint-host.component.html',
  styleUrls: ['./booking-reprint-host.component.scss'],
  encapsulation: ViewEncapsulation.None,
})
export class BookingReprintHostComponent implements OnDestroy {
  booking: BookingReceiptData | null = null;
  printDate: Date = new Date();

  private sub?: Subscription;
  private clearSub?: Subscription;
  private clearTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly onAfterPrint = () => this.clearPrintState();

  constructor(
    private bookingReprint: BookingReprintService,
    private invoiceReprint: InvoiceReprintService,
    private cdr: ChangeDetectorRef
  ) {
    if (typeof window !== 'undefined') {
      window.addEventListener('afterprint', this.onAfterPrint);
    }
    this.clearSub = this.bookingReprint.clearPending$.subscribe(() => this.clearPrintState());
    this.sub = this.bookingReprint.reprint$.subscribe((req) => {
      if (this.clearTimer != null) {
        clearTimeout(this.clearTimer);
        this.clearTimer = null;
      }
      this.invoiceReprint.clearPending();
      this.booking = req.booking;
      this.printDate = req.printDate;
      this.setBodyPrintMode();
      setTimeout(() => {
        this.cdr.detectChanges();
        window.print();
        this.clearTimer = setTimeout(() => this.clearPrintState(), 5000);
      }, 350);
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    this.clearSub?.unsubscribe();
    if (this.clearTimer != null) {
      clearTimeout(this.clearTimer);
      this.clearTimer = null;
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('afterprint', this.onAfterPrint);
    }
    this.clearBodyPrintMode();
  }

  private setBodyPrintMode(): void {
    if (typeof document === 'undefined') return;
    document.body.setAttribute('data-receipt-print', 'booking');
  }

  private clearBodyPrintMode(): void {
    if (typeof document === 'undefined') return;
    if (document.body.getAttribute('data-receipt-print') === 'booking') {
      document.body.removeAttribute('data-receipt-print');
    }
  }

  private clearPrintState(): void {
    if (this.clearTimer != null) {
      clearTimeout(this.clearTimer);
      this.clearTimer = null;
    }
    this.clearBodyPrintMode();
    if (!this.booking) return;
    this.booking = null;
    this.cdr.detectChanges();
  }
}
