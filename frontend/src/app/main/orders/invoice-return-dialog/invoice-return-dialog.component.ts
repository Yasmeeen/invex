import { Component, Inject, OnDestroy, OnInit } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Order } from '@core/models/products.model';
import { AuthenticationService } from '@core/services/authentication.service';
import { resolveActorBranchContext } from '@core/utils/branch-utils';
import { isPayLaterMethod, lineProductId, orderLineRemainingQty, purchaseReturnableQty } from '@core/utils/order-display.util';
import { TranslateService } from '@ngx-translate/core';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { OrdersSerivce } from '@shared/services/orders.service';
import { ProductPurchaseRequestsService } from '@shared/services/product-purchase-requests.service';
import { StoreSettingsService } from '@shared/services/store-settings.service';
import {
  applyCashViaToPreview,
  buildPurchaseRefundPreview,
  buildSalesRefundPreview,
  CashRefundVia,
  purchaseCashPortionAmount,
  RefundAllocationRow,
  salesCashPortionAmount,
} from '@shared/utils/invoice-return-refund.util';
import { daysSince } from '@core/utils/date-tz.util';
import { paymentMethodDisplayLabel } from '@shared/utils/cashier-payment-methods.util';
import { Subscription } from 'rxjs';

export type InvoiceReturnDialogMode = 'sales' | 'purchase';

export type InvoiceReturnDialogData = {
  mode: InvoiceReturnDialogMode;
  order?: Order;
  orderId?: string;
  purchase?: any;
  purchaseId?: string;
  forcedBranchId?: string | null;
};

type SalesReturnRow = {
  productId: string;
  name: string;
  code: string;
  remaining: number;
  quantity: number;
  unitRefundPrice: number;
  selected: boolean;
};

@Component({
  selector: 'app-invoice-return-dialog',
  templateUrl: './invoice-return-dialog.component.html',
  styleUrls: ['./invoice-return-dialog.component.scss'],
})
export class InvoiceReturnDialogComponent implements OnInit, OnDestroy {
  readonly mode: InvoiceReturnDialogMode;
  loading = true;
  saving = false;
  returnAll = false;
  refundTotal = 0;
  note = '';

  order: Order | null = null;
  salesRows: SalesReturnRow[] = [];
  isCreditSale = false;

  purchase: any = null;
  purchaseRemaining = 0;
  purchaseQty = 1;
  purchaseUnitPrice = 0;
  purchaseHasDeferred = false;
  purchaseSummary = '';
  unitCodeOptions: { id: string; label: string }[] = [];
  selectedUnitCodes = new Set<string>();

  refundPreview: RefundAllocationRow[] = [];
  cashRefundVia: CashRefundVia = 'drawer';
  cashTreasuryKey = '';
  treasuryMethodOptions: { key: string; label: string }[] = [];
  alternateTreasuryOptions: { key: string; label: string }[] = [];
  showAgeWarning = false;
  invoiceAgeDays = 0;

  private paymentBranchId: string | null = null;
  private subscriptions: Subscription[] = [];

