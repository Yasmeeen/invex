import { Component, Inject, OnInit } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { AppNotificationService } from '@shared/services/app-notification.service';
import {
  ProductsInventoryAuditResponse,
  ProductsSerivce,
} from '@shared/services/products.service';

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
  audit: ProductsInventoryAuditResponse | null = null;

  constructor(
    private productsService: ProductsSerivce,
    private translate: TranslateService,
    private notify: AppNotificationService,
    private ref: MatDialogRef<ProductInventoryAuditDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: ProductInventoryAuditDialogData
  ) {}

  ngOnInit(): void {
    this.loadAudit();
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
}
