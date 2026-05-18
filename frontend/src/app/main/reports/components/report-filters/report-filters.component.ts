import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { AuthenticationService } from '@core/services/authentication.service';
import { Globals } from '@core/globals';
import { isBranchManager } from '@core/utils/role-utils';
import { BranchesServce } from '@shared/services/branches.service';
import { ProductsSerivce } from '@shared/services/products.service';

@Component({
    selector: 'app-report-filters',
    templateUrl: './report-filters.component.html',
    styleUrls: ['./report-filters.component.scss'],
    standalone: false
})
export class ReportFiltersComponent implements OnInit {
  /** When `bookings`, show booking-specific filters and hide group-by. */
  @Input() reportType = '';

  @Output() apply = new EventEmitter<any>();

  branches: any[] = [];
  products: any[] = [];
  /** Branch Manager: fixed to assigned branch (no “all branches”). */
  branchFilterLocked = false;

  filters: any = {
    from: this.formatDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1)),
    to: this.formatDate(new Date()),
    branch_id: null as string | null,
    product_id: null as string | null,
    customer_phone: '',
    groupBy: 'daily',
    booking_status: 'all',
    booking_confirmed: 'all',
    warehouse_only: false,
    booking_search: '',
  };

  constructor(
    private branchesServce: BranchesServce,
    private productsSerivce: ProductsSerivce,
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
    this.loadProducts();
    queueMicrotask(() => this.applyFilters());
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
      next: (res: any) => (this.branches = res.branches || []),
      error: () => (this.branches = []),
    });
  }

  loadProducts(): void {
    const params: Record<string, string | number> = { page: 1, limit: 2000 };
    if (this.filters.branch_id) {
      params.branchId = String(this.filters.branch_id);
    }
    this.productsSerivce.getProducts(params).subscribe({
      next: (res: any) => (this.products = res.products || []),
      error: () => (this.products = []),
    });
  }

  onBranchChange(): void {
    this.filters.product_id = null;
    this.loadProducts();
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
    this.filters.product_id = null;
    this.filters.customer_phone = '';
    this.filters.groupBy = 'daily';
    this.filters.booking_status = 'all';
    this.filters.booking_confirmed = 'all';
    this.filters.warehouse_only = false;
    this.filters.booking_search = '';
    this.loadProducts();
    this.applyFilters();
  }
}
