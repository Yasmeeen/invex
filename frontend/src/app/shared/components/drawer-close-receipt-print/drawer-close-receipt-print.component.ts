import { Component, HostBinding, Input, OnInit, ViewEncapsulation } from '@angular/core';
import { DrawerSoldProduct } from '@shared/services/drawer-close.service';
import { StoreSettingsService } from '@shared/services/store-settings.service';
import { take } from 'rxjs/operators';

export interface DrawerCloseReceiptData {
  businessDate?: string;
  periodStartDate?: string;
  periodEndDate?: string;
  branchName?: string;
  invoiceCount?: number;
  expectedCashInDrawer?: number | null;
  actualCashCounted?: number | null;
  variance?: number | null;
  soldProducts?: DrawerSoldProduct[];
  uncollectedDeliveryInvoiceCount?: number;
}

@Component({
  selector: 'app-drawer-close-receipt-print',
  templateUrl: './drawer-close-receipt-print.component.html',
  styleUrls: ['./drawer-close-receipt-print.component.scss'],
  encapsulation: ViewEncapsulation.None,
})
export class DrawerCloseReceiptPrintComponent implements OnInit {
  @Input() receipt: DrawerCloseReceiptData | null = null;
  @Input() printDate: Date = new Date();

  @HostBinding('attr.id') readonly hostPrintId = 'print-drawer-close-receipt';

  @HostBinding('attr.dir')
  receiptDir: 'rtl' | 'ltr' = 'ltr';

  constructor(public storeSettings: StoreSettingsService) {}

  ngOnInit(): void {
    this.storeSettings.settings$.pipe(take(1)).subscribe((st: any) => {
      this.receiptDir = st?.receiptLanguage === 'ar' ? 'rtl' : 'ltr';
    });
  }

  soldProducts(): DrawerSoldProduct[] {
    return Array.isArray(this.receipt?.soldProducts) ? this.receipt!.soldProducts! : [];
  }

  salesTotal(): number {
    return Math.round(
      this.soldProducts().reduce((sum, row) => sum + Number(row?.totalAmount || 0), 0) * 100
    ) / 100;
  }

  salesShare(row: DrawerSoldProduct): number | null {
    if (row?.totalAmount == null) return null;
    const total = this.salesTotal();
    if (!(total > 0)) return null;
    return Math.round((Number(row.totalAmount) / total) * 1000) / 10;
  }

  formatSalesShare(row: DrawerSoldProduct): string {
    const share = this.salesShare(row);
    return share == null ? '—' : `${share}%`;
  }

  periodLabel(): string {
    const start = String(this.receipt?.periodStartDate || this.receipt?.businessDate || '').trim();
    const end = String(this.receipt?.periodEndDate || this.receipt?.businessDate || '').trim();
    if (!start && !end) return '—';
    if (start && end && start !== end) return `${start} → ${end}`;
    return start || end;
  }

  formatSoldQty(row: DrawerSoldProduct): string {
    const q = Number(row?.quantity || 0);
    if (!Number.isFinite(q)) return '0';
    if (String(row?.saleUnit || '').toLowerCase() === 'weight') {
      return String(Math.round(q * 1000) / 1000);
    }
    if (Number.isInteger(q)) return String(q);
    return String(Math.round(q * 1000) / 1000);
  }

  soldUnitLabelKey(row: DrawerSoldProduct): string {
    const unit = String(row?.saleUnit || 'piece').toLowerCase();
    if (unit === 'weight') {
      const wu = String(row?.weightUnit || 'kg').toLowerCase() === 'g' ? 'g' : 'kg';
      return wu === 'g' ? 'tr_drawer_close_sold_unit_g' : 'tr_drawer_close_sold_unit_kg';
    }
    if (unit === 'head') return 'tr_drawer_close_sold_unit_head';
    return 'tr_drawer_close_sold_unit_piece';
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

  hasActualCash(): boolean {
    const n = Number(this.receipt?.actualCashCounted);
    return Number.isFinite(n);
  }

  uncollectedDeliveryCount(): number {
    return Math.max(0, Math.floor(Number(this.receipt?.uncollectedDeliveryInvoiceCount || 0)));
  }
}
