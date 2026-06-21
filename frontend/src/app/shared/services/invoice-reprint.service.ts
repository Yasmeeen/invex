import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

export type InvoiceReprintMode = 'sale' | 'purchase';

export interface InvoiceReprintRequest {
  mode: InvoiceReprintMode;
  data: any;
  printDate: Date;
}

@Injectable({ providedIn: 'root' })
export class InvoiceReprintService {
  private readonly requests$ = new Subject<InvoiceReprintRequest>();

  readonly reprint$ = this.requests$.asObservable();

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
