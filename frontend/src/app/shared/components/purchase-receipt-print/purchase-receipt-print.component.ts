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

  get receiptLines(): Array<{ productPayload: any; quantity: number }> {
    const p = this.purchase;
    if (!p) return [];
    if (Array.isArray(p.lines) && p.lines.length) {
      return p.lines
        .map((l: any) => ({
          productPayload: l?.productPayload,
          quantity: Math.max(1, Math.floor(Number(l?.quantity) || 1)),
        }))
        .filter((l: any) => l.productPayload);
    }
    if (!p.productPayload) return [];
    return [
      {
        productPayload: p.productPayload,
        quantity: Math.max(1, Math.floor(Number(p.quantity) || 1)),
      },
    ];
  }

  get lineQuantity(): number {
    return this.receiptLines.reduce((sum, l) => sum + l.quantity, 0);
  }

  lineUnitNet(line: { productPayload?: any }): number {
    const n = Number(line?.productPayload?.netPrice);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
  }

  lineRowTotal(line: { productPayload?: any; quantity?: number }): number {
    const q = Math.max(1, Math.floor(Number(line?.quantity) || 1));
    return Math.round(this.lineUnitNet(line) * q * 100) / 100;
  }

  get lineTotal(): number {
    return Math.round(
      this.receiptLines.reduce((sum, line) => sum + this.lineRowTotal(line), 0) * 100
    ) / 100;
  }

  get purchaseTreasuryDisplay(): string {
    const splits = Array.isArray(this.purchase?.purchaseTreasurySplits)
      ? this.purchase.purchaseTreasurySplits
      : [];
    if (splits.length > 1) {
      return splits
        .map((s: { label?: string; key?: string; amount?: number }) => {
          const name = String(s?.label || s?.key || '').trim();
          const amt = Number(s?.amount);
          const amtStr = Number.isFinite(amt) ? this.formatReceiptAmount(amt) : '0';
          return `${name}: ${amtStr}`;
        })
        .join(' · ');
    }
    const label = String(this.purchase?.purchaseTreasuryLabel || '').trim();
    const key = String(this.purchase?.purchaseTreasuryKey || '').trim().toLowerCase();
    if (!label && !key) return '';
    if (label && key && label !== key) return `${label} (${key})`;
    return label || key;
  }

  attrLinesFor(payload: any): Array<{ label: string; value: string }> {
    const raw = payload?.attributes;
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
