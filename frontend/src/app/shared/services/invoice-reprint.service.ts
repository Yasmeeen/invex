import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { PaymentReceiptData } from '@shared/components/payment-receipt-print/payment-receipt-print.component';
import { DrawerCloseReceiptData } from '@shared/components/drawer-close-receipt-print/drawer-close-receipt-print.component';

export type InvoiceReprintMode = 'sale' | 'purchase' | 'payment' | 'drawerClose';

export interface InvoiceReprintRequest {
  mode: InvoiceReprintMode;
  data: any;
  printDate: Date;
}

/** Sale / purchase / installment payment / drawer-close reprints (booking uses BookingReprintService). */
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

  printPayment(receipt: PaymentReceiptData, printDate?: Date | string | null): void {
    if (!receipt?.order) return;
    this.requests$.next({
      mode: 'payment',
      data: receipt,
      printDate: this.resolvePrintDate(printDate ?? receipt.paidAt),
    });
  }

  printDrawerClose(receipt: DrawerCloseReceiptData, printDate?: Date | string | null): void {
    if (!receipt) return;
    this.requests$.next({
      mode: 'drawerClose',
      data: receipt,
      printDate: this.resolvePrintDate(printDate),
    });
  }

  /** Drop any in-DOM sale/purchase/payment reprint so it cannot leak into the next print. */
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
