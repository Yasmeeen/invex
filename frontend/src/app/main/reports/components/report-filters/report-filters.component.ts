import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  SimpleChanges,
} from '@angular/core';
import { AuthenticationService } from '@core/services/authentication.service';
import { Globals } from '@core/globals';
import { isBranchManager } from '@core/utils/role-utils';
import { BranchesServce } from '@shared/services/branches.service';
import { CategoriesServce } from '@shared/services/categories.service';
import { ProductsSerivce } from '@shared/services/products.service';
import { UserSerivce } from '@shared/services/user.service';
import { VendorsSerivce } from '@shared/services/vendors.service';
import { CollectionsService, CollectorUser } from '@shared/services/collections.service';
import { of, Subject, Subscription } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, switchMap, tap } from 'rxjs/operators';

@Component({
  selector: 'app-report-filters',
  templateUrl: './report-filters.component.html',
  styleUrls: ['./report-filters.component.scss'],
})
export class ReportFiltersComponent implements OnInit, OnChanges, OnDestroy {
  /** When `bookings`, show booking-specific filters and hide group-by. */
  @Input() reportType = '';

  @Output() apply = new EventEmitter<any>();

  branches: any[] = [];
  products: any[] = [];
  categories: any[] = [];
  users: { _id: string; name: string }[] = [];
  collectors: CollectorUser[] = [];
  salespeople: string[] = [];
  /** Branch Manager: fixed to assigned branch (no “all branches”). */
  branchFilterLocked = false;

  vendorSearchItems: any[] = [];
  selectedSupplierId: string | null = null;
  selectedSupplierLabel = '';
  vendorsLoading = false;
  readonly vendorTypeahead$ = new Subject<string>();
  private vendorTypeaheadSub?: Subscription;

  /** Product filter typeahead (includes sold/soft-removed rows for historical reports). */
  productsLoading = false;
  readonly productTypeahead$ = new Subject<string>();
  private productTypeaheadSub?: Subscription;
  selectedProductLabel = '';

