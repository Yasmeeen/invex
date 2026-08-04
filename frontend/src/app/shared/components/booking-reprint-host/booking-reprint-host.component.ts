import { ChangeDetectorRef, Component, OnDestroy, ViewEncapsulation } from '@angular/core';
import { Subscription } from 'rxjs';
import {
  BookingReprintService,
} from '@shared/services/booking-reprint.service';
import { InvoiceReprintService } from '@shared/services/invoice-reprint.service';
import { BookingReceiptData } from '@shared/components/booking-receipt-print/booking-receipt-print.component';

/**
 * Same visual weight as cashier 80mm receipts.
 * Page is exactly 80mm wide with no extra outer padding (padding would force Chrome to shrink-to-fit → small/faint).
 */
const BOOKING_RECEIPT_PRINT_CSS = `
  @page { size: 80mm 297mm; margin: 0; }
  * {
    color: #000 !important;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
    box-sizing: border-box;
  }
  html, body {
    margin: 0;
    padding: 0;
    width: 80mm;
    background: #fff;
    color: #000 !important;
  }
  .invoice-container {
    width: 80mm;
    font-family: Arial, Helvetica, sans-serif;
    font-size: 12px;
    font-weight: 700;
    line-height: 1.35;
    color: #000 !important;
    padding: 3mm 2.5mm 8mm;
  }
  .center { text-align: center; }
  .bold { font-weight: 900; }
  .mb-2 { margin-bottom: 8px; }
  .mtb-4 { margin: 10px 0; }
  .store-name {
    font-size: 16px;
    font-weight: 900;
    margin: 6px 0;
  }
  .invoice-logo {
    display: block;
    margin: 0 auto 2mm;
    max-height: 64px;
    max-width: 100%;
    object-fit: contain;
  }
  .booking-receipt-badge {
    font-size: 15px;
    font-weight: 900;
    letter-spacing: 0.04em;
    margin: 0 0 10px;
    padding: 5px 8px;
    border: 2px dashed #000;
    display: inline-block;
    min-width: 60%;
  }
  .invoice-client-block {
    margin: 6px 0 8px;
    padding: 4px 2px 6px;
    border-top: 1px dashed #000;
    border-bottom: 1px dashed #000;
  }
  .invoice-client-block__title {
    font-weight: 900;
    font-size: 12px;
    text-align: center;
    margin-bottom: 4px;
  }
  .invoice-client-block__table td {
    font-size: 11px;
    font-weight: 700;
    padding: 2px 4px;
  }
  .invoice-client-block__label {
    font-weight: 900;
    white-space: nowrap;
    width: 40%;
  }
  .invoice-table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 5px;
    font-size: 12px;
    font-weight: 700;
  }
  .invoice-table td { padding: 3px 4px; vertical-align: top; }
  .invoice-table .header {
    border-bottom: 2px solid #000;
    font-weight: 900;
  }
  .products-table { table-layout: fixed; width: 100%; font-size: 12px; }
  .products-table__col-name { width: 40%; }
  .products-table__col-qty { width: 14%; }
  .products-table__col-price { width: 23%; }
  .products-table__col-total { width: 23%; }
  .products-table td:nth-child(3),
  .products-table td:nth-child(4) { text-align: right; white-space: nowrap; }
  .item-name { word-wrap: break-word; overflow-wrap: break-word; font-weight: 700; }
  .invoice-item-code {
    margin-top: 2px;
    font-size: 11px;
    font-weight: 700;
    line-height: 1.3;
  }
  .totals-table td {
    text-align: right;
    white-space: nowrap;
    font-size: 12px;
    font-weight: 700;
  }
  .money { white-space: nowrap; font-weight: 900; }
  .separator { margin: 5px 0; }
  .separator.double-border { border-bottom: 2px solid #000; }
  .final-total {
    font-size: 14px;
    margin: 6px 0;
    text-align: center;
    font-weight: 900;
  }
  .footer { margin-top: 10px; font-size: 11px; font-weight: 700; }
  .invoice-return-policy {
    margin: 8px 0 10px;
    padding: 4px 2px 6px;
    border-top: 1px dashed #000;
    border-bottom: 1px dashed #000;
    font-size: 11px;
    font-weight: 700;
    line-height: 1.45;
    text-align: center;
  }
  .invoice-return-policy__title { font-size: 12px; font-weight: 900; margin-bottom: 4px; }
  .invoice-return-policy__text { white-space: pre-wrap; word-wrap: break-word; font-weight: 700; }
  .invoice-qr { margin-top: 10px; padding: 4px 3mm 0; }
  .invoice-qr__img {
    width: 96px;
    height: 96px;
    display: inline-block;
    image-rendering: pixelated;
  }
  .invoice-qr__caption { font-size: 10px; font-weight: 700; margin-top: 3px; }
  [dir="rtl"] .invoice-table td { text-align: right; }
  [dir="rtl"] .products-table td:nth-child(3),
  [dir="rtl"] .products-table td:nth-child(4) { text-align: left; }
`;

/**
 * Isolated print host for booking receipts only.
 * Prints via a hidden iframe so MatDialog scroll-lock cannot clip the header,
 * without popup shrink-to-fit that made text look small/faint.
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
  private printFrame: HTMLIFrameElement | null = null;
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
  }

  private printIsolated(): void {
    if (typeof document === 'undefined' || typeof window === 'undefined') {
      return;
    }
    const host = document.getElementById('print-booking-receipt');
    if (!host || !host.innerHTML.trim()) {
      this.clearPrintState();
      return;
    }

    const dir = host.getAttribute('dir') === 'rtl' ? 'rtl' : 'ltr';
    const markup = host.innerHTML;
    this.removePrintFrame();

    const iframe = document.createElement('iframe');
    iframe.setAttribute('title', 'booking-receipt-print');
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
  <title>Booking receipt</title>
  <style>${BOOKING_RECEIPT_PRINT_CSS}</style>
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
    document.body.setAttribute('data-receipt-print', 'booking');
    const hadScrollBlock = document.body.classList.contains('cdk-global-scrollblock');
    const savedTop = document.body.style.top;
    if (hadScrollBlock) {
      document.body.classList.remove('cdk-global-scrollblock');
      document.body.style.top = '';
    }
    this.cdr.detectChanges();
    window.print();
    this.clearTimer = setTimeout(() => {
      if (document.body.getAttribute('data-receipt-print') === 'booking') {
        document.body.removeAttribute('data-receipt-print');
      }
      if (hadScrollBlock) {
        document.body.classList.add('cdk-global-scrollblock');
        document.body.style.top = savedTop;
      }
      this.clearPrintState();
    }, 5000);
  }

  private clearPrintState(): void {
    if (this.clearTimer != null) {
      clearTimeout(this.clearTimer);
      this.clearTimer = null;
    }
    if (typeof document !== 'undefined' && document.body.getAttribute('data-receipt-print') === 'booking') {
      document.body.removeAttribute('data-receipt-print');
    }
    if (!this.booking) return;
    this.booking = null;
    this.cdr.detectChanges();
  }
}
