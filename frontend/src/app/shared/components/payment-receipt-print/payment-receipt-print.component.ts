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
import { isInstallmentSale } from '@core/utils/order-display.util';
import { TranslateService } from '@ngx-translate/core';
import { StoreSettingsService } from '@shared/services/store-settings.service';
import { paymentMethodDisplayLabel } from '@shared/utils/cashier-payment-methods.util';
import { environment } from 'src/environments/environment';
import { toDataURL as qrToDataUrl } from 'qrcode';
import { take } from 'rxjs/operators';

export interface PaymentReceiptData {
  order: any;
  paidNow: number;
  remainingAfter: number;
  payments: Array<{ method?: string; amount: number }>;
  paidAt?: string | Date | null;
  /** Remaining unpaid installment rows after this payment (sale installments). */
  remainingInstallments?: number | null;
}

@Component({
  selector: 'app-payment-receipt-print',
  templateUrl: './payment-receipt-print.component.html',
  styleUrls: ['./payment-receipt-print.component.scss'],
  encapsulation: ViewEncapsulation.None,
})
export class PaymentReceiptPrintComponent implements OnInit, AfterViewInit {
  @Input() receipt: PaymentReceiptData | null = null;
  @Input() printDate: Date = new Date();

  @HostBinding('attr.id') readonly hostPrintId = 'print-payment-receipt';

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

  get order(): any {
    return this.receipt?.order;
  }

  products(): any[] {
    const list = this.order?.products;
    return Array.isArray(list) ? list : [];
  }

  paidNow(): number {
    const n = Number(this.receipt?.paidNow);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
  }

  remainingAfter(): number {
    const n = Number(this.receipt?.remainingAfter);
    return Number.isFinite(n) ? Math.round(Math.max(0, n) * 100) / 100 : 0;
  }

  isFullySettled(): boolean {
    return this.remainingAfter() <= 0.005;
  }

  fullySettledLabelKey(): string {
    return isInstallmentSale(this.order)
      ? 'tr_installments_fully_settled'
      : 'tr_credit_fully_settled';
  }

  remainingInstallments(): number | null {
    const n = Number(this.receipt?.remainingInstallments);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.floor(n);
  }

  thisPayments(): Array<{ method?: string; amount: number }> {
    const list = this.receipt?.payments;
    if (!Array.isArray(list)) {
      return [];
    }
    return list
      .map((p) => ({
        method: p?.method,
        amount: Math.round((Number(p?.amount) || 0) * 100) / 100,
      }))
      .filter((p) => p.amount > 0 && String(p.method || '').toLowerCase() !== 'credit');
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
