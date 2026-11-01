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
  buildCashierPaymentMethods,
  CashierPaymentMethod,
  paymentMethodDisplayLabel,
} from '@shared/utils/cashier-payment-methods.util';
import {
  buildPurchaseRefundPreview,
  buildSalesRefundPreview,
  RefundAllocationRow,
} from '@shared/utils/invoice-return-refund.util';
import { daysSince } from '@core/utils/date-tz.util';
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
  refundMethodOptions: CashierPaymentMethod[] = [];
  selectedRefundMethods: string[] = [];
  refundAmounts: Record<string, number> = {};
  private splitsDirty = false;
  private lastAllocatable = -1;
  treasuryMethodOptions: { key: string; label: string }[] = [];
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

  get lockedRefundRows(): RefundAllocationRow[] {
    return this.refundPreview.filter((row) => row.kind === 'credit' || row.kind === 'deferred');
  }

  get allocatableAmount(): number {
    const locked = this.lockedRefundRows.reduce((sum, row) => sum + row.amount, 0);
    return Math.round(Math.max(0, this.refundTotal - locked) * 100) / 100;
  }

  get showRefundMethods(): boolean {
    return this.allocatableAmount > 0.005;
  }

  get refundAllocated(): number {
    return Math.round(
      this.selectedRefundMethods.reduce((sum, id) => sum + (Number(this.refundAmounts[id]) || 0), 0) * 100
    ) / 100;
  }

  get refundAllocationMismatch(): boolean {
    return this.showRefundMethods && Math.abs(this.refundAllocated - this.allocatableAmount) > 0.02;
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
        this.refundMethodLabel(key, fallback)
      );
    }
    this.syncRefundSplitDefaults();
  }

  onSelectedRefundMethodsChange(ids: string[]): void {
    this.splitsDirty = true;
    const next = (ids || []).map((id) => String(id || '').trim().toLowerCase()).filter(Boolean);
    const amounts: Record<string, number> = {};
    for (const id of next) {
      amounts[id] = Number(this.refundAmounts[id]) || 0;
    }
    this.selectedRefundMethods = next;
    this.refundAmounts = amounts;
    if (next.length === 1) {
      this.refundAmounts = { [next[0]]: this.allocatableAmount };
    }
  }

  onRefundAmountChange(): void {
    this.splitsDirty = true;
  }

  refundMethodLabel(key: string, fallback?: string): string {
    const id = String(key || '').trim().toLowerCase();
    const fromPay = this.refundMethodOptions.find((m) => m.id === id);
    if (fromPay) return fromPay.label;
    return (
      paymentMethodDisplayLabel(id, this.storeSettings.snapshot.paymentAppFeePercents, this.translate) ||
      this.treasuryMethodOptions.find((o) => o.key === id)?.label ||
      fallback ||
      id
    );
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
    const snap = this.storeSettings.snapshot;
    const m = snap.purchaseTreasuryMethods;
    const raw = Array.isArray(m) && m.length ? m : [{ key: 'cash', label: 'Cash' }];
    this.treasuryMethodOptions = raw
      .map((x) => ({
        key: String(x.key || '').trim().toLowerCase(),
        label: String(x.label || x.key || '').trim(),
      }))
      .filter((o) => o.key && o.key !== 'deferred');

    this.refundMethodOptions = buildCashierPaymentMethods(
      snap.paymentAppFeePercents,
      this.translate,
      snap.paymentMethodsCatalog,
      this.paymentBranchId,
      {
        accountMap: snap.paymentMethodAccountMap,
        moneyAccounts: snap.moneyAccounts,
      }
    ).filter((method) => method.id !== 'credit' && method.id !== 'installment');
    this.ensureSelectedRefundMethodsListed();
  }

  private syncRefundSplitDefaults(): void {
    const alloc = this.allocatableAmount;
    if (this.splitsDirty && Math.abs(alloc - this.lastAllocatable) <= 0.009) return;
    this.applyMirrorPrefill();
    this.splitsDirty = false;
    this.lastAllocatable = alloc;
  }

  private applyMirrorPrefill(): void {
    if (this.allocatableAmount <= 0.005) {
      this.selectedRefundMethods = [];
      this.refundAmounts = {};
      return;
    }
    const rows = this.refundPreview.filter((row) => row.kind === 'payment' || row.kind === 'treasury');
    const allowed = new Set(this.refundMethodOptions.map((method) => method.id));
    allowed.add('cash');
    const amounts: Record<string, number> = {};
    let placed = 0;
    for (const row of rows) {
      const key = String(row.key || '').trim().toLowerCase();
      if (!key || !allowed.has(key)) continue;
      const amount = Math.round(row.amount * 100) / 100;
      if (amount <= 0) continue;
      amounts[key] = Math.round(((amounts[key] || 0) + amount) * 100) / 100;
      placed = Math.round((placed + amount) * 100) / 100;
    }
    const leftover = Math.round((this.allocatableAmount - placed) * 100) / 100;
    if (leftover > 0.009) {
      amounts.cash = Math.round(((amounts.cash || 0) + leftover) * 100) / 100;
    }
    const ids = Object.keys(amounts).filter((key) => amounts[key] > 0);
    this.selectedRefundMethods = ids.length ? ids : ['cash'];
    this.refundAmounts = ids.length ? amounts : { cash: this.allocatableAmount };
    this.ensureSelectedRefundMethodsListed();
  }

  private ensureSelectedRefundMethodsListed(): void {
    const known = new Set(this.refundMethodOptions.map((m) => m.id));
    const extras: CashierPaymentMethod[] = [];
    for (const id of this.selectedRefundMethods) {
      if (known.has(id)) continue;
      extras.push({
        id,
        label: this.refundMethodLabel(id),
        logo: 'assets/images/payment/cash.svg',
      });
    }
    if (extras.length) {
      this.refundMethodOptions = this.refundMethodOptions.concat(extras);
    }
  }

  private buildRefundSplits(): { method: string; label: string; amount: number }[] {
    return this.selectedRefundMethods
      .map((id) => ({
        method: id,
        label: this.refundMethodLabel(id),
        amount: Math.round((Number(this.refundAmounts[id]) || 0) * 100) / 100,
      }))
      .filter((row) => row.method && row.amount > 0);
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

  private validateRefundSplits(): boolean {
    if (!this.showRefundMethods) return true;
    if (!this.selectedRefundMethods.length || this.refundAllocationMismatch) {
      this.notify.push(this.translate.instant('tr_invoice_return_refund_mismatch'), 'error');
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
    if (!this.validateRefundSplits()) return;

    const u = this.auth.getUserFromLocalStorage();
    const splits = this.showRefundMethods ? this.buildRefundSplits() : [];

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
          refundPaymentSplits: splits.length ? splits : undefined,
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
        refundTreasurySplits: splits.length
          ? splits.map((row) => ({ key: row.method, label: row.label, amount: row.amount }))
          : undefined,
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
