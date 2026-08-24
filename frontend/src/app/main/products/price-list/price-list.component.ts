import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { PaginationData } from '@core/models/users-interfaces.model';
import { Subscription } from 'rxjs';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { TranslateService } from '@ngx-translate/core';
import { Branch, Category, Product } from '@core/models/products.model';
import { ProductsSerivce } from '@shared/services/products.service';
import { CategoriesServce } from '@shared/services/categories.service';
import { BranchesServce } from '@shared/services/branches.service';
import { Globals } from '@core/globals';
import { isBranchManager, isCashier, isModerator } from '@core/utils/role-utils';

type PriceListRow = Product & { draftPrice: number | string };
type PriceChangedPreset = 'all' | 'today' | '7d' | '30d' | 'custom';

@Component({
  selector: 'app-price-list',
  templateUrl: './price-list.component.html',
  styleUrls: ['./price-list.component.scss'],
})
export class PriceListComponent implements OnInit, OnDestroy {
  productsLoading = true;
  isNotAuthorized = false;
  paginationPerPage = 50;
  categorys: Category[] = [];
  selectedCategories: string[] = [];
  productsList: PriceListRow[] = [];
  selectedBranches: string[] = [];
  branches: Branch[] = [];
  stockFilter: 'all' | 'available' | 'out_of_stock' = 'all';
  priceChangedPreset: PriceChangedPreset = 'all';
  customFrom = '';
  customTo = '';
  lastPriceUpdatedAt: string | Date | null = null;
  totalNumberOfProducts = 0;
  nameSearchTerm = '';
  searchTimeout: any;
  savingIds: Record<string, boolean> = {};
  savedIds: Record<string, boolean> = {};

  readonly stockFilterOptions: Array<{
    id: 'all' | 'available' | 'out_of_stock';
    labelKey: string;
  }> = [
    { id: 'all', labelKey: 'tr_products_stock_filter_all' },
    { id: 'available', labelKey: 'tr_products_stock_filter_available' },
    { id: 'out_of_stock', labelKey: 'tr_products_stock_filter_out' },
  ];

  readonly priceChangedOptions: Array<{ id: PriceChangedPreset; labelKey: string }> = [
    { id: 'all', labelKey: 'tr_price_list_price_changed_all' },
    { id: 'today', labelKey: 'tr_price_list_price_changed_today' },
    { id: '7d', labelKey: 'tr_price_list_price_changed_7d' },
    { id: '30d', labelKey: 'tr_price_list_price_changed_30d' },
    { id: 'custom', labelKey: 'tr_price_list_price_changed_custom' },
  ];

  params: any = {
    page: 1,
    limit: this.paginationPerPage,
  };
  paginationData: PaginationData;
  private subscriptions: Subscription[] = [];

  constructor(
    private productsService: ProductsSerivce,
    private appNotificationService: AppNotificationService,
    private translateService: TranslateService,
    private categoriesService: CategoriesServce,
    private branchesServce: BranchesServce,
    private globals: Globals,
    private route: ActivatedRoute
  ) {}

  get isCashierView(): boolean {
    return isCashier(this.globals.currentUser?.role);
  }

  get canEditPrices(): boolean {
    return !isModerator(this.globals.currentUser?.role) && !this.isCashierView;
  }

  canEditProduct(product: Product): boolean {
    if (!this.canEditPrices) {
      return false;
    }
    if (!isBranchManager(this.globals.currentUser?.role)) {
      return true;
    }
    if (product?.inWarehouse) {
      return false;
    }
    const myId = this.globals.currentUser?.branch?._id;
    const pid =
      product?.branch &&
      (typeof product.branch === 'object' ? (product.branch as Branch)._id : product.branch);
    if (!myId || !pid) {
      return false;
    }
    return String(pid) === String(myId);
  }

  ngOnInit(): void {
    this.priceChangedPreset = this.isCashierView ? 'today' : 'all';
    const q = this.route.snapshot.queryParamMap;
    const preset = q.get('priceChanged');
    if (preset === 'today' || preset === '7d' || preset === '30d' || preset === 'all') {
      this.priceChangedPreset = preset;
    }
    const search = q.get('search');
    if (search) {
      this.nameSearchTerm = search;
      this.params['search'] = search;
    }
    this.getproducts();
    this.getcategorys();
    this.getBranches();
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach((s) => s.unsubscribe());
    clearTimeout(this.searchTimeout);
  }

  trackById(_index: number, product: Product): string {
    return product?._id;
  }

  locationLabel(product: Product): string {
    if (product?.inWarehouse) {
      return this.translateService.instant('tr_warehouse');
    }
    return product?.branch?.name || '—';
  }

  isInStock(product: Product): boolean {
    return (Number(product?.stock) || 0) > 0;
  }

  isSaving(product: Product): boolean {
    return !!this.savingIds[product._id];
  }

  isSaved(product: Product): boolean {
    return !!this.savedIds[product._id];
  }

  isRecentlyChanged(product: Product): boolean {
    if (!product?.priceUpdatedAt) {
      return false;
    }
    const t = new Date(product.priceUpdatedAt).getTime();
    return Number.isFinite(t) && Date.now() - t < 24 * 60 * 60 * 1000;
  }

