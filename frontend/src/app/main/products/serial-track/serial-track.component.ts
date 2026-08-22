import { Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  ProductHistoryEvent,
  ProductSerialTrackResponse,
} from '@core/models/products.model';
import { Globals } from '@core/globals';
import { isModerator } from '@core/utils/role-utils';
import { formatCairoDateTime } from '@core/utils/date-tz.util';
import { TranslateService } from '@ngx-translate/core';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { InvoiceReprintService } from '@shared/services/invoice-reprint.service';
import { OrdersSerivce } from '@shared/services/orders.service';
import { ProductsSerivce } from '@shared/services/products.service';
import { Subscription } from 'rxjs';

export type SerialTrackDetailPart = {
  text: string;
  orderId?: string;
  orderNumber?: string;
  isOrderLink?: boolean;
};

type EventRow = {
  event: ProductHistoryEvent;
  parts: SerialTrackDetailPart[];
  orderId?: string;
  orderNumber?: string;
};

@Component({
  selector: 'app-serial-track',
  templateUrl: './serial-track.component.html',
  styleUrls: ['./serial-track.component.scss'],
})
export class SerialTrackComponent implements OnInit, OnDestroy {
  @ViewChild('codeInput') codeInput?: ElementRef<HTMLInputElement>;

  code = '';
  loading = false;
  openingOrder = false;
  searched = false;
  result: ProductSerialTrackResponse | null = null;
  eventRows: EventRow[] = [];
  showProductsLink = true;

  private querySub?: Subscription;
  private lastAutoCode = '';

  constructor(
    private productsService: ProductsSerivce,
    private ordersService: OrdersSerivce,
    private invoiceReprint: InvoiceReprintService,
    private translate: TranslateService,
    private notify: AppNotificationService,
    private router: Router,
    private route: ActivatedRoute,
    private globals: Globals
  ) {}

  ngOnInit(): void {
    if (isModerator(this.globals.currentUser?.role)) {
      this.router.navigate(['/products']);
      return;
    }
    this.showProductsLink = this.globals.currentUser?.role !== 'Cashier';
    this.querySub = this.route.queryParamMap.subscribe((params) => {
      const code = String(params.get('code') || '').trim();
      if (code) {
        if (code !== this.lastAutoCode || !this.searched) {
          this.lastAutoCode = code;
          this.code = code;
          this.search();
        }
        return;
      }
      this.lastAutoCode = '';
      setTimeout(() => this.focusCodeInput(), 0);
    });
  }

  ngOnDestroy(): void {
    this.querySub?.unsubscribe();
  }

  goToProducts(): void {
    this.router.navigate(['/products']);
  }

  clear(): void {
    this.code = '';
    this.result = null;
    this.eventRows = [];
    this.searched = false;
    this.lastAutoCode = '';
    if (this.route.snapshot.queryParamMap.get('code')) {
      this.router.navigate(['/products/serial-track'], { queryParams: {} });
    }
    setTimeout(() => this.focusCodeInput(), 0);
  }

  private focusCodeInput(): void {
    const el = this.codeInput?.nativeElement;
    if (!el) return;
    el.focus();
    el.select();
  }

  search(): void {
    const code = String(this.code || '').trim();
    if (!code) {
      this.notify.push(this.translate.instant('tr_serial_track_code_required'), 'error');
      return;
    }

    this.loading = true;
    this.searched = true;
    this.result = null;
    this.eventRows = [];

    this.productsService.trackProductSerial(code).subscribe({
      next: (res) => {
        this.result = res;
        this.eventRows = (res?.events || []).map((event) => this.buildEventRow(event));
        this.loading = false;
        setTimeout(() => this.focusCodeInput(), 0);
      },
      error: (err) => {
        this.loading = false;
        this.result = null;
        this.eventRows = [];
        const msg =
          err?.error?.error ||
          this.translate.instant('tr_serial_track_not_found');
        this.notify.push(msg, 'error');
        setTimeout(() => this.focusCodeInput(), 0);
      },
    });
  }

  formatWhen(value: string): string {
    return formatCairoDateTime(value);
  }

  eventTypeLabel(type: string): string {
    const key = `tr_product_history_type_${type}`;
    const translated = this.translate.instant(key);
    return translated !== key ? translated : type;
  }

  private buildEventRow(event: ProductHistoryEvent): EventRow {
    const parts = this.buildDetailParts(event);
    const orderPart = parts.find((p) => p.isOrderLink);
    return {
      event,
      parts,
      orderId: orderPart?.orderId,
      orderNumber: orderPart?.orderNumber,
    };
  }

