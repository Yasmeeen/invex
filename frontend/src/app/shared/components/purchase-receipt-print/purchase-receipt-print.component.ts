import {
  ChangeDetectorRef,
  Component,
  HostBinding,
  Input,
  ViewEncapsulation,
  AfterViewInit,
  OnInit,
} from '@angular/core';
import { StoreSettingsService } from '@shared/services/store-settings.service';
import { environment } from 'src/environments/environment';
import { toDataURL as qrToDataUrl } from 'qrcode';
import { take } from 'rxjs/operators';

@Component({
    selector: 'app-purchase-receipt-print',
    templateUrl: './purchase-receipt-print.component.html',
    styleUrls: ['./purchase-receipt-print.component.scss'],
    encapsulation: ViewEncapsulation.None,
    standalone: false
})
export class PurchaseReceiptPrintComponent implements OnInit, AfterViewInit {
  @Input() purchase: any;
  /** Print date shown on receipt (defaults to request creation time). */
  @Input() printDate: Date = new Date();

  @HostBinding('attr.id') readonly hostPrintId = 'print-purchase-receipt';

  /** Mirrors cashier receipt print (`[dir]` on `#print-container`). */
  @HostBinding('attr.dir')
  receiptDir: 'rtl' | 'ltr' = 'ltr';

  invoiceQrDataUrl: string | null = null;

  constructor(public storeSettings: StoreSettingsService, private cdr: ChangeDetectorRef) {}

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

  get purchaseReferenceDisplay(): string {
    const id = this.purchase?._id;
    if (!id) return '-';
    const s = String(id);
    return s.length > 10 ? s.slice(-10).toUpperCase() : s.toUpperCase();
  }

  get lineQuantity(): number {
    return Math.max(1, Math.floor(Number(this.purchase?.quantity) || 1));
  }

  get unitNet(): number {
    const n = Number(this.purchase?.productPayload?.netPrice);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
  }

  get lineTotal(): number {
    return Math.round(this.unitNet * this.lineQuantity * 100) / 100;
  }

  get purchaseTreasuryDisplay(): string {
    const label = String(this.purchase?.purchaseTreasuryLabel || '').trim();
    const key = String(this.purchase?.purchaseTreasuryKey || '').trim().toLowerCase();
    if (!label && !key) return '';
    if (label && key) return `${label} (${key})`;
    return label || key;
  }

  get attrLines(): Array<{ label: string; value: string }> {
    const raw = this.purchase?.productPayload?.attributes;
    if (!raw || typeof raw !== 'object') return [];
    return Object.entries(raw).map(([k, v]) => ({
      label: String(k || '').replace(/_/g, ' '),
      value: String(v ?? ''),
    }));
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
}
