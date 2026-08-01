import { Component, Inject, OnInit } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Product, ProductHistoryEvent, ProductHistoryResponse } from '@core/models/products.model';
import { formatCairoDateTime } from '@core/utils/date-tz.util';
import { TranslateService } from '@ngx-translate/core';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { ProductsSerivce } from '@shared/services/products.service';

export type ProductHistoryDialogData = { product: Product };

@Component({
  selector: 'app-product-history-dialog',
  templateUrl: './product-history-dialog.component.html',
  styleUrls: ['./product-history-dialog.component.scss'],
})
export class ProductHistoryDialogComponent implements OnInit {
  loading = true;
  history: ProductHistoryResponse | null = null;

  constructor(
    private productsService: ProductsSerivce,
    private translate: TranslateService,
    private notify: AppNotificationService,
    private ref: MatDialogRef<ProductHistoryDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: ProductHistoryDialogData
  ) {}

  ngOnInit(): void {
    this.loadHistory();
  }

  loadHistory(): void {
    const id = this.data.product?._id;
    if (!id) return;
    this.loading = true;
    this.productsService.getProductHistory(String(id)).subscribe({
      next: (res) => {
        this.history = res;
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.notify.push(this.translate.instant('tr_unexpected_error_message'), 'error');
      },
    });
  }

  close(): void {
    this.ref.close();
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
      parts.push(
        `${this.translate.instant('tr_quantity')}: ${d['quantity']}`
      );
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
    if (d['approvedBy']) {
      parts.push(
        `${this.translate.instant('tr_product_history_approved_by')}: ${d['approvedBy']}`
      );
    } else if (d['rejectedBy']) {
      parts.push(
        `${this.translate.instant('tr_product_history_rejected_by')}: ${d['rejectedBy']}`
      );
    } else if (d['initiatedBy'] && event.type === 'branch_transfer_requested') {
      parts.push(
        `${this.translate.instant('tr_product_history_requested_by')}: ${d['initiatedBy']}`
      );
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

    if (!parts.length && event.summary) {
      return event.summary;
    }
    return parts.join(' · ');
  }

  productLocation(): string {
    const p = this.history?.product || this.data.product;
    if (p?.inWarehouse) {
      return this.translate.instant('tr_warehouse');
    }
    return p?.branch?.name || '—';
  }
}