  filters: any = {
    from: this.formatDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1)),
    to: this.formatDate(new Date()),
    branch_id: null as string | null,
    category_ids: [] as string[],
    supplier_id: null as string | null,
    product_id: null as string | null,
    customer_phone: '',
    seller_name: null as string | null,
    collector_id: null as string | null,
    installment_status: 'all',
    groupBy: 'daily',
    booking_status: 'all',
    booking_confirmed: 'all',
    warehouse_only: false,
    booking_search: '',
    booking_created_by: null as string | null,
  };

  constructor(
    private branchesServce: BranchesServce,
    private categoriesServce: CategoriesServce,
    private productsSerivce: ProductsSerivce,
    private userSerivce: UserSerivce,
    private vendorsSerivce: VendorsSerivce,
    private collectionsService: CollectionsService,
    private authenticationService: AuthenticationService,
    public globals: Globals
  ) {}

  ngOnInit(): void {
    const u = this.authenticationService.getUserFromLocalStorage();
    if (isBranchManager(u?.role) && u?.branch?._id) {
      this.branchFilterLocked = true;
      this.filters.branch_id = String(u.branch._id);
    }
    this.initVendorTypeahead();
    this.initProductTypeahead();
    this.loadBranches();
    this.loadCategories();
    this.loadProducts();
    this.ensureBookingUsersLoaded();
    this.ensureCollectorsLoaded();
    queueMicrotask(() => this.applyFilters());
  }

  ngOnDestroy(): void {
    this.vendorTypeaheadSub?.unsubscribe();
    this.productTypeaheadSub?.unsubscribe();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['reportType']) {
      this.ensureBookingUsersLoaded();
      this.ensureCollectorsLoaded();
      this.loadSalespeople();
      if (this.categoryFilterVisible) {
        this.loadCategories();
      }
    }
  }

  private ensureBookingUsersLoaded(): void {
    if (this.reportType === 'bookings' && this.users.length === 0) {
      this.loadUsers();
    }
  }

  private ensureCollectorsLoaded(): void {
    if (this.reportType === 'installments' && this.collectors.length === 0) {
      this.collectionsService.listCollectors().subscribe({
        next: (res) => {
          this.collectors = res?.collectors || [];
        },
        error: () => (this.collectors = []),
      });
    }
  }

  get categoryFilterVisible(): boolean {
    return (
      this.reportType === 'products' || this.reportType === 'sales' || this.reportType === 'profit'
    );
  }

  private get selectedCategoryIds(): string[] {
    return (this.filters.category_ids || []).map((id: string) => String(id)).filter(Boolean);
  }

  get lockedBranchLabel(): string {
    const b = this.globals.currentUser?.branch;
    return (b && (b as { name?: string }).name) || '—';
  }

  private formatDate(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  loadBranches(): void {
    this.branchesServce.getBranchs({ page: 1, limit: 1000 }).subscribe({
      next: (res: any) => {
        this.branches = res.branches || [];
        this.loadSalespeople();
      },
      error: () => (this.branches = []),
    });
  }

  loadUsers(): void {
    this.userSerivce.getUsers({ page: 1, limit: 1000 }).subscribe({
      next: (res: { users?: { _id: string; name: string }[] }) => {
        this.users = (res.users || []).map((u) => ({
          _id: String(u._id),
          name: u.name || '',
        }));
      },
      error: () => (this.users = []),
    });
  }

  loadCategories(): void {
    this.categoriesServce.getCategorys({ page: 1, limit: 1000 }).subscribe({
      next: (res: any) => (this.categories = res.categories || []),
      error: () => (this.categories = []),
    });
  }

  loadProducts(): void {
    this.productTypeahead$.next('');
  }

  private initProductTypeahead(): void {
    this.productTypeaheadSub = this.productTypeahead$
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        tap(() => (this.productsLoading = true)),
        switchMap((term: string) => {
          const search = String(term || '').trim();
          const params: Record<string, string | number | boolean> = {
            page: 1,
            limit: 40,
            /** Keep sold / soft-removed products selectable for sales & profit history. */
            includeRemoved: true,
          };
          if (this.filters.branch_id) {
            params.branchId = String(this.filters.branch_id);
          }
          const categoryIds = this.selectedCategoryIds;
          if (categoryIds.length) {
            params.categoryId = categoryIds.join(',');
          }
          if (search) {
            params.search = search;
          }
          return this.productsSerivce.getProducts(params).pipe(
            catchError(() => of({ products: [] })),
            tap(() => (this.productsLoading = false))
          );
        })
      )
      .subscribe((res: any) => {
        const list = Array.isArray(res?.products) ? res.products : [];
        this.products = list.map((p: any) => this.withProductLabel(p));
        if (
          this.filters.product_id &&
          this.selectedProductLabel &&
          !this.products.some((p) => String(p._id) === String(this.filters.product_id))
        ) {
          this.products = [
            {
              _id: this.filters.product_id,
              name: this.selectedProductLabel,
              label: this.selectedProductLabel,
            },
            ...this.products,
          ];
        }
      });
  }

  onProductSelectOpen(): void {
    this.productTypeahead$.next('');
  }

  private withProductLabel(product: any): any {
    if (!product) {
      return product;
    }
    const name = String(product.name || '').trim();
    const code = String(product.code || '').trim();
    const bits = [name];
    if (code) {
      bits.push(`(${code})`);
    }
    return {
      ...product,
      label: bits.filter(Boolean).join(' '),
    };
  }

  onProductIdChange(productId: string | null): void {
    this.filters.product_id = productId ? String(productId) : null;
    if (!productId) {
      this.selectedProductLabel = '';
      return;
    }
    const found = this.products.find((p) => String(p._id) === String(productId));
    this.selectedProductLabel = found?.label || found?.name || '';
  }

  onBranchChange(): void {
    this.filters.product_id = null;
    this.selectedProductLabel = '';
    this.filters.seller_name = null;
    this.loadProducts();
    this.loadSalespeople();
  }

  onCategoryChange(): void {
    this.filters.product_id = null;
    this.selectedProductLabel = '';
    this.loadProducts();
  }

  private initVendorTypeahead(): void {
    this.vendorTypeaheadSub = this.vendorTypeahead$
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        tap(() => (this.vendorsLoading = true)),
        switchMap((term: string) => {
          const search = String(term || '').trim();
          const params: Record<string, string | number> = { page: 1, limit: 25 };
          if (search) {
            params.search = search;
          }
          return this.vendorsSerivce.getVendors(params).pipe(
            catchError(() => of({ vendors: [] })),
            tap(() => (this.vendorsLoading = false))
          );
        })
      )
      .subscribe((res: any) => {
        const list = Array.isArray(res?.vendors) ? res.vendors : [];
        this.vendorSearchItems = list.map((v: any) => this.withVendorLabel(v));
        if (
          this.selectedSupplierId &&
          this.selectedSupplierLabel &&
          !this.vendorSearchItems.some(
            (v) => String(v._id) === String(this.selectedSupplierId)
          )
        ) {
          this.vendorSearchItems = [
            {
              _id: this.selectedSupplierId,
              label: this.selectedSupplierLabel,
              nameOfcompany: this.selectedSupplierLabel,
            },
            ...this.vendorSearchItems,
          ];
        }
      });
  }

  onVendorSelectOpen(): void {
    this.vendorTypeahead$.next('');
  }

  private withVendorLabel(vendor: any): any {
    if (!vendor) {
      return vendor;
    }
    const company = String(vendor.nameOfcompany || '').trim();
    const name = String(vendor.name || '').trim();
    const phone = String(vendor.phone || '').trim();
    return {
      ...vendor,
      label: [company, name, phone].filter(Boolean).join(' — '),
    };
  }

  onSupplierIdChange(vendorId: string | null): void {
    this.selectedSupplierId = vendorId ? String(vendorId) : null;
    this.filters.supplier_id = this.selectedSupplierId;
    if (!vendorId) {
      this.selectedSupplierLabel = '';
      return;
    }
    const found = this.vendorSearchItems.find((v) => String(v._id) === String(vendorId));
    this.selectedSupplierLabel = found?.label || found?.nameOfcompany || '';
  }

  loadSalespeople(): void {
    if (this.reportType !== 'sales' && this.reportType !== 'profit') {
      this.salespeople = [];
      return;
    }

    const branchId = this.filters.branch_id;
    if (branchId) {
      const branch = this.branches.find((b) => String(b._id) === String(branchId));
      if (branch?.salespeople?.length) {
        this.salespeople = branch.salespeople
          .filter((sp: { active?: boolean; name?: string }) => sp.active !== false && String(sp.name || '').trim())
          .map((sp: { name: string }) => String(sp.name).trim());
        return;
      }
      this.branchesServce.getBranch(branchId).subscribe({
        next: (res: any) => {
          this.salespeople = (res?.salespeople || [])
            .filter((sp: { active?: boolean; name?: string }) => sp.active !== false && String(sp.name || '').trim())
            .map((sp: { name: string }) => String(sp.name).trim());
        },
        error: () => (this.salespeople = []),
      });
      return;
    }

    const names = new Set<string>();
    for (const branch of this.branches) {
      for (const sp of branch.salespeople || []) {
        if (sp.active !== false && String(sp.name || '').trim()) {
          names.add(String(sp.name).trim());
        }
      }
    }
    this.salespeople = Array.from(names).sort((a, b) => a.localeCompare(b));
  }

  private normalizeFilterPayload(): Record<string, string> {
    const base: Record<string, string> = {
      from: this.filters.from || '',
      to: this.filters.to || '',
      branch_id: this.filters.branch_id ? String(this.filters.branch_id) : '',
      product_id: this.filters.product_id ? String(this.filters.product_id) : '',
      customer_phone: (this.filters.customer_phone || '').trim(),
      groupBy: this.filters.groupBy || 'daily',
    };
    if (this.categoryFilterVisible) {
      base.category_id = this.selectedCategoryIds.join(',');
    }
    if (this.reportType === 'products' && this.filters.supplier_id) {
      base.supplier_id = String(this.filters.supplier_id);
    }
    if (this.reportType === 'sales' || this.reportType === 'profit') {
      base.seller_name = this.filters.seller_name ? String(this.filters.seller_name) : '';
    }
    if (this.reportType === 'bookings') {
      base.status = this.filters.booking_status || 'all';
      base.confirmed = this.filters.booking_confirmed || 'all';
      if (this.filters.warehouse_only) {
        base.warehouse_only = 'true';
      }
      const bs = (this.filters.booking_search || '').trim();
      if (bs) {
        base.search = bs;
      }
      if (this.filters.booking_created_by) {
        base.created_by = String(this.filters.booking_created_by);
      }
    }
    if (this.reportType === 'installments') {
      if (this.filters.collector_id) {
        base.collector_id = String(this.filters.collector_id);
      }
      base.status = this.filters.installment_status || 'all';
    }
    return base;
  }

  applyFilters(): void {
    this.apply.emit(this.normalizeFilterPayload());
  }

  reset(): void {
    if (!this.branchFilterLocked) {
      this.filters.branch_id = null;
    } else {
      const u = this.authenticationService.getUserFromLocalStorage();
      if (u?.branch?._id) {
        this.filters.branch_id = String(u.branch._id);
      }
    }
    this.filters.category_ids = [];
    this.filters.supplier_id = null;
    this.selectedSupplierId = null;
    this.selectedSupplierLabel = '';
    this.vendorSearchItems = [];
    this.filters.product_id = null;
    this.selectedProductLabel = '';
    this.filters.customer_phone = '';
    this.filters.seller_name = null;
    this.filters.collector_id = null;
    this.filters.installment_status = 'all';
    this.filters.groupBy = 'daily';
    this.filters.booking_status = 'all';
    this.filters.booking_confirmed = 'all';
    this.filters.warehouse_only = false;
    this.filters.booking_search = '';
    this.filters.booking_created_by = null;
    this.loadProducts();
    this.loadSalespeople();
    this.applyFilters();
  }
}
