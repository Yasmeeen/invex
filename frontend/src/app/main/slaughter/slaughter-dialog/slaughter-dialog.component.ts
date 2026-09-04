import { Component, Inject, OnInit } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Globals } from '@core/globals';
import { Branch, Product } from '@core/models/products.model';
import { TranslateService } from '@ngx-translate/core';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { ProductsSerivce } from '@shared/services/products.service';
import {
  SlaughterService,
  SlaughterTemplate,
} from '@shared/services/slaughter.service';

export interface SlaughterDialogData {
  branchId: string;
  branches: Branch[];
  showBranchFilter: boolean;
  /** When true, user may pick warehouse as slaughter location. */
  allowWarehouse: boolean;
  /** Prefill location: 'branch' | 'warehouse' */
  locationType?: 'branch' | 'warehouse';
  templates: SlaughterTemplate[];
}

interface SlaughterOutputRow {
  productId: string | null;
  quantity: number | null;
  kind: 'fridge' | 'offal' | 'waste';
}

interface OutputCategoryOption {
  _id: string;
  name: string;
}

@Component({
  selector: 'app-slaughter-dialog',
  templateUrl: './slaughter-dialog.component.html',
  styleUrls: ['./slaughter-dialog.component.scss'],
})
export class SlaughterDialogComponent implements OnInit {
  saving = false;
  loadingFarm = false;
  loadingOutputs = false;
  farmAnimals: Product[] = [];
  outputProducts: Product[] = [];
  /** Stable list for ng-select (do not rebuild on every CD cycle). */
  visibleOutputProducts: Product[] = [];
  outputCategories: OutputCategoryOption[] = [];
  /** Empty = all categories; otherwise products in any selected category. */
  outputCategoryIds: string[] = [];

  /** 'branch' | 'warehouse' */
  locationType: 'branch' | 'warehouse' = 'branch';
  branchId = '';
  farmProductId = '';
  share = 1;
  liveWeightKg: number | null = null;
  wasteKg: number | null = null;
  notes = '';
  outputRows: SlaughterOutputRow[] = [{ productId: null, quantity: null, kind: 'offal' }];
  selectedTemplate: SlaughterTemplate | null = null;

  constructor(
    private dialogRef: MatDialogRef<SlaughterDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public data: SlaughterDialogData,
    private slaughter: SlaughterService,
    private products: ProductsSerivce,
    private notify: AppNotificationService,
    private translate: TranslateService,
    public globals: Globals
  ) {
    this.branchId = data?.branchId || '';
    if (data?.locationType === 'warehouse' && data?.allowWarehouse) {
      this.locationType = 'warehouse';
    }
  }

  ngOnInit(): void {
    this.reloadLocationProducts();
  }

  get showBranchFilter(): boolean {
    return !!this.data?.showBranchFilter && this.locationType === 'branch';
  }

  get allowWarehouse(): boolean {
    return !!this.data?.allowWarehouse;
  }

  get branches(): Branch[] {
    return this.data?.branches || [];
  }

  get templates(): SlaughterTemplate[] {
    return this.data?.templates || [];
  }

  get inWarehouse(): boolean {
    return this.locationType === 'warehouse';
  }

  get selectedTemplateName(): string {
    return this.selectedTemplate ? this.selectedTemplate.name : '';
  }

  kindLabel(kind?: string): string {
    const key =
      kind === 'fridge'
        ? 'tr_slaughter_kind_fridge'
        : kind === 'waste'
          ? 'tr_slaughter_kind_waste'
          : 'tr_slaughter_kind_offal';
    return this.translate.instant(key);
  }

  trackOutputRow(index: number): number {
    return index;
  }

  onLocationTypeChange(): void {
    this.farmProductId = '';
    this.selectedTemplate = null;
    this.outputRows = [{ productId: null, quantity: null, kind: 'offal' }];
    this.farmAnimals = [];
    this.outputProducts = [];
    this.visibleOutputProducts = [];
    this.outputCategories = [];
    this.outputCategoryIds = [];
    this.reloadLocationProducts();
  }

  onBranchChange(): void {
    this.farmProductId = '';
    this.selectedTemplate = null;
    this.outputRows = [{ productId: null, quantity: null, kind: 'offal' }];
    this.outputCategoryIds = [];
    this.reloadLocationProducts();
  }

  reloadLocationProducts(): void {
    this.loadFarmAnimals();
    this.loadOutputProducts();
  }

