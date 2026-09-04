import { Component, Inject, OnInit } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Globals } from '@core/globals';
import { Product } from '@core/models/products.model';
import { TranslateService } from '@ngx-translate/core';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { ProductsSerivce } from '@shared/services/products.service';
import { TrimService } from '@shared/services/trim.service';

export interface TrimDialogData {
  product: Product;
}

interface TrimOutputRow {
  productId: string | null;
  quantity: number | null;
}

@Component({
  selector: 'app-trim-dialog',
  templateUrl: './trim-dialog.component.html',
  styleUrls: ['./trim-dialog.component.scss'],
})
export class TrimDialogComponent implements OnInit {
  saving = false;
  loadingProducts = false;
  categoryProducts: Product[] = [];

  inputQty: number | null = null;
  wasteQty: number | null = null;
  notes = '';
  outputRows: TrimOutputRow[] = [{ productId: null, quantity: null }];

  constructor(
    private dialogRef: MatDialogRef<TrimDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public data: TrimDialogData,
    private trim: TrimService,
    private products: ProductsSerivce,
    private notify: AppNotificationService,
    private translate: TranslateService,
    public globals: Globals
  ) {}

  ngOnInit(): void {
    this.loadCategoryProducts();
  }

  get product(): Product {
    return this.data?.product;
  }

  get productStock(): number {
    return Number(this.product?.stock || 0);
  }

  get branchId(): string {
    const b = this.product?.branch;
    if (!b) return '';
    return typeof b === 'object' ? String((b as any)._id || '') : String(b);
  }

  get categoryId(): string {
    const c = this.product?.category;
    if (!c) return '';
    return typeof c === 'object' ? String((c as any)._id || '') : String(c);
  }

  get categoryName(): string {
    const c = this.product?.category;
    return c && typeof c === 'object' ? String((c as any).name || '') : '';
  }

  /** Sum of output quantities (الكمية اللي طلعت بعد التشفيه). */
  get yieldedQty(): number {
    return this.round3(
      this.outputRows.reduce((s, r) => s + (Number(r.quantity) || 0), 0)
    );
  }

  /** Suggested waste = input − yield (when input is set). */
  get suggestedWaste(): number {
    const input = Number(this.inputQty) || 0;
    if (input <= 0) return 0;
    return this.round3(Math.max(0, input - this.yieldedQty));
  }

  trackOutputRow(index: number): number {
    return index;
  }

  compareProductId = (a: string | null, b: string | null): boolean => {
    if (a == null && b == null) return true;
    return String(a || '') === String(b || '');
  };

  loadCategoryProducts(): void {
    if (!this.categoryId || !this.branchId) {
      this.categoryProducts = [];
      return;
    }
    this.loadingProducts = true;
    this.products
      .getProducts({
        page: 1,
        limit: 500,
        branchId: this.branchId,
        categoryId: this.categoryId,
      })
      .subscribe({
        next: (res: any) => {
          const list: Product[] = res?.products || res?.data || [];
          const filtered = list
            .filter((p) => {
              const t = String(p.productType || 'good').toLowerCase();
              return t !== 'service' && t !== 'farm';
            })
            .map((p) => ({ ...p, _id: String(p._id) }));

          // Ensure the source product itself is in the list (meat yield on same SKU).
          const sourceId = String(this.product._id);
          if (!filtered.some((p) => String(p._id) === sourceId)) {
            filtered.unshift({
              ...this.product,
              _id: sourceId,
            });
          } else {
            // Keep source first so it's easy to pick as اللحم الناتج.
            filtered.sort((a, b) => {
              if (String(a._id) === sourceId) return -1;
              if (String(b._id) === sourceId) return 1;
              return String(a.name || '').localeCompare(String(b.name || ''), 'ar');
            });
          }

          this.categoryProducts = filtered;
          // Prefill first row with source product so user just enters meat yield qty.
          if (this.outputRows.length === 1 && !this.outputRows[0].productId) {
            this.outputRows[0].productId = sourceId;
          }
          this.loadingProducts = false;
        },
        error: () => {
          this.categoryProducts = [];
          this.loadingProducts = false;
        },
      });
  }

  addOutputRow(): void {
    this.outputRows.push({ productId: null, quantity: null });
  }

  removeOutputRow(index: number): void {
    if (this.outputRows.length <= 1) {
      this.outputRows = [{ productId: null, quantity: null }];
      return;
    }
    this.outputRows.splice(index, 1);
  }

  fillSuggestedWaste(): void {
    this.wasteQty = this.suggestedWaste;
  }

  cancel(): void {
    this.dialogRef.close(false);
  }

  submit(): void {
    const input = this.round3(Number(this.inputQty) || 0);
    if (!this.branchId || !this.product?._id) {
      this.notify.push(this.translate.instant('tr_trim_form_incomplete'), 'error');
      return;
    }
    if (input <= 0) {
      this.notify.push(this.translate.instant('tr_trim_need_input'), 'error');
      return;
    }
    if (input > this.productStock + 0.0001) {
      this.notify.push(this.translate.instant('tr_trim_not_enough_stock'), 'error');
      return;
    }

    const outputs = this.outputRows
      .map((r) => ({
        productId: r.productId ? String(r.productId) : '',
        quantity: this.round3(Number(r.quantity) || 0),
      }))
      .filter((r) => r.productId && r.quantity > 0);

    if (!outputs.length) {
      this.notify.push(this.translate.instant('tr_trim_need_output'), 'error');
      return;
    }

    const uniqueIds = new Set(outputs.map((o) => o.productId));
    if (uniqueIds.size !== outputs.length) {
      this.notify.push(this.translate.instant('tr_trim_duplicate_output'), 'error');
      return;
    }

    const waste =
      this.wasteQty == null
        ? this.suggestedWaste
        : this.round3(Math.max(0, Number(this.wasteQty) || 0));

    if (this.round3(this.yieldedQty + waste) - input > 0.001) {
      this.notify.push(this.translate.instant('tr_trim_over_input'), 'error');
      return;
    }

    this.saving = true;
    this.trim
      .createTicket({
        userId: this.globals.currentUser?._id,
        branchId: this.branchId,
        sourceProductId: this.product._id,
        inputQty: input,
        wasteQty: waste,
        notes: this.notes,
        outputs,
      })
      .subscribe({
        next: () => {
          this.saving = false;
          this.notify.push(this.translate.instant('tr_trim_created'), 'success');
          this.dialogRef.close(true);
        },
        error: (err) => {
          this.saving = false;
          this.notify.push(
            err?.error?.error || this.translate.instant('tr_trim_failed'),
            'error'
          );
        },
      });
  }

  private round3(n: number): number {
    return Math.round((Number(n) || 0) * 1000) / 1000;
  }
}
