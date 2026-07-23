import { Component, EventEmitter, Input, OnChanges, OnInit, Output, SimpleChanges } from '@angular/core';
import { AuthenticationService } from '@core/services/authentication.service';
import { Globals } from '@core/globals';
import { isBranchManager } from '@core/utils/role-utils';
import { BranchesServce } from '@shared/services/branches.service';
import { CategoriesServce } from '@shared/services/categories.service';
import { ProductsSerivce } from '@shared/services/products.service';
import { UserSerivce } from '@shared/services/user.service';

@Component({
  selector: 'app-report-filters',
  templateUrl: './report-filters.component.html',
  styleUrls: ['./report-filters.component.scss'],
})
export class ReportFiltersComponent implements OnInit, OnChanges {
  /** When `bookings`, show booking-specific filters and hide group-by. */
  @Input() reportType = '';

  @Output() apply = new EventEmitter<any>();

  branches: any[] = [];
  products: any[] = [];
  categories: any[] = [];
  users: { _id: string; name: string }[] = [];
  salespeople: string[] = [];
  /** Branch Manager: fixed to assigned branch (no “all branches”). */
  branchFilterLocked = false;

  filters: any = {
    from: this.formatDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1)),
    to: this.formatDate(new Date()),
    branch_id: null as string | null,
    category_id: null as string | null,
    product_id: null as string | null,
    customer_phone: '',
    seller_name: null as string | null,
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
    private authenticationService: AuthenticationService,
    public globals: Globals
  ) {}

  ngOnInit(): void {
    const u = this.authenticationService.getUserFromLocalStorage();
    if (isBranchManager(u?.role) && u?.branch?._id) {
      this.branchFilterLocked = true;
      this.filters.branch_id = String(u.branch._id);
    }
    this.loadBranches();
    this.loadCategories();
    this.loadProducts();
    this.ensureBookingUsersLoaded();
    queueMicrotask(() => this.applyFilters());
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['reportType']) {
      this.ensureBookingUsersLoaded();
      this.loadSalespeople();
      if (this.reportType === 'products') {
        this.loadCategories();
      }
    }
  }

  private ensureBookingUsersLoaded(): void {
    if (this.reportType === 'bookings' && this.users.length === 0) {
      this.loadUsers();
    }
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
    const params: Record<string, string | number> = { page: 1, limit: 2000 };
    if (this.filters.branch_id) {
      params.branchId = String(this.filters.branch_id);
    }
    if (this.filters.category_id) {
      params.categoryId = String(this.filters.category_id);
    }
    this.productsSerivce.getProducts(params).subscribe({
      next: (res: any) => (this.products = res.products || []),
      error: () => (this.products = []),
    });
  }

  onBranchChange(): void {
    this.filters.product_id = null;
    this.filters.seller_name = null;
    this.loadProducts();
    this.loadSalespeople();
  }

  onCategoryChange(): void {
    this.filters.product_id = null;
    this.loadProducts();
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
    if (this.reportType === 'products') {
      base.category_id = this.filters.category_id ? String(this.filters.category_id) : '';
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
    this.filters.category_id = null;
    this.filters.product_id = null;
    this.filters.customer_phone = '';
    this.filters.seller_name = null;
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