  loadFarmAnimals(): void {
    if (this.inWarehouse) {
      this.loadingFarm = true;
      this.products
        .getProducts({
          page: 1,
          limit: 200,
          warehouseOnly: true,
          productType: 'farm',
        })
        .subscribe({
          next: (res: any) => {
            this.farmAnimals = (res?.products || res?.data || []).map((p: Product) => ({
              ...p,
              _id: String(p._id),
            }));
            this.loadingFarm = false;
          },
          error: () => {
            this.farmAnimals = [];
            this.loadingFarm = false;
          },
        });
      return;
    }
    if (!this.branchId) {
      this.farmAnimals = [];
      return;
    }
    this.loadingFarm = true;
    this.products
      .getProducts({
        page: 1,
        limit: 200,
        branchId: this.branchId,
        productType: 'farm',
      })
      .subscribe({
        next: (res: any) => {
          this.farmAnimals = (res?.products || res?.data || []).map((p: Product) => ({
            ...p,
            _id: String(p._id),
          }));
          this.loadingFarm = false;
        },
        error: () => {
          this.farmAnimals = [];
          this.loadingFarm = false;
        },
      });
  }

  loadOutputProducts(): void {
    if (!this.inWarehouse && !this.branchId) {
      this.outputProducts = [];
      this.visibleOutputProducts = [];
      this.outputCategories = [];
      this.outputCategoryIds = [];
      return;
    }
    this.loadingOutputs = true;
    const params: {
      branchId?: string;
      inWarehouse?: boolean;
      userId?: string;
    } = {
      userId: this.globals.currentUser?._id,
    };
    if (this.inWarehouse) {
      params.inWarehouse = true;
    } else {
      params.branchId = this.branchId;
    }
    this.slaughter.listOutputProducts(params).subscribe({
      next: (res) => {
        this.outputProducts = (res?.products || [])
          .map((p) => ({ ...p, _id: String(p._id) }))
          .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ar'));
        this.rebuildOutputCategories();
        this.rebuildVisibleOutputProducts();
        this.loadingOutputs = false;
      },
      error: () => {
        this.outputProducts = [];
        this.visibleOutputProducts = [];
        this.outputCategories = [];
        this.outputCategoryIds = [];
        this.loadingOutputs = false;
      },
    });
  }

  productCategoryId(product: Product | null | undefined): string {
    if (!product) return '';
    const c: any = (product as any).category;
    if (!c) return '';
    return String(typeof c === 'object' ? c._id : c);
  }

