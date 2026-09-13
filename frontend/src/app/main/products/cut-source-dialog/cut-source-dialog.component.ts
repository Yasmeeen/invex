import { Component, Inject, OnInit } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Product } from '@core/models/products.model';
import { TranslateService } from '@ngx-translate/core';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { ProductsSerivce } from '@shared/services/products.service';

export interface CutSourceDialogData {
  product: Product;
}

@Component({
  selector: 'app-cut-source-dialog',
  templateUrl: './cut-source-dialog.component.html',
  styleUrls: ['./cut-source-dialog.component.scss'],
})
export class CutSourceDialogComponent implements OnInit {
  saving = false;
  loading = false;
  candidates: Product[] = [];
  selectedSourceProductId: string | null = null;

  constructor(
    private dialogRef: MatDialogRef<CutSourceDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public data: CutSourceDialogData,
    private products: ProductsSerivce,
    private notify: AppNotificationService,
    private translate: TranslateService
  ) {}

  ngOnInit(): void {
    this.selectedSourceProductId = this.currentSourceId();
    this.loadCandidates();
  }

  get product(): Product {
    return this.data?.product;
  }

  get categoryId(): string {
    const c = this.product?.category;
    if (!c) return '';
    return typeof c === 'object' ? String((c as { _id?: string })._id || '') : String(c);
  }

  get categoryName(): string {
    const c = this.product?.category;
    return c && typeof c === 'object' ? String((c as { name?: string }).name || '') : '';
  }

  get branchId(): string {
    const b = this.product?.branch;
    if (!b) return '';
    return typeof b === 'object' ? String((b as { _id?: string })._id || '') : String(b);
  }

  close(): void {
    this.dialogRef.close(false);
  }

  stockLabel(p: Product): string {
    const n = Number(p?.stock);
    const stock = Number.isFinite(n) ? n : 0;
    return `${this.translate.instant('tr_stock')}: ${stock}`;
  }

  loadCandidates(): void {
    if (!this.categoryId) {
      this.candidates = [];
      return;
    }

    // Same as create-edit: include soft-removed / zero-stock rows so linking is a
    // setup step before stock is added. Location is applied client-side.
    const params: Record<string, string | number> = {
      page: 1,
      limit: 1000,
      categoryId: this.categoryId,
      includeRemoved: 'true',
    };
    if (this.product?.inWarehouse) {
      params.warehouseOnly = 'true';
    } else if (this.branchId) {
      params.branchId = this.branchId;
    }

    this.loading = true;
    this.products.getProducts(params).subscribe({
      next: (res: { products?: Product[] }) => {
        const rows = (res?.products || [])
          .filter((p) => this.isCandidate(p))
          .sort((a, b) =>
            String(a?.name || '').localeCompare(String(b?.name || ''), 'ar')
          );
        this.candidates = this.ensureSelectedInList(rows);
        this.loading = false;
      },
      error: () => {
        this.candidates = this.ensureSelectedInList([]);
        this.loading = false;
        this.notify.push(this.translate.instant('tr_unexpected_error_message'), 'error');
      },
    });
  }

  submit(): void {
    if (this.saving || !this.product?._id) return;
    this.saving = true;
    this.products
      .updateProductSource(String(this.product._id), this.selectedSourceProductId || null)
      .subscribe({
        next: () => {
          this.saving = false;
          this.notify.push(this.translate.instant('tr_cut_source_saved'), 'success');
          this.dialogRef.close(true);
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

  private currentSourceId(): string | null {
    const populated = this.product?.sourceProduct;
    if (populated && typeof populated === 'object' && populated._id) {
      return String(populated._id);
    }
    const raw = this.product?.sourceProductId;
    if (!raw) return null;
    if (typeof raw === 'object' && (raw as { _id?: string })._id) {
      return String((raw as { _id: string })._id);
    }
    return String(raw);
  }

  /** Match create-edit: all goods in category/location, including stock 0. */
  private isCandidate(p: Product): boolean {
    if (!p?._id || String(p._id) === String(this.product?._id)) return false;
    const t = String(p.productType || 'good').toLowerCase();
    if (t === 'service' || t === 'farm') return false;
    return true;
  }

  private ensureSelectedInList(list: Product[]): Product[] {
    const selectedId = this.selectedSourceProductId;
    if (!selectedId) return list;
    if (list.some((p) => String(p._id) === String(selectedId))) return list;
    const snap = this.product?.sourceProduct;
    if (snap && typeof snap === 'object' && String(snap._id) === String(selectedId)) {
      return [snap as Product, ...list];
    }
    const raw = this.product?.sourceProductId;
    if (raw && typeof raw === 'object' && String((raw as { _id?: string })._id) === String(selectedId)) {
      return [raw as Product, ...list];
    }
    return list;
  }
}
