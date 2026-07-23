import { Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { Router } from '@angular/router';
import {
  ProductHistoryEvent,
  ProductSerialTrackResponse,
} from '@core/models/products.model';
import { Globals } from '@core/globals';
import { formatCairoDateTime } from '@core/utils/date-tz.util';
import { TranslateService } from '@ngx-translate/core';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { ProductsSerivce } from '@shared/services/products.service';

@Component({
  selector: 'app-serial-track',
  templateUrl: './serial-track.component.html',
  styleUrls: ['./serial-track.component.scss'],
})
export class SerialTrackComponent implements OnInit {
  @ViewChild('codeInput') codeInput?: ElementRef<HTMLInputElement>;

  code = '';
  loading = false;
  searched = false;
  result: ProductSerialTrackResponse | null = null;
  showProductsLink = true;

  constructor(
    private productsService: ProductsSerivce,
    private translate: TranslateService,
    private notify: AppNotificationService,
    private router: Router,
    private globals: Globals
  ) {}

  ngOnInit(): void {
    this.showProductsLink = this.globals.currentUser?.role !== 'Cashier';
    setTimeout(() => this.focusCodeInput(), 0);
  }

  goToProducts(): void {
    this.router.navigate(['/products']);
  }

  clear(): void {
    this.code = '';
    this.result = null;
    this.searched = false;
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

    this.productsService.trackProductSerial(code).subscribe({
      next: (res) => {
        this.result = res;
        this.loading = false;
        setTimeout(() => this.focusCodeInput(), 0);
      },
      error: (err) => {
        this.loading = false;
        this.result = null;
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

  eventDetails(event: ProductHistoryEvent): string {
    const d = event.details || {};
    const parts: string[] = [];

    if (d['quantity'] != null) {
      parts.push(`${this.translate.instant('tr_quantity')}: ${d['quantity']}`);
    }
    if (d['orderNumber'] != null) {
      parts.push(
        `${this.translate.instant('tr_order_number')}: #${d['orderNumber']}`
      );
    }
    if (d['clientName']) {
      parts.push(`${this.translate.instant('tr_client')}: ${d['clientName']}`);
    }
    if (d['customerName']) {
      parts.push(`${this.translate.instant('tr_client')}: ${d['customerName']}`);
    }
    if (d['fromBranch'] && d['toBranch']) {
      parts.push(`${d['fromBranch']} → ${d['toBranch']}`);
    } else if (d['branch']) {
      parts.push(String(d['branch']));
    }
    if (d['refundTotal'] != null) {
      parts.push(
        `${this.translate.instant('tr_refund_amount')} ${d['refundTotal']}`
      );
    }
    if (d['price'] != null && d['lineTotal'] != null) {
      parts.push(`${d['lineTotal']} EGP`);
    }
    if (d['paymentMethod']) {
      parts.push(String(d['paymentMethod']));
    }
    if (d['cancelReason']) {
      parts.push(String(d['cancelReason']));
    }
    if (d['rejectReason']) {
      parts.push(String(d['rejectReason']));
    }
    if (d['resolutionNote']) {
      parts.push(String(d['resolutionNote']));
    }
    if (d['notes']) {
      parts.push(String(d['notes']));
    }
    if (d['acquiredFrom']) {
      parts.push(String(d['acquiredFrom']));
    }
    if (d['reason']) {
      parts.push(String(d['reason']));
    }

    if (!parts.length && event.summary) {
      return event.summary;
    }
    return parts.join(' · ');
  }

  productLocation(): string {
    const p = this.result?.product;
    if (!p) return '—';
    if (p.inWarehouse) {
      return this.translate.instant('tr_warehouse');
    }
    return p.branch?.name || '—';
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