  rebuildOutputCategories(): void {
    const map = new Map<string, string>();
    for (const p of this.outputProducts) {
      const c: any = (p as any).category;
      if (!c) continue;
      const id = String(typeof c === 'object' ? c._id : c);
      const name = typeof c === 'object' ? String(c.name || c.code || id) : id;
      if (id && !map.has(id)) map.set(id, name);
    }
    this.outputCategories = [...map.entries()]
      .map(([id, name]) => ({ _id: id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ar'));
    const allowed = new Set(this.outputCategories.map((c) => c._id));
    this.outputCategoryIds = (this.outputCategoryIds || [])
      .map((id) => String(id))
      .filter((id) => allowed.has(id));
  }

  rebuildVisibleOutputProducts(): void {
    const selectedCats = new Set(
      (this.outputCategoryIds || []).map((id) => String(id)).filter(Boolean)
    );
    let list = this.outputProducts;
    if (selectedCats.size) {
      list = this.outputProducts.filter((p) => selectedCats.has(this.productCategoryId(p)));
    }
    const selectedIds = new Set(
      this.outputRows
        .map((r) => (r.productId != null && r.productId !== '' ? String(r.productId) : ''))
        .filter(Boolean)
    );
    const inList = new Set(list.map((p) => String(p._id)));
    const extras = this.outputProducts.filter(
      (p) => selectedIds.has(String(p._id)) && !inList.has(String(p._id))
    );
    this.visibleOutputProducts = extras.length ? [...extras, ...list] : list;
  }

  onOutputCategoryChange(): void {
    this.outputCategoryIds = (this.outputCategoryIds || []).map((id) => String(id));
    this.rebuildVisibleOutputProducts();
  }

  onOutputProductChange(row: SlaughterOutputRow): void {
    if (row.productId != null && row.productId !== '') {
      row.productId = String(row.productId);
    } else {
      row.productId = null;
    }
  }

  onFarmChange(): void {
    const farm = this.farmAnimals.find((p) => String(p._id) === String(this.farmProductId));
    const key = farm?.catalogKey || '';
    this.selectedTemplate = this.templates.find((t) => t.farmSkuKey === key) || null;
    // Free pick: do not lock outputs to template SKUs (e.g. buffalo → كندوز ثلاجة only).
    this.outputRows = [{ productId: null, quantity: null, kind: 'fridge' }];
    this.rebuildVisibleOutputProducts();
  }

  findTemplateOutputProduct(o: { skuKey?: string; label?: string }): Product | undefined {
    const sku = String(o?.skuKey || '').trim();
    const label = String(o?.label || '').trim();
    if (sku) {
      const byKey = this.outputProducts.find((p) => String(p.catalogKey || '') === sku);
      if (byKey) return byKey;
    }
    if (label) {
      return this.outputProducts.find((p) => String(p.name || '').trim() === label);
    }
    return undefined;
  }

  /** Optional: prefill rows from the matched template (user can still change any product). */
  applyTemplatePrefill(): void {
    if (!this.selectedTemplate?.outputs?.length || !this.outputProducts.length) {
      this.notify.push(this.translate.instant('tr_slaughter_no_template_suggestions'), 'error');
      return;
    }
    const rows: SlaughterOutputRow[] = [];
    const categoryIds = new Set<string>();
    for (const o of this.selectedTemplate.outputs) {
      const match = this.findTemplateOutputProduct(o);
      if (!match) continue;
      rows.push({
        productId: String(match._id),
        quantity: null,
        kind: (o.kind as SlaughterOutputRow['kind']) || 'offal',
      });
      const catId = this.productCategoryId(match);
      if (catId) categoryIds.add(catId);
    }
    if (!rows.length) {
      this.notify.push(this.translate.instant('tr_slaughter_no_template_suggestions'), 'error');
      this.outputRows = [{ productId: null, quantity: null, kind: 'fridge' }];
      this.rebuildVisibleOutputProducts();
      return;
    }
    // Show categories that the template products belong to (e.g. كندوز + فواكه اللحوم).
    this.outputCategoryIds = [...categoryIds];
    this.outputRows = rows;
    this.rebuildVisibleOutputProducts();
  }

  addOutputRow(): void {
    this.outputRows.push({ productId: null, quantity: null, kind: 'offal' });
  }

  removeOutputRow(index: number): void {
    if (this.outputRows.length <= 1) {
      this.outputRows = [{ productId: null, quantity: null, kind: 'offal' }];
      return;
    }
    this.outputRows.splice(index, 1);
  }

  cancel(): void {
    this.dialogRef.close(false);
  }

  submit(): void {
    if (this.inWarehouse) {
      if (!this.farmProductId) {
        this.notify.push(this.translate.instant('tr_slaughter_form_incomplete'), 'error');
        return;
      }
    } else if (!this.branchId || !this.farmProductId) {
      this.notify.push(this.translate.instant('tr_slaughter_form_incomplete'), 'error');
      return;
    }

    const outputs = this.outputRows
      .map((r) => ({
        productId: r.productId ? String(r.productId) : '',
        quantity: Number(r.quantity || 0),
        kind: r.kind || 'offal',
      }))
      .filter((r) => r.productId && r.quantity > 0);

    if (!outputs.length) {
      this.notify.push(this.translate.instant('tr_slaughter_need_output'), 'error');
      return;
    }

    const uniqueIds = new Set(outputs.map((o) => o.productId));
    if (uniqueIds.size !== outputs.length) {
      this.notify.push(this.translate.instant('tr_slaughter_duplicate_output'), 'error');
      return;
    }

    this.saving = true;
    const body: any = {
      userId: this.globals.currentUser?._id,
      farmProductId: this.farmProductId,
      share: this.share,
      liveWeightKg: this.liveWeightKg,
      wasteKg: this.wasteKg,
      notes: this.notes,
      outputs,
    };
    if (this.inWarehouse) {
      body.inWarehouse = true;
    } else {
      body.branchId = this.branchId;
    }
    if (this.selectedTemplate?._id) {
      body.templateId = this.selectedTemplate._id;
    }

    this.slaughter.createTicket(body).subscribe({
      next: () => {
        this.saving = false;
        this.notify.push(this.translate.instant('tr_slaughter_created'), 'success');
        this.dialogRef.close(true);
      },
      error: (err) => {
        this.saving = false;
        this.notify.push(err?.error?.error || this.translate.instant('tr_slaughter_failed'), 'error');
      },
    });
  }
}
