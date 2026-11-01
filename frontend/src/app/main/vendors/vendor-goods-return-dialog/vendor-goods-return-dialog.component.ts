import { Component, Inject, OnDestroy, OnInit } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Branch, Vendor } from '@core/models/products.model';
import { AuthenticationService } from '@core/services/authentication.service';
import { resolveActorBranchContext } from '@core/utils/branch-utils';
import { TranslateService } from '@ngx-translate/core';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { BranchesServce } from '@shared/services/branches.service';
import { ProductsSerivce } from '@shared/services/products.service';
import { VendorsSerivce } from '@shared/services/vendors.service';

export type VendorGoodsReturnDialogData = {
  vendor?: Vendor | null;
  branchId?: string | null;
};

type ReturnProductHit = {
  _id: string;
  name?: string;
  code?: string;
  stock?: number;
  netPrice?: number;
  price?: number;
  transferReservedQuantity?: number;
  bookedQuantity?: number;
  ecommerceReservedQuantity?: number;
};

type ReturnLine = {
  productId: string;
  name: string;
  code: string;
  quantity: number;
  unitPrice: number;
  available: number;
};

@Component({
  selector: 'app-vendor-goods-return-dialog',
  templateUrl: './vendor-goods-return-dialog.component.html',
  styleUrls: ['./vendor-goods-return-dialog.component.scss'],
})
export class VendorGoodsReturnDialogComponent implements OnInit, OnDestroy {
  saving = false;
  searching = false;
  searchTerm = '';
  results: ReturnProductHit[] = [];
  lines: ReturnLine[] = [];
  note = '';

  draft: ReturnProductHit | null = null;
  draftQty: number | null = 1;
  draftPrice: number | null = null;

  /** Set when opened from a supplier record. The list opens the same dialog without a vendor. */
  readonly vendorLocked: boolean;
  selectedVendor: Vendor | null = null;
  vendorSearchTerm = '';
  vendorResults: Vendor[] = [];
  vendorSearching = false;

  branchId: string | null = null;
  showBranchPicker = false;
  branches: Branch[] = [];

  private searchTimer?: ReturnType<typeof setTimeout>;
  private vendorSearchTimer?: ReturnType<typeof setTimeout>;
  private vendorSearchSeq = 0;

  constructor(
    private products: ProductsSerivce,
    private vendors: VendorsSerivce,
    private branchesService: BranchesServce,
    private auth: AuthenticationService,
    private translate: TranslateService,
    private notify: AppNotificationService,
    private ref: MatDialogRef<VendorGoodsReturnDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: VendorGoodsReturnDialogData
  ) {
    this.vendorLocked = !!data?.vendor?._id;
    this.selectedVendor = data?.vendor || null;
    const actor = this.auth.getUserFromLocalStorage();
    const forcedBranchId = String(data?.branchId || '').trim();
    const ctx = resolveActorBranchContext(actor, forcedBranchId || null);
    this.branchId = ctx.branchId;
    this.showBranchPicker = ctx.showBranchPicker;
  }

  ngOnInit(): void {
    if (!this.showBranchPicker) return;
    this.branchesService.getBranchs({ page: 1, limit: 1000 }).subscribe({
      next: (res: any) => {
        this.branches = res?.branches || [];
        if (!this.branchId && this.branches[0]?._id) {
          this.branchId = String(this.branches[0]._id);
        }
      },
      error: () => {
        this.notify.push(this.translate.instant('tr_unexpected_error_message'), 'error');
      },
    });
  }

  ngOnDestroy(): void {
    clearTimeout(this.searchTimer);
    clearTimeout(this.vendorSearchTimer);
  }

  onBranchChange(branchId: string): void {
    this.branchId = String(branchId || '').trim() || null;
    this.results = [];
    this.searchTerm = '';
    this.clearDraft();
    this.lines = [];
  }

  onVendorSearchInput(value: string): void {
    const term = String(value || '');
    this.vendorSearchTerm = term;
    clearTimeout(this.vendorSearchTimer);
    const trimmed = term.trim();
    const selectedName = String(this.selectedVendor?.name || '').trim();
    if (this.selectedVendor && trimmed !== selectedName) {
      this.selectedVendor = null;
    }
    if (!trimmed || (this.selectedVendor && trimmed === selectedName)) {
      this.vendorResults = [];
      this.vendorSearching = false;
      return;
    }
    this.vendorSearchTimer = setTimeout(() => this.searchVendors(trimmed), 300);
  }

  pickVendor(vendor: Vendor): void {
    this.vendorSearchSeq += 1;
    clearTimeout(this.vendorSearchTimer);
    if (this.selectedVendor?._id && String(this.selectedVendor._id) !== String(vendor._id)) {
      this.lines = [];
      this.clearDraft();
    }
    this.selectedVendor = vendor;
    this.vendorResults = [];
    this.vendorSearching = false;
    this.vendorSearchTerm = String(vendor.name || '').trim();
  }

