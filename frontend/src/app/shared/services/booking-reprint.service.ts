import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { BookingReceiptData } from '@shared/components/booking-receipt-print/booking-receipt-print.component';

export interface BookingReprintRequest {
  booking: BookingReceiptData;
  printDate: Date;
}

/** Dedicated print bus for booking receipts (never mixed with sale/purchase reprints). */
@Injectable({ providedIn: 'root' })
export class BookingReprintService {
  private readonly requests$ = new Subject<BookingReprintRequest>();
  private readonly clear$ = new Subject<void>();

  readonly reprint$ = this.requests$.asObservable();
  readonly clearPending$ = this.clear$.asObservable();

  printBooking(booking: BookingReceiptData, printDate?: Date | string | null): void {
    if (!booking) return;
    this.requests$.next({
      booking,
      printDate: this.resolvePrintDate(
        printDate ?? booking?.createdAt ?? booking?.bookingDate
      ),
    });
  }

  /** Drop any in-DOM booking receipt so it cannot leak into the next print. */
  clearPending(): void {
    this.clear$.next();
  }

  private resolvePrintDate(value: Date | string | null | undefined): Date {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value;
    }
    if (value != null && value !== '') {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed;
      }
    }
    return new Date();
  }
}
