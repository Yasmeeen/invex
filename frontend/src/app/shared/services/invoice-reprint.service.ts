import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

export type InvoiceReprintMode = 'sale' | 'purchase';

export interface InvoiceReprintRequest {
  mode: InvoiceReprintMode;
  data: any;
  printDate: Date;
}

/** Sale / purchase invoice reprints only (booking uses BookingReprintService). */
@Injectable({ providedIn: 'root' })
export class InvoiceReprintService {
  private readonly requests$ = new Subject<InvoiceReprintRequest>();
  private readonly clear$ = new Subject<void>();

  readonly reprint$ = this.requests$.asObservable();
  readonly clearPending$ = this.clear$.asObservable();

  printSale(order: any, printDate?: Date | string | null): void {
    if (!order) return;
    this.requests$.next({
      mode: 'sale',
      data: order,
      printDate: this.resolvePrintDate(printDate ?? order?.createdAt),
    });
  }

  printPurchase(purchase: any, printDate?: Date | string | null): void {
    if (!purchase) return;
    this.requests$.next({
      mode: 'purchase',
      data: purchase,
      printDate: this.resolvePrintDate(printDate ?? purchase?.createdAt),
    });
  }

  /** Drop any in-DOM sale/purchase reprint so it cannot leak into the next print. */
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
