import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { InvoiceReturnRecord, Order } from '@core/models/products.model';
import { formatCairoDateTime } from '@core/utils/date-tz.util';
import { TranslateService } from '@ngx-translate/core';
import { paymentMethodDisplayLabel } from '@shared/utils/cashier-payment-methods.util';
import { StoreSettingsService } from '@shared/services/store-settings.service';

export type InvoiceReturnDetailsDialogMode = 'sales' | 'purchase';

export type InvoiceReturnDetailsDialogData = {
  mode: InvoiceReturnDetailsDialogMode;
  order?: Order;
  purchase?: any;
};

@Component({
  selector: 'app-invoice-return-details-dialog',
  templateUrl: './invoice-return-details-dialog.component.html',
  styleUrls: ['./invoice-return-details-dialog.component.scss'],
})
export class InvoiceReturnDetailsDialogComponent {
  readonly mode: InvoiceReturnDetailsDialogMode;
  readonly returns: InvoiceReturnRecord[];
  readonly order?: Order;
  readonly purchase?: any;

  constructor(
    private storeSettings: StoreSettingsService,
    private translate: TranslateService,
    private ref: MatDialogRef<InvoiceReturnDetailsDialogComponent>,
    @Inject(MAT_DIALOG_DATA) data: InvoiceReturnDetailsDialogData
  ) {
    this.mode = data.mode;
    this.order = data.order;
    this.purchase = data.purchase;
    const raw = data.mode === 'sales' ? data.order?.returns : data.purchase?.returns;
    this.returns = Array.isArray(raw) ? [...raw].reverse() : [];
  }

  get titleRef(): string {
    if (this.mode === 'sales') {
      return this.order?.orderNumber != null ? `#${this.order.orderNumber}` : '—';
    }
    const ref = String(this.purchase?.purchaseDocumentRef || this.purchase?._id || '').trim();
    return ref || '—';
  }

  formatWhen(value: string | undefined): string {
    return formatCairoDateTime(value);
  }

  paymentLabel(method: string | undefined): string {
    return paymentMethodDisplayLabel(
      method,
      this.storeSettings.snapshot.paymentAppFeePercents,
      this.translate
    );
  }

  treasuryLabel(key: string | undefined, fallback?: string): string {
    const k = String(key || '').trim().toLowerCase();
    if (!k) return fallback || '—';
    const row = this.storeSettings.snapshot.purchaseTreasuryMethods.find(
      (m) => String(m.key || '').trim().toLowerCase() === k
    );
    return row?.label || fallback || key || '—';
  }

  salesItemName(item: { productId?: string; quantity?: number }): string {
    const pid = String(item?.productId || '');
    const line = (this.order?.products || []).find((p) => String(p.productId || '') === pid);
    if (line?.name) {
      return line.code ? `${line.name} (${line.code})` : line.name;
    }
    return pid || '—';
  }

  cashViaLabel(via: string | undefined): string {
    return via === 'treasury'
      ? this.translate.instant('tr_invoice_return_cash_via_treasury')
      : this.translate.instant('tr_invoice_return_cash_via_drawer');
  }

  close(): void {
    this.ref.close();
  }
}
