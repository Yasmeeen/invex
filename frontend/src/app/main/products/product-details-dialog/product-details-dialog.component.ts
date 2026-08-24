import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Product } from '@core/models/products.model';
import { Globals } from '@core/globals';
import { TranslateService } from '@ngx-translate/core';
import { StoreSettingsService } from '@shared/services/store-settings.service';

export type ProductDetailsDialogData = {
  product: Product;
  /** When true, show an "Add to order" action (cashier). */
  allowAddToOrder?: boolean;
};

export type ProductDetailsDialogResult = 'add' | undefined;

@Component({
  selector: 'app-product-details-dialog',
  templateUrl: './product-details-dialog.component.html',
  styleUrls: ['./product-details-dialog.component.scss'],
})
export class ProductDetailsDialogComponent {
  constructor(
    private ref: MatDialogRef<ProductDetailsDialogComponent, ProductDetailsDialogResult>,
    private translate: TranslateService,
    private globals: Globals,
    private storeSettings: StoreSettingsService,
    @Inject(MAT_DIALOG_DATA) public data: ProductDetailsDialogData
  ) {}

  get product(): Product {
    return this.data.product;
  }

  get showNetPrice(): boolean {
    return this.storeSettings.canSeeCostPrice(this.globals.currentUser?.role);
  }

  get allowAddToOrder(): boolean {
    return !!this.data.allowAddToOrder;
  }

  close(): void {
    this.ref.close();
  }

  addToOrder(): void {
    this.ref.close('add');
  }

  locationLabel(): string {
    if (this.product?.inWarehouse) {
      return this.translate.instant('tr_warehouse');
    }
    return this.product?.branch?.name || '—';
  }

  hasDiscount(): boolean {
    return (Number(this.product?.discount) || 0) > 0;
  }

  discountedPrice(): number {
    const p = Number(this.product?.price) || 0;
    const d = Number(this.product?.discount) || 0;
    if (d <= 0) return p;
    return Math.round((p - (p * d) / 100) * 100) / 100;
  }

  bookedQty(): number {
    const confirmed = Number(this.product?.confirmedBookedQuantity);
    if (Number.isFinite(confirmed) && confirmed > 0) return confirmed;
    return Math.max(0, Number(this.product?.bookedQuantity) || 0);
  }

  freeSellableQty(): number {
    const stock = Number(this.product?.stock) || 0;
    return Math.max(0, stock - this.bookedQty());
  }

  remotePickupHint(): string {
    const rows = this.product?.remotePickupTransfers || [];
    if (!rows.length) {
      return '';
    }
    if (rows.length === 1) {
      return this.translate.instant('tr_booking_needs_transfer_one', {
        branch: rows[0].branchName || '',
        n: rows[0].quantity,
      });
    }
    const branches = rows
      .map((r) => r.branchName)
      .filter(Boolean)
      .join('، ');
    return this.translate.instant('tr_booking_needs_transfer_many', { branches });
  }

  attributeRows(): Array<{ label: string; value: string }> {
    const attrs = this.normalizeAttributes(this.product?.attributes);
    const defs = Array.isArray(this.product?.category?.attributeDefs)
      ? this.product.category.attributeDefs
      : [];
    const rows: Array<{ label: string; value: string }> = [];
    const seen = new Set<string>();

    for (const def of defs) {
      const key =
        typeof def === 'string'
          ? String(def || '').trim()
          : String(def?.key || '').trim();
      if (!key) continue;
      const label =
        typeof def === 'object' && def
          ? String(def.label || '').trim() || key
          : key;
      const value = String(attrs[key] ?? '').trim();
      if (!value) continue;
      seen.add(key);
      rows.push({ label, value });
    }

    for (const key of Object.keys(attrs)) {
      if (seen.has(key)) continue;
      const value = String(attrs[key] ?? '').trim();
      if (!value) continue;
      rows.push({ label: key, value });
    }

    return rows;
  }

  sourcePartyLabel(): string {
    const t = this.product?.acquiredFrom?.partyType;
    if (t === 'supplier') return this.translate.instant('tr_party_supplier');
    if (t === 'client') return this.translate.instant('tr_party_client');
    return '';
  }

  sourceDisplayName(): string {
    const a = this.product?.acquiredFrom;
    if (!a) return '';
    return String(a.displayName || a.name || '').trim();
  }

  hasSource(): boolean {
    return !!(this.sourceDisplayName() || this.product?.acquiredFrom?.phone);
  }

  private normalizeAttributes(
    raw: Record<string, string> | Map<string, string> | undefined | null
  ): Record<string, string> {
    if (!raw) return {};
    if (raw instanceof Map) {
      const out: Record<string, string> = {};
      raw.forEach((v, k) => {
        out[String(k)] = String(v ?? '');
      });
      return out;
    }
    return raw as Record<string, string>;
  }
}