  get total(): number {
    return this.round2(this.lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0));
  }

  onSearchInput(value: string): void {
    this.searchTerm = value;
    clearTimeout(this.searchTimer);
    const term = value.trim();
    if (term.length < 1) {
      this.results = [];
      this.searching = false;
      return;
    }
    this.searchTimer = setTimeout(() => this.search(term), 300);
  }

  availableOf(product: ReturnProductHit): number {
    const stock = Number(product.stock) || 0;
    const reserved =
      (Number(product.transferReservedQuantity) || 0) +
      (Number(product.bookedQuantity) || 0) +
      (Number(product.ecommerceReservedQuantity) || 0);
    return Math.max(0, this.round3(stock - reserved));
  }

  pick(product: ReturnProductHit): void {
    this.draft = product;
    this.draftQty = 1;
    const cost = Number(product.netPrice);
    const price = Number(product.price);
    this.draftPrice = Number.isFinite(cost) && cost > 0 ? cost : Number.isFinite(price) ? price : null;
    this.results = [];
    this.searchTerm = '';
  }

  clearDraft(): void {
    this.draft = null;
    this.draftQty = 1;
    this.draftPrice = null;
  }

  addLine(): void {
    if (!this.draft) return;
    const available = this.availableOf(this.draft);
    const quantity = Number(this.draftQty);
    const unitPrice = this.round2(this.draftPrice);
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > available + 0.0001) {
      this.notify.push(this.translate.instant('tr_vendor_goods_return_qty_invalid'), 'error');
      return;
    }
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
      this.notify.push(this.translate.instant('tr_vendor_goods_return_price_required'), 'error');
      return;
    }
    const productId = String(this.draft._id);
    if (this.lines.some((line) => line.productId === productId)) {
      this.notify.push(this.translate.instant('tr_vendor_goods_return_duplicate'), 'error');
      return;
    }
    this.lines = [
      ...this.lines,
      {
        productId,
        name: String(this.draft.name || '').trim(),
        code: String(this.draft.code || '').trim(),
        quantity,
        unitPrice,
        available,
      },
    ];
    this.clearDraft();
  }

  removeLine(productId: string): void {
    this.lines = this.lines.filter((line) => line.productId !== productId);
  }

  lineTotal(line: ReturnLine): number {
    return this.round2(line.quantity * line.unitPrice);
  }

  submit(): void {
    if (this.saving) return;
    if (!this.lines.length) {
      this.notify.push(this.translate.instant('tr_vendor_goods_return_no_lines'), 'error');
      return;
    }
    const vendorId = this.selectedVendor?._id;
    if (!vendorId) {
      this.notify.push(this.translate.instant('tr_vendor_goods_return_pick_supplier'), 'error');
      return;
    }
    const branchId = this.branchId;
    if (!branchId) {
      this.notify.push(this.translate.instant('tr_branch_required'), 'error');
      return;
    }

    const user = this.auth.getUserFromLocalStorage();
    this.saving = true;
    this.vendors
      .returnGoodsToVendor(String(vendorId), {
        branchId,
        userId: user?._id,
        note: this.note.trim(),
        lines: this.lines.map((line) => ({
          productId: line.productId,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
        })),
      })
      .subscribe({
        next: () => {
          this.saving = false;
          this.notify.push(this.translate.instant('tr_vendor_goods_return_ok'), 'success');
          this.ref.close(true);
        },
        error: (err) => {
          this.saving = false;
          const msg =
            err?.error?.message ||
            err?.error?.error ||
            this.translate.instant('tr_unexpected_error_message');
          this.notify.push(msg, 'error');
        },
      });
  }

  cancel(): void {
    this.ref.close(false);
  }

  private searchVendors(term: string): void {
    const seq = (this.vendorSearchSeq += 1);
    this.vendorSearching = true;
    this.vendors.getVendors({ search: term, page: 1, perPage: 20 }).subscribe({
      next: (res: any) => {
        if (seq !== this.vendorSearchSeq) return;
        this.vendorSearching = false;
        this.vendorResults = Array.isArray(res?.vendors) ? res.vendors : [];
      },
      error: () => {
        if (seq !== this.vendorSearchSeq) return;
        this.vendorSearching = false;
        this.vendorResults = [];
        this.notify.push(this.translate.instant('tr_unexpected_error_message'), 'error');
      },
    });
  }

  private search(term: string): void {
    if (!this.branchId) {
      this.notify.push(this.translate.instant('tr_branch_required'), 'error');
      return;
    }
    this.searching = true;
    this.products
      .getProducts({
        search: term,
        branchId: this.branchId,
        inStock: 'true',
        page: 1,
        limit: 15,
      })
      .subscribe({
        next: (res: any) => {
          this.searching = false;
          const rows = Array.isArray(res?.products) ? res.products : [];
          this.results = rows.filter((row: ReturnProductHit) => this.availableOf(row) > 0);
        },
        error: () => {
          this.searching = false;
          this.results = [];
          this.notify.push(this.translate.instant('tr_unexpected_error_message'), 'error');
        },
      });
  }

  private round2(value: number | null | undefined): number {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  private round3(value: number): number {
    return Math.round(value * 1000) / 1000;
  }
}
