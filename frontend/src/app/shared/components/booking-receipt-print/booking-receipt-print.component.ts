import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  HostBinding,
  Input,
  OnInit,
  ViewEncapsulation,
} from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { StoreSettingsService } from '@shared/services/store-settings.service';
import { paymentMethodDisplayLabel } from '@shared/utils/cashier-payment-methods.util';
import { environment } from 'src/environments/environment';
import { toDataURL as qrToDataUrl } from 'qrcode';
import { take } from 'rxjs/operators';

/** Shape expected by the booking receipt printer. */
export interface BookingReceiptData {
  _id?: string;
  customerName?: string;
  customerPhone?: string;
  productName?: string;
  productCode?: string;
  quantity?: number;
  unitPrice?: number;
  depositAmount?: number;
  depositPayments?: Array<{ method?: string; amount?: number }>;
  pickupType?: string;
  shippingAddress?: string;
  pickupBranchName?: string;
  createdAt?: string | Date;
  bookingDate?: string | Date;
}

@Component({
  selector: 'app-booking-receipt-print',
  templateUrl: './booking-receipt-print.component.html',
  styleUrls: ['./booking-receipt-print.component.scss'],
  encapsulation: ViewEncapsulation.None,
})
export class BookingReceiptPrintComponent implements OnInit, AfterViewInit {
  @Input() booking: BookingReceiptData | null = null;
  @Input() printDate: Date = new Date();

  @HostBinding('attr.id') readonly hostPrintId = 'print-booking-receipt';

  @HostBinding('attr.dir')
  receiptDir: 'rtl' | 'ltr' = 'ltr';

  invoiceQrDataUrl: string | null = null;

  constructor(
    public storeSettings: StoreSettingsService,
    private translate: TranslateService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.storeSettings.settings$.pipe(take(1)).subscribe((st: any) => {
      this.receiptDir = st?.receiptLanguage === 'ar' ? 'rtl' : 'ltr';
    });
  }

  ngAfterViewInit(): void {
    const qrUrl = environment.innovationWebsiteUrl || 'https://www.innovation-tec.com/';
    qrToDataUrl(qrUrl, {
      width: 240,
      margin: 1,
      color: { dark: '#000000', light: '#ffffff' },
    })
      .then((dataUrl) => {
        this.invoiceQrDataUrl = dataUrl;
        this.cdr.detectChanges();
      })
      .catch(() => {
        this.invoiceQrDataUrl = null;
      });
  }

  productName(): string {
    return String(this.booking?.productName || '').trim() || '—';
  }

  productCode(): string {
    return String(this.booking?.productCode || '').trim();
  }

  quantity(): number {
    return Math.max(1, Math.floor(Number(this.booking?.quantity) || 1));
  }

  unitPrice(): number {
    const n = Number(this.booking?.unitPrice);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
  }

  lineTotal(): number {
    return Math.round(this.unitPrice() * this.quantity() * 100) / 100;
  }

  depositAmount(): number {
    const n = Number(this.booking?.depositAmount);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
  }

  remainingAmount(): number {
    return Math.round(Math.max(0, this.lineTotal() - this.depositAmount()) * 100) / 100;
  }

  depositPayments(): Array<{ method?: string; amount: number }> {
    const list = this.booking?.depositPayments;
    if (!Array.isArray(list)) {
      return [];
    }
    return list
      .map((p) => ({
        method: p?.method,
        amount: Math.round((Number(p?.amount) || 0) * 100) / 100,
      }))
      .filter((p) => p.amount > 0);
  }

  formatReceiptAmount(value: any): string {
    const n = Number(value);
    if (!Number.isFinite(n)) return '0';
    const rounded = Math.round(n);
    return new Intl.NumberFormat('en-US', {
      useGrouping: false,
      maximumFractionDigits: 0,
    }).format(rounded);
  }

  receiptCurrencyLabel(receiptLanguage: string | null | undefined): string {
    const l = String(receiptLanguage || '').toLowerCase();
    return l.startsWith('ar') ? 'ج.م' : 'LE';
  }

  payMethodReceiptLabel(method: string | undefined | null): string {
    return paymentMethodDisplayLabel(
      method,
      this.storeSettings.snapshot.paymentAppFeePercents,
      this.translate,
      this.storeSettings.snapshot.receiptLanguage
    );
  }

  pickupLabelKey(): string {
    return this.booking?.pickupType === 'online_shipping'
      ? 'tr_booking_online_shipping'
      : 'tr_booking_branch_pickup';
  }

  bookingRef(): string {
    const id = this.booking?._id;
    if (!id) return '—';
    const s = String(id);
    return s.length > 8 ? s.slice(-8).toUpperCase() : s.toUpperCase();
  }
}
