import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  HostBinding,
  Input,
  OnInit,
  ViewEncapsulation,
} from '@angular/core';
import { OrderPartyType } from '@core/models/products.model';
import { TranslateService } from '@ngx-translate/core';
import { StoreSettingsService } from '@shared/services/store-settings.service';
import { paymentMethodDisplayLabel } from '@shared/utils/cashier-payment-methods.util';
import { environment } from 'src/environments/environment';
import { toDataURL as qrToDataUrl } from 'qrcode';
import { take } from 'rxjs/operators';

@Component({
  selector: 'app-sale-receipt-print',
  templateUrl: './sale-receipt-print.component.html',
  styleUrls: ['./sale-receipt-print.component.scss'],
  encapsulation: ViewEncapsulation.None,
})
export class SaleReceiptPrintComponent implements OnInit, AfterViewInit {
  @Input() order: any;
  @Input() printDate: Date = new Date();

  @HostBinding('attr.id') readonly hostPrintId = 'print-container';

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

  receiptLinesSubtotal(): number {
    const o = this.order;
    const raw = o?.subtotalPrice;
    if (o && raw != null && raw !== '' && Number.isFinite(Number(raw))) {
      return Math.round(Number(raw) * 100) / 100;
    }
    if (!o?.products?.length) return 0;
    const sum = o.products.reduce(
      (s: number, item: any) => s + Number(item.price || 0) * Number(item.quantity || 0),
      0
    );
    return Math.round(sum * 100) / 100;
  }

  receiptInvoiceExtraDiscount(): number {
    const d = Number(this.order?.invoiceDiscountAmount);
    if (!Number.isFinite(d) || d <= 0) return 0;
    return Math.round(d * 100) / 100;
  }

  receiptInvoiceSurchargeAmount(): number {
    const d = Number(this.order?.invoiceDiscountAmount);
    if (!Number.isFinite(d) || d >= 0) return 0;
    return Math.round(-d * 100) / 100;
  }

  receiptFinalTotal(): number {
    const t = Number(this.order?.totalPrice);
    if (Number.isFinite(t)) {
      return Math.round(t * 100) / 100;
    }
    const sub = this.receiptLinesSubtotal();
    const adj = Number(this.order?.invoiceDiscountAmount);
    const disc = Number.isFinite(adj) ? adj : 0;
    return Math.round((sub - disc) * 100) / 100;
  }

  receiptExchangeCredit(): number {
    const v = Number(this.order?.exchangeTradeInCreditAmount);
    return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
  }

  receiptExchangeCollected(): number {
    const v = Number(this.order?.amountPaid);
    return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
  }

  receiptPaidPayments(): Array<{ method?: string; amount: number; feeForMethod?: string }> {
    const list = this.order?.payments;
    if (!Array.isArray(list)) {
      return [];
    }
    return list.filter(
      (p: any) => Number(p?.amount) > 0 && p?.countsTowardInvoice !== false && !p?.feeForMethod
    );
  }

  receiptFeePayments(): Array<{ method?: string; amount: number; feeForMethod?: string }> {
    const list = this.order?.payments;
    if (!Array.isArray(list)) {
      return [];
    }
    return list.filter((p: any) => Number(p?.amount) > 0 && p?.feeForMethod);
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

  receiptPartyType(): OrderPartyType {
    const t = this.order?.partyType;
    return t === 'supplier' ? 'supplier' : 'client';
  }

  receiptPartyTypeLabelKey(): string {
    return this.receiptPartyType() === 'supplier'
      ? 'tr_invoice_party_supplier'
      : 'tr_invoice_party_client';
  }

  get showReceiptClientSection(): boolean {
    const o = this.order;
    if (!o) {
      return false;
    }
    const phone = (o.clientPhoneNumber || '').trim();
    const name = (o.clientName || '').trim();
    const addr = (o.clientAddress || '').trim();
    if (phone && phone !== '00') {
      return true;
    }
    if (name && name !== 'Walk-in') {
      return true;
    }
    if (addr && addr !== '-') {
      return true;
    }
    return false;
  }
}
