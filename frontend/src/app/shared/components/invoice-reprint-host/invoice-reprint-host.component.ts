import { ChangeDetectorRef, Component, OnDestroy, ViewEncapsulation } from '@angular/core';
import { Subscription } from 'rxjs';
import {
  InvoiceReprintMode,
  InvoiceReprintService,
} from '@shared/services/invoice-reprint.service';
import { BookingReprintService } from '@shared/services/booking-reprint.service';
import { RECEIPT_ISOLATED_PRINT_CSS } from '@shared/utils/isolated-receipt-print';

/** Sale + purchase reprints only. Booking uses app-booking-reprint-host. */
@Component({
  selector: 'app-invoice-reprint-host',
  templateUrl: './invoice-reprint-host.component.html',
  styleUrls: ['./invoice-reprint-host.component.scss'],
  encapsulation: ViewEncapsulation.None,
})
export class InvoiceReprintHostComponent implements OnDestroy {
  mode: InvoiceReprintMode | null = null;
  data: any = null;
  printDate: Date = new Date();

  private sub?: Subscription;
  private clearSub?: Subscription;
  private clearTimer: ReturnType<typeof setTimeout> | null = null;
  private printFrame: HTMLIFrameElement | null = null;
  private readonly onAfterPrint = () => this.clearPrintState();

  constructor(
    private invoiceReprint: InvoiceReprintService,
    private bookingReprint: BookingReprintService,
    private cdr: ChangeDetectorRef
  ) {
    if (typeof window !== 'undefined') {
      window.addEventListener('afterprint', this.onAfterPrint);
    }
    this.clearSub = this.invoiceReprint.clearPending$.subscribe(() => this.clearPrintState());
    this.sub = this.invoiceReprint.reprint$.subscribe((req) => {
      if (this.clearTimer != null) {
        clearTimeout(this.clearTimer);
        this.clearTimer = null;
      }
      this.bookingReprint.clearPending();
      this.mode = req.mode;
      this.data = req.data;
      this.printDate = req.printDate;
      setTimeout(() => {
        this.cdr.detectChanges();
        setTimeout(() => this.printIsolated(), 400);
      }, 200);
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
    this.removePrintFrame();
    this.clearBodyPrintMode();
  }

  private printTargetId(): string | null {
    if (this.mode === 'sale') return 'print-sale-receipt';
    if (this.mode === 'purchase') return 'print-purchase-receipt';
    if (this.mode === 'payment') return 'print-payment-receipt';
    return null;
  }

  private printIsolated(): void {
    if (typeof document === 'undefined' || typeof window === 'undefined') {
      return;
    }
    const id = this.printTargetId();
    const host = id ? document.getElementById(id) : null;
    if (!host || !host.innerHTML.trim()) {
      this.clearPrintState();
      return;
    }

    const dir = host.getAttribute('dir') === 'rtl' ? 'rtl' : 'ltr';
    const markup = host.innerHTML;
    this.removePrintFrame();

    const iframe = document.createElement('iframe');
    iframe.setAttribute('title', 'invoice-receipt-print');
    iframe.setAttribute(
      'style',
      'position:fixed;left:0;top:0;width:80mm;height:1px;opacity:0;border:0;pointer-events:none;z-index:-1;'
    );
    document.body.appendChild(iframe);
    this.printFrame = iframe;

    const doc = iframe.contentDocument;
    const win = iframe.contentWindow;
    if (!doc || !win) {
      this.removePrintFrame();
      this.fallbackMainWindowPrint();
      return;
    }

    doc.open();
    doc.write(`<!DOCTYPE html>
<html dir="${dir}">
<head>
  <meta charset="utf-8" />
  <title>Invoice receipt</title>
  <style>${RECEIPT_ISOLATED_PRINT_CSS}</style>
</head>
<body>${markup}</body>
</html>`);
    doc.close();

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      try {
        win.focus();
        win.print();
      } catch {
        this.fallbackMainWindowPrint();
        return;
      }
      setTimeout(() => {
        this.removePrintFrame();
        this.clearPrintState();
      }, 800);
    };

    const imgs = Array.from(doc.images);
    if (!imgs.length) {
      setTimeout(finish, 120);
      return;
    }
    let pending = imgs.length;
    const done = () => {
      pending -= 1;
      if (pending <= 0) {
        setTimeout(finish, 80);
      }
    };
    imgs.forEach((img) => {
      if (img.complete) {
        done();
      } else {
        img.addEventListener('load', done, { once: true });
        img.addEventListener('error', done, { once: true });
      }
    });
    setTimeout(finish, 2500);
  }

  private removePrintFrame(): void {
    if (this.printFrame?.parentNode) {
      this.printFrame.parentNode.removeChild(this.printFrame);
    }
    this.printFrame = null;
  }

  private fallbackMainWindowPrint(): void {
    this.removePrintFrame();
    if (!this.mode) {
      this.clearPrintState();
      return;
    }
    this.setBodyPrintMode(this.mode);
    this.cdr.detectChanges();
    window.print();
    this.clearTimer = setTimeout(() => this.clearPrintState(), 5000);
  }

  private setBodyPrintMode(mode: InvoiceReprintMode): void {
    if (typeof document === 'undefined') return;
    document.body.setAttribute('data-receipt-print', mode);
  }

  private clearBodyPrintMode(): void {
    if (typeof document === 'undefined') return;
    const cur = document.body.getAttribute('data-receipt-print');
    if (cur === 'sale' || cur === 'purchase' || cur === 'payment') {
      document.body.removeAttribute('data-receipt-print');
    }
  }

  private clearPrintState(): void {
    if (this.clearTimer != null) {
      clearTimeout(this.clearTimer);
      this.clearTimer = null;
    }
    this.clearBodyPrintMode();
    if (this.mode == null && this.data == null) {
      return;
    }
    this.mode = null;
    this.data = null;
    this.cdr.detectChanges();
  }
}
