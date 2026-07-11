import { Component, Inject, OnInit } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { Globals } from '@core/globals';
import { Product } from '@core/models/products.model';
import { isModerator } from '@core/utils/role-utils';
import { AppNotificationService } from '@shared/services/app-notification.service';
import {
  ProductsInventoryAuditResponse,
  ProductsSerivce,
} from '@shared/services/products.service';
import { ReportExportService } from '@shared/services/report-export.service';

export type ProductInventoryAuditDialogData = {
  filterParams: Record<string, string | boolean>;
  searchLabel?: string;
};

@Component({
  selector: 'app-product-inventory-audit-dialog',
  templateUrl: './product-inventory-audit-dialog.component.html',
  styleUrls: ['./product-inventory-audit-dialog.component.scss'],
})
export class ProductInventoryAuditDialogComponent implements OnInit {
  loading = true;
  exporting = false;
  audit: ProductsInventoryAuditResponse | null = null;

  constructor(
    private productsService: ProductsSerivce,
    private exportService: ReportExportService,
    private translate: TranslateService,
    private notify: AppNotificationService,
    private globals: Globals,
    private ref: MatDialogRef<ProductInventoryAuditDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: ProductInventoryAuditDialogData
  ) {}

  ngOnInit(): void {
    this.loadAudit();
  }

  get showNetPrice(): boolean {
    return !isModerator(this.globals.currentUser?.role);
  }

  loadAudit(): void {
    this.loading = true;
    this.productsService.getProductsInventoryAudit(this.data.filterParams).subscribe({
      next: (res) => {
        this.audit = res;
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

  locationLabel(row: ProductsInventoryAuditResponse['byLocation'][number]): string {
    if (row.inWarehouse) {
      return this.translate.instant('tr_warehouse');
    }
    return row.branchName || '—';
  }

  searchSummary(): string {
    const fromApi = String(this.audit?.search || '').trim();
    const fromDialog = String(this.data.searchLabel || '').trim();
    return fromApi || fromDialog || this.translate.instant('tr_products_inventory_audit_all_products');
  }

  exportSummaryExcel(): void {
    if (!this.audit || this.exporting) {
      return;
    }
    const locationCol = this.translate.instant('tr_location');
    const productsCol = this.translate.instant('tr_products_inventory_audit_products_count');
    const stockCol = this.translate.instant('tr_stock');
    const bookedCol = this.translate.instant('tr_booked');
    const availableCol = this.translate.instant('tr_available');
    const capitalCol = this.translate.instant('tr_report_col_inventory_capital');

    const rows = (this.audit.byLocation || []).map((row) => {
      const out: Record<string, string | number> = {
        [locationCol]: this.locationLabel(row),
        [productsCol]: row.productsCount,
        [stockCol]: row.totalStock,
        [bookedCol]: row.totalBooked,
        [availableCol]: row.totalAvailable,
      };
      if (this.showNetPrice) {
        out[capitalCol] = row.inventoryCapital ?? 0;
      }
      return out;
    });

    const totalRow: Record<string, string | number> = {
      [locationCol]: this.translate.instant('tr_total'),
      [productsCol]: this.audit.totals.productsCount,
      [stockCol]: this.audit.totals.totalStock,
      [bookedCol]: this.audit.totals.totalBooked,
      [availableCol]: this.audit.totals.totalAvailable,
    };
    if (this.showNetPrice) {
      totalRow[capitalCol] = this.audit.totals.inventoryCapital ?? 0;
    }
    rows.push(totalRow);

    const filename = `inventory_audit_summary_${new Date().toISOString().slice(0, 10)}`;
    this.exportService.exportToExcel(filename, rows);
  }

  exportProductsExcel(): void {
    if (!this.audit || this.exporting) {
      return;
    }
    this.exporting = true;
    const limit = Math.max(Number(this.audit.totals.productsCount) || 0, 1);
    this.productsService
      .getProducts({
        ...this.data.filterParams,
        page: 1,
        limit,
      })
      .subscribe({
        next: (res: any) => {
          const products = (res?.products || []) as Product[];
          const rows = products.map((p) => this.mapProductExportRow(p));
          const filename = `inventory_audit_products_${new Date().toISOString().slice(0, 10)}`;
          this.exportService.exportToExcel(filename, rows);
          this.exporting = false;
        },
        error: () => {
          this.exporting = false;
          this.notify.push(this.translate.instant('tr_unexpected_error_message'), 'error');
        },
      });
  }

  private mapProductExportRow(product: Product): Record<string, string | number> {
    const stock = Math.max(0, Number(product.stock) || 0);
    const booked = Math.max(0, Math.floor(Number(product.bookedQuantity) || 0));
    const transferReserved = Math.max(0, Math.floor(Number(product.transferReservedQuantity) || 0));
    const available = Math.max(0, stock - booked - transferReserved);
    const location = product.inWarehouse
      ? this.translate.instant('tr_warehouse')
      : product.branch?.name || '—';

    const row: Record<string, string | number> = {
      [this.translate.instant('tr_name')]: product.name || '',
      [this.translate.instant('tr_code')]: product.code || '',
      [this.translate.instant('tr_category')]: product.category?.name || '',
      [this.translate.instant('tr_location')]: location,
      [this.translate.instant('tr_product_source_party')]:
        String(product.acquiredFrom?.displayName || '').trim() || '—',
      [this.translate.instant('tr_stock')]: stock,
      [this.translate.instant('tr_booked')]: booked,
      [this.translate.instant('tr_available')]: available,
      [this.translate.instant('tr_price')]: Number(product.price) || 0,
      [this.translate.instant('tr_discount')]: Number(product.discount) || 0,
    };

    if (this.showNetPrice) {
      row[this.translate.instant('tr_net_price')] = Number(product.netPrice) || 0;
    }

    const attrs = product.attributes || {};
    const attrSummary = Object.keys(attrs)
      .filter((k) => attrs[k] != null && String(attrs[k]).trim() !== '')
      .map((k) => `${k}: ${String(attrs[k]).trim()}`)
      .join(' • ');
    row[this.translate.instant('tr_category_attributes')] = attrSummary || '—';

    return row;
  }
}