  private startOfToday(): Date {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  buildFilterParams(): Record<string, string | boolean> {
    const filterParams: Record<string, string | boolean> = {
      sort: 'priceUpdatedAt',
    };
    if (this.selectedCategories?.length) {
      filterParams['categoryId'] = this.selectedCategories.filter(Boolean).join(',');
    }
    if (this.stockFilter === 'available') {
      filterParams['inStock'] = 'true';
    } else if (this.stockFilter === 'out_of_stock') {
      filterParams['inStock'] = 'false';
    }
    if (this.selectedBranches?.length) {
      filterParams['branchId'] = this.selectedBranches.filter(Boolean).join(',');
    }
    const search = String(this.nameSearchTerm || this.params['search'] || '').trim();
    if (search) {
      filterParams['search'] = search;
    }
    if (this.priceChangedPreset === 'today') {
      filterParams['priceUpdatedSince'] = this.startOfToday().toISOString();
    } else if (this.priceChangedPreset === '7d') {
      const d = new Date();
      d.setDate(d.getDate() - 7);
      filterParams['priceUpdatedSince'] = d.toISOString();
    } else if (this.priceChangedPreset === '30d') {
      const d = new Date();
      d.setDate(d.getDate() - 30);
      filterParams['priceUpdatedSince'] = d.toISOString();
    } else if (this.priceChangedPreset === 'custom') {
      if (this.customFrom) {
        filterParams['priceUpdatedFrom'] = new Date(`${this.customFrom}T00:00:00.000`).toISOString();
      }
      if (this.customTo) {
        filterParams['priceUpdatedTo'] = new Date(`${this.customTo}T23:59:59.999`).toISOString();
      }
    }
    return filterParams;
  }

  getproducts(): void {
    this.productsLoading = true;
    delete this.params['branchId'];
    delete this.params['inStock'];
    delete this.params['categoryId'];
    delete this.params['search'];
    delete this.params['sort'];
    delete this.params['priceUpdatedSince'];
    delete this.params['priceUpdatedFrom'];
    delete this.params['priceUpdatedTo'];
    Object.assign(this.params, this.buildFilterParams());

    this.subscriptions.push(
      this.productsService.getProducts(this.params).subscribe(
        (response: any) => {
          this.productsList = (response.products || []).map((p: Product) => ({
            ...p,
            draftPrice: p.price,
          }));
          this.paginationData = response.meta;
          this.totalNumberOfProducts = response.meta.totalCount;
          this.lastPriceUpdatedAt = response.lastPriceUpdatedAt || null;
          this.productsLoading = false;
        },
        (error: any) => {
          if (error.status == 403) {
            this.isNotAuthorized = true;
            this.productsLoading = false;
          } else {
            this.appNotificationService.push(
              this.translateService.instant('tr_unexpected_error_message'),
              'error'
            );
            this.productsLoading = false;
          }
        }
      )
    );
  }

  getBranches(): void {
    this.branchesServce.getBranchs({ page: 1, limit: 1000 }).subscribe((response: any) => {
      this.branches = response.branches;
    });
  }

  getcategorys(): void {
    this.subscriptions.push(
      this.categoriesService.getCategorys({ page: 1, limit: 1000 }).subscribe(
        (response: any) => {
          this.categorys = response.categories || [];
        },
        (error: any) => {
          if (error.status == 403) {
            this.isNotAuthorized = true;
          }
        }
      )
    );
  }

  onFilterChange(): void {
    this.params.page = 1;
    this.getproducts();
  }

  filterproducts(event: any): void {
    const term = event?.target?.value?.trim?.() ?? '';
    clearTimeout(this.searchTimeout);
    this.searchTimeout = setTimeout(() => {
      this.params['search'] = term;
      this.params.page = 1;
      this.getproducts();
    }, 400);
  }

  paginationUpdate(page: number): void {
    this.params.page = page;
    this.getproducts();
  }

  savePrice(row: PriceListRow): void {
    if (!this.canEditProduct(row) || this.isSaving(row)) {
      return;
    }
    const next = Number(row.draftPrice);
    if (!Number.isFinite(next) || next < 0) {
      row.draftPrice = row.price;
      return;
    }
    const rounded = Math.round(next * 100) / 100;
    if (rounded === Number(row.price)) {
      row.draftPrice = row.price;
      return;
    }
    this.savingIds = { ...this.savingIds, [row._id]: true };
    this.subscriptions.push(
      this.productsService.updateProductPrice(row._id, rounded).subscribe(
        (res) => {
          const updated = res?.product || row;
          row.price = updated.price;
          row.draftPrice = updated.price;
          row.priceUpdatedAt = updated.priceUpdatedAt || new Date().toISOString();
          if (updated.priceUpdatedAt) {
            this.lastPriceUpdatedAt = updated.priceUpdatedAt;
          }
          const nextSaving = { ...this.savingIds };
          delete nextSaving[row._id];
          this.savingIds = nextSaving;
          this.savedIds = { ...this.savedIds, [row._id]: true };
          setTimeout(() => {
            const nextSaved = { ...this.savedIds };
            delete nextSaved[row._id];
            this.savedIds = nextSaved;
          }, 1500);
        },
        (error: any) => {
          const nextSaving = { ...this.savingIds };
          delete nextSaving[row._id];
          this.savingIds = nextSaving;
          row.draftPrice = row.price;
          const msg =
            error?.error?.error || this.translateService.instant('tr_unexpected_error_message');
          this.appNotificationService.push(msg, 'error');
        }
      )
    );
  }

  onPriceKeydown(event: KeyboardEvent, row: PriceListRow): void {
    if (event.key === 'Enter') {
      (event.target as HTMLInputElement)?.blur();
      this.savePrice(row);
    }
  }
}