  constructor(
    private orders: OrdersSerivce,
    private purchaseApi: ProductPurchaseRequestsService,
    private auth: AuthenticationService,
    private storeSettings: StoreSettingsService,
    private translate: TranslateService,
    private notify: AppNotificationService,
    private ref: MatDialogRef<InvoiceReturnDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) data: InvoiceReturnDialogData
  ) {
    this.mode = data.mode;
    const actor = this.auth.getUserFromLocalStorage();
    const ctx = resolveActorBranchContext(actor, data.forcedBranchId);
    this.paymentBranchId = ctx.branchId;

    if (data.mode === 'sales') {
      if (data.order) {
        this.order = data.order;
        this.loading = false;
        this.initSalesFromOrder();
      } else if (data.orderId) {
        this.orders.getOrder(data.orderId).subscribe({
          next: (res: any) => {
            this.order = res?.order || res;
            this.initSalesFromOrder();
            this.loading = false;
          },
          error: () => {
            this.loading = false;
            this.notify.push(this.translate.instant('tr_unexpected_error_message'), 'error');
          },
        });
      }
    } else if (data.purchase) {
      this.purchase = data.purchase;
      this.loading = false;
      this.initPurchaseFromDoc();
    } else if (data.purchaseId) {
      const u = this.auth.getUserFromLocalStorage();
      this.purchaseApi.getById(data.purchaseId, u?._id).subscribe({
        next: (res: any) => {
          this.purchase = res?.purchase || res;
          this.initPurchaseFromDoc();
          this.loading = false;
        },
        error: () => {
          this.loading = false;
          this.notify.push(this.translate.instant('tr_unexpected_error_message'), 'error');
        },
      });
    }
  }

  ngOnInit(): void {
    this.syncTreasuryOptions();
    this.subscriptions.push(
      this.storeSettings.settings$.subscribe(() => this.syncTreasuryOptions())
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach((s) => s.unsubscribe());
  }

  get showRefundPlan(): boolean {
    return this.refundTotal > 0 && this.refundPreview.length > 0;
  }

  get cashPortionAmount(): number {
    return this.mode === 'sales'
      ? salesCashPortionAmount(this.refundPreview)
      : purchaseCashPortionAmount(this.refundPreview);
  }

  get showCashChoice(): boolean {
    return this.cashPortionAmount > 0.005;
  }

  get displayRefundPreview(): RefundAllocationRow[] {
    if (!this.showCashChoice || this.cashRefundVia === 'drawer') {
      return this.refundPreview;
    }
    return applyCashViaToPreview(
      this.refundPreview,
      this.cashRefundVia,
      this.cashTreasuryKey,
      this.treasuryOptionLabel(this.cashTreasuryKey)
    );
  }

  lineTotal(qty: number, price: number): number {
    return Math.round(Math.max(0, qty) * Math.max(0, price) * 100) / 100;
  }

  private initSalesFromOrder(): void {
    const o = this.order;
    if (!o) return;
    this.isCreditSale = isPayLaterMethod(o.paymentMethod);
    this.salesRows = (o.products || []).map((line) => {
      const remaining = orderLineRemainingQty(line, o);
      return {
        productId: lineProductId(line.productId),
        name: String(line.name || ''),
        code: String(line.code || ''),
        remaining,
        quantity: remaining > 0 ? remaining : 0,
        unitRefundPrice: Number(line.price) || 0,
        selected: remaining > 0,
      };
    });
    this.syncSalesRefundTotal();
    this.syncInvoiceAge(o.createdAt);
  }

  private initPurchaseFromDoc(): void {
    const p = this.purchase;
    if (!p) return;
    this.purchaseRemaining = purchaseReturnableQty(p);
    this.purchaseQty = this.purchaseRemaining;
    this.purchaseUnitPrice = Number(p?.productPayload?.netPrice) || 0;

    const splits = Array.isArray(p?.purchaseTreasurySplits) ? p.purchaseTreasurySplits : [];
    this.purchaseHasDeferred = splits.some(
      (s: any) => String(s?.key || '').toLowerCase() === 'deferred'
    );

    const pp = p?.productPayload || {};
    const party = String(pp.acquiredFrom?.displayName || pp.acquiredFrom?.name || '').trim();
    this.purchaseSummary = [pp.name, pp.code, party].filter(Boolean).join(' · ');

    const ids: string[] = Array.isArray(p.createdProductIds)
      ? p.createdProductIds.map((id: any) => String(id))
      : p.createdProductId
        ? [String(p.createdProductId)]
        : [];
    const codes = Array.isArray(pp.unitCodes) && pp.unitCodes.length ? pp.unitCodes : [pp.code];
    this.unitCodeOptions = ids.map((id, i) => ({
      id,
      label: String(codes[i] || codes[0] || id).trim(),
    }));

    this.syncPurchaseRefundTotal();
    this.syncInvoiceAge(p.createdAt);
  }

  private syncInvoiceAge(createdAt: string | Date | undefined): void {
    this.invoiceAgeDays = daysSince(createdAt);
    this.showAgeWarning = this.invoiceAgeDays >= 14;
  }

  onReturnAllChange(): void {
    if (this.mode === 'sales') {
      this.syncSalesRefundTotal();
    } else {
      this.purchaseQty = this.returnAll ? this.purchaseRemaining : 1;
      this.syncPurchaseRefundTotal();
    }
  }

  syncSalesRefundTotal(): void {
    let total = 0;
    for (const row of this.salesRows) {
      if (this.returnAll) {
        if (row.remaining > 0) {
          total += this.lineTotal(row.remaining, row.unitRefundPrice);
        }
      } else if (row.selected && row.remaining > 0) {
        const qty = Math.min(row.remaining, Math.max(1, Math.floor(Number(row.quantity) || 0)));
        row.quantity = qty;
        total += this.lineTotal(qty, row.unitRefundPrice);
      }
    }
    this.refundTotal = Math.round(total * 100) / 100;
    this.syncRefundPreview();
  }

  syncPurchaseRefundTotal(): void {
    const qty = this.returnAll
      ? this.purchaseRemaining
      : Math.min(this.purchaseRemaining, Math.max(1, Math.floor(Number(this.purchaseQty) || 0)));
    this.purchaseQty = qty;
    this.refundTotal = Math.round(qty * (Number(this.purchaseUnitPrice) || 0) * 100) / 100;
    this.syncRefundPreview();
  }

  private syncRefundPreview(): void {
    if (this.refundTotal <= 0) {
      this.refundPreview = [];
      return;
    }

    if (this.mode === 'sales' && this.order) {
      this.refundPreview = buildSalesRefundPreview(this.order, this.refundTotal, (method) =>
        paymentMethodDisplayLabel(method, this.storeSettings.snapshot.paymentAppFeePercents, this.translate)
      );
    } else if (this.mode === 'purchase' && this.purchase) {
      this.refundPreview = buildPurchaseRefundPreview(this.purchase, this.refundTotal, (key, fallback) =>
        this.treasuryOptionLabel(key, fallback)
      );
    }
  }

  onCashRefundViaChange(): void {
    if (this.cashRefundVia === 'treasury' && !this.cashTreasuryKey) {
      const first = this.alternateTreasuryOptions[0];
      this.cashTreasuryKey = first?.key || '';
    }
  }

  onCashTreasuryChange(key: string): void {
    this.cashTreasuryKey = String(key || '').trim().toLowerCase();
  }

  toggleUnitCode(id: string): void {
    if (this.selectedUnitCodes.has(id)) {
      this.selectedUnitCodes.delete(id);
    } else {
      this.selectedUnitCodes.add(id);
    }
    this.purchaseQty = this.selectedUnitCodes.size || this.purchaseQty;
    this.syncPurchaseRefundTotal();
  }

  private syncTreasuryOptions(): void {
    const m = this.storeSettings.snapshot.purchaseTreasuryMethods;
    const raw = Array.isArray(m) && m.length ? m : [{ key: 'cash', label: 'Cash' }];
    this.treasuryMethodOptions = raw
      .map((x) => ({
        key: String(x.key || '').trim().toLowerCase(),
        label: String(x.label || x.key || '').trim(),
      }))
      .filter((o) => o.key && o.key !== 'deferred');
    this.alternateTreasuryOptions = this.treasuryMethodOptions.filter((o) => o.key !== 'cash');

    if (!this.cashTreasuryKey || !this.alternateTreasuryOptions.some((o) => o.key === this.cashTreasuryKey)) {
      this.cashTreasuryKey = this.alternateTreasuryOptions[0]?.key || '';
    }
  }

  treasuryOptionLabel(key: string, fallback?: string): string {
    return this.treasuryMethodOptions.find((o) => o.key === key)?.label || fallback || key;
  }

  private buildSalesItemsPayload():
    | { returnAll: true }
    | { returnAll: false; items: { productId: string; quantity: number; unitRefundPrice: number }[] } {
    if (this.returnAll) {
      return { returnAll: true };
    }
    const items = this.salesRows
      .filter((row) => row.selected && row.remaining > 0)
      .map((row) => ({
        productId: row.productId,
        quantity: Math.min(row.remaining, Math.max(1, Math.floor(Number(row.quantity) || 0))),
        unitRefundPrice: Math.round((Number(row.unitRefundPrice) || 0) * 100) / 100,
      }));
    return { returnAll: false, items };
  }

  private validateCashChoice(): boolean {
    if (!this.showCashChoice) return true;
    if (this.cashRefundVia === 'drawer') return true;
    if (!this.cashTreasuryKey || this.cashTreasuryKey === 'cash') {
      this.notify.push(this.translate.instant('tr_invoice_return_cash_treasury_required'), 'error');
      return false;
    }
    return true;
  }

  submit(): void {
    if (this.saving || this.loading) return;
    if (this.refundTotal <= 0) {
      this.notify.push(this.translate.instant('tr_invoice_return_nothing_selected'), 'error');
      return;
    }
    if (!this.validateCashChoice()) return;

    const u = this.auth.getUserFromLocalStorage();
    const cashPayload = this.showCashChoice
      ? {
          cashRefundVia: this.cashRefundVia,
          cashTreasuryKey: this.cashRefundVia === 'treasury' ? this.cashTreasuryKey : undefined,
          cashTreasuryLabel:
            this.cashRefundVia === 'treasury'
              ? this.treasuryOptionLabel(this.cashTreasuryKey)
              : undefined,
        }
      : {};

    if (this.mode === 'sales') {
      const payload = this.buildSalesItemsPayload();
      if (!payload.returnAll && (!('items' in payload) || !payload.items.length)) {
        this.notify.push(this.translate.instant('tr_invoice_return_nothing_selected'), 'error');
        return;
      }

      this.saving = true;
      this.orders
        .restoreOrder(String(this.order?._id), {
          userId: u?._id,
          branchId: this.paymentBranchId || undefined,
          note: this.note,
          ...payload,
          ...cashPayload,
        })
        .subscribe({
          next: () => {
            this.saving = false;
            this.notify.push(this.translate.instant('Order restored successfully!'), 'success');
            this.ref.close(true);
          },
          error: (err) => {
            this.saving = false;
            const msg =
              err?.error?.error ||
              err?.error?.message ||
              this.translate.instant('tr_unexpected_error_message');
            this.notify.push(msg, 'error');
          },
        });
      return;
    }

    if (
      this.unitCodeOptions.length > 1 &&
      !this.returnAll &&
      this.selectedUnitCodes.size > 0 &&
      this.selectedUnitCodes.size !== this.purchaseQty
    ) {
      this.notify.push(this.translate.instant('tr_invoice_return_units_count_mismatch'), 'error');
      return;
    }

    this.saving = true;
    this.purchaseApi
      .returnPurchase(String(this.purchase?._id), {
        userId: u?._id,
        branchId: this.paymentBranchId || undefined,
        note: this.note,
        returnAll: this.returnAll,
        quantity: this.returnAll ? undefined : this.purchaseQty,
        unitRefundPrice: this.purchaseUnitPrice,
        ...cashPayload,
        returnedProductIds:
          this.unitCodeOptions.length > 1 && !this.returnAll
            ? Array.from(this.selectedUnitCodes)
            : undefined,
      })
      .subscribe({
        next: () => {
          this.saving = false;
          this.notify.push(this.translate.instant('tr_invoice_return_purchase_ok'), 'success');
          this.ref.close(true);
        },
        error: (err) => {
          this.saving = false;
          const msg =
            err?.error?.error ||
            err?.error?.message ||
            this.translate.instant('tr_unexpected_error_message');
          this.notify.push(msg, 'error');
        },
      });
  }

  close(): void {
    this.ref.close(false);
  }
}