  private buildDetailParts(event: ProductHistoryEvent): SerialTrackDetailPart[] {
    const d = event.details || {};
    const parts: SerialTrackDetailPart[] = [];

    const orderIdRaw = d['orderId'];
    const orderNumberRaw = d['orderNumber'];
    let orderId =
      orderIdRaw != null && String(orderIdRaw).trim()
        ? String(orderIdRaw).trim()
        : undefined;
    let orderNumber =
      orderNumberRaw != null && String(orderNumberRaw).trim()
        ? String(orderNumberRaw).trim()
        : undefined;

    // Fallback: summary like "#123"
    if (!orderNumber && event.summary) {
      const m = String(event.summary).match(/#\s*(\d+)/);
      if (m) orderNumber = m[1];
    }

    if (d['quantity'] != null) {
      parts.push({
        text: `${this.translate.instant('tr_quantity')}: ${d['quantity']}`,
      });
    }
    if (orderNumber) {
      parts.push({
        text: `${this.translate.instant('tr_order_number')}: #${orderNumber}`,
        orderId,
        orderNumber,
        isOrderLink: true,
      });
    }
    if (d['clientName']) {
      parts.push({
        text: `${this.translate.instant('tr_client')}: ${d['clientName']}`,
      });
    }
    if (d['customerName']) {
      parts.push({
        text: `${this.translate.instant('tr_client')}: ${d['customerName']}`,
      });
    }
    if (d['fromBranch'] && d['toBranch']) {
      parts.push({ text: `${d['fromBranch']} → ${d['toBranch']}` });
    } else if (d['branch']) {
      parts.push({ text: String(d['branch']) });
    }
    if (d['approvedBy']) {
      parts.push({
        text: `${this.translate.instant('tr_product_history_approved_by')}: ${d['approvedBy']}`,
      });
    } else if (d['rejectedBy']) {
      parts.push({
        text: `${this.translate.instant('tr_product_history_rejected_by')}: ${d['rejectedBy']}`,
      });
    } else if (d['initiatedBy'] && event.type === 'branch_transfer_requested') {
      parts.push({
        text: `${this.translate.instant('tr_product_history_requested_by')}: ${d['initiatedBy']}`,
      });
    }
    if (d['refundTotal'] != null) {
      parts.push({
        text: `${this.translate.instant('tr_refund_amount')} ${d['refundTotal']}`,
      });
    }
    if (d['price'] != null && d['lineTotal'] != null) {
      parts.push({ text: `${d['lineTotal']} EGP` });
    }
    if (d['paymentMethod']) {
      parts.push({ text: String(d['paymentMethod']) });
    }
    if (d['cancelReason']) {
      parts.push({ text: String(d['cancelReason']) });
    }
    if (d['rejectReason']) {
      parts.push({ text: String(d['rejectReason']) });
    }
    if (d['resolutionNote']) {
      parts.push({ text: String(d['resolutionNote']) });
    }
    if (d['notes']) {
      parts.push({ text: String(d['notes']) });
    }
    if (d['acquiredFrom']) {
      parts.push({ text: String(d['acquiredFrom']) });
    }
    if (d['reason']) {
      parts.push({ text: String(d['reason']) });
    }

    if (!parts.length && event.summary) {
      return [{ text: event.summary }];
    }
    return parts;
  }

  openOrder(orderId?: string, orderNumber?: string): void {
    if (this.openingOrder) return;

    const id = orderId ? String(orderId).trim() : '';
    const number = orderNumber ? String(orderNumber).trim() : '';

    if (!id && !number) {
      this.notify.push(
        this.translate.instant('tr_unexpected_error_message'),
        'error'
      );
      return;
    }

    // Prefer opening the invoice here (works even if /orders is blocked for the role).
    if (id) {
      this.openingOrder = true;
      this.ordersService.getOrder(id).subscribe({
        next: (full: any) => {
          this.openingOrder = false;
          const order = full?.order || full;
          if (!order) {
            this.notify.push(
              this.translate.instant('tr_unexpected_error_message'),
              'error'
            );
            return;
          }
          this.invoiceReprint.printSale(order);
        },
        error: () => {
          this.openingOrder = false;
          // Fallback: go to invoices list filtered by order number
          this.goToOrders(id, number);
        },
      });
      return;
    }

    this.goToOrders(id, number);
  }

  private goToOrders(orderId: string, orderNumber: string): void {
    const queryParams: { search?: string; printOrderId?: string } = {};
    if (orderId) queryParams.printOrderId = orderId;
    if (orderNumber) queryParams.search = orderNumber;

    this.router.navigate(['/orders'], { queryParams }).then((ok) => {
      if (!ok) {
        this.notify.push(
          this.translate.instant('tr_unexpected_error_message'),
          'error'
        );
      }
    });
  }

  productLocation(): string {
    const locations = this.locationRows();
    if (locations.length > 1) {
      return this.translate.instant('tr_serial_track_locations_count', {
        count: locations.length,
      });
    }
    const p = this.result?.product;
    if (!p) return '—';
    if (p.inWarehouse) {
      return this.translate.instant('tr_warehouse');
    }
    return p.branch?.name || '—';
  }

  totalStock(): number {
    if (this.result?.totalStock != null) {
      return Number(this.result.totalStock) || 0;
    }
    return this.locationRows().reduce((sum, row) => sum + (Number(row.stock) || 0), 0);
  }

  locationRows(): NonNullable<ProductSerialTrackResponse['locations']> {
    const rows = this.result?.locations || [];
    return rows.filter((row) => !row.removedWhenOutOfStock);
  }

  hasMultipleLocations(): boolean {
    return this.locationRows().length > 1;
  }

  locationLabel(row: NonNullable<ProductSerialTrackResponse['locations']>[number]): string {
    if (row.inWarehouse) {
      return this.translate.instant('tr_warehouse');
    }
    return row.branchName || '—';
  }

  statusLabel(): string {
    const status = this.result?.status;
    if (!status) return '';
    const key = `tr_serial_track_status_${status}`;
    const translated = this.translate.instant(key);
    return translated !== key ? translated : status;
  }

  isRemoved(): boolean {
    return this.result?.status === 'removed_from_stock' || !this.result?.exists;
  }

  attributeEntries(): Array<{ key: string; value: string }> {
    const attrs = this.result?.product?.attributes as
      | Record<string, string>
      | undefined;
    if (!attrs || typeof attrs !== 'object') return [];
    return Object.keys(attrs)
      .map((key) => ({ key, value: String(attrs[key] ?? '').trim() }))
      .filter((row) => row.value);
  }
}
