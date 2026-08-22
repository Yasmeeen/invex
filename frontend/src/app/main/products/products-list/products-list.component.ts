import { CategoriesServce } from './../../../shared/services/categories.service';
import { MatDialog } from '@angular/material/dialog';
import { Component, OnDestroy, OnInit } from '@angular/core';
// import { productsSerivce } from '@shared/services/products.services';
import { PaginationData } from '@core/models/users-interfaces.model'
// import { category, product } from '@core/models/products-interface.model'
import { of, Subject, Subscription } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, switchMap, tap } from 'rxjs/operators';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { TranslateService } from '@ngx-translate/core';
import { Branch, Category, Product } from '@core/models/products.model';
import { CreateEditProductComponent } from '../create-edit-product/create-edit-product.component';
import {
  productBarcodeAttributeValues,
  ProductsSerivce,
} from '@shared/services/products.service';
import { BranchesServce } from '@shared/services/branches.service';
import { VendorsSerivce } from '@shared/services/vendors.service';
import { ConfirmationDialogComponent } from '@shared/components/confirmation-dialog/confirmation-dialog.component';
import { Globals } from '@core/globals';
import {
  canBookAnyProduct,
  canPickBranchRole,
  isBranchManager,
  isModerator,
} from '@core/utils/role-utils';
import { BookProductDialogComponent } from '../book-product-dialog/book-product-dialog.component';
import { ViewProductBookingDialogComponent } from '../view-product-booking-dialog/view-product-booking-dialog.component';
import { ImportProductsDialogComponent } from '../import-products-dialog/import-products-dialog.component';
import { ProductsImportMetadata } from '@shared/services/products.service';
import { TransferProductBranchDialogComponent } from '../transfer-product-branch-dialog/transfer-product-branch-dialog.component';
import { ProductHistoryDialogComponent } from '../product-history-dialog/product-history-dialog.component';
import { ProductInventoryAuditDialogComponent } from '../product-inventory-audit-dialog/product-inventory-audit-dialog.component';
import { Router } from '@angular/router';
import { StoreSettingsService } from '@shared/services/store-settings.service';

@Component({
  selector: 'app-products-list',
  templateUrl: './products-list.component.html',
  styleUrls: ['./products-list.component.scss']
})
export class ProductsListComponent implements OnInit, OnDestroy {
  productsLoading: boolean = true;
  isFilterOpen: boolean = true;
  paginationPerPage:number = 20;
  categorys: Category[] = [];
  /** Multi-select category filter (API: comma-separated `categoryId`). */
  selectedCategories: string[] = [];
  selectedAttributeKey = '';
  selectedAttributeValue = '';
  attributeKeyOptions: string[] = [];
  productsList: Product[] = [];
  categorysLoading: boolean = false;
  fullscreenEnabled = false;
  searchTerm: string;
  isNotAuthorized: boolean = false;
  iscategoryNotAuthorized: boolean = false;
  /** Multi-select branch filter (API: comma-separated `branchId`). */
  selectedBranches: string[] = [];
  branches: Branch [] = [];
  /** Supplier (vendor) filter — API: `supplier_id` → acquiredFrom.vendorId */
  vendorSearchItems: any[] = [];
  selectedSupplierId: string | null = null;
  selectedSupplierLabel = '';
  vendorsLoading = false;
  readonly vendorTypeahead$ = new Subject<string>();
  private vendorTypeaheadSub?: Subscription;
  /** all | warehouse | branches */
  locationFilter: 'all' | 'warehouse' | 'branches' = 'all';
  /** all | with_bookings | without_bookings — maps to API `booked` */
  bookingFilter: 'all' | 'with_bookings' | 'without_bookings' = 'all';
  onlineFilter: 'all' | 'listed' | 'not_listed' = 'all';

  readonly locationFilterOptions: Array<{ id: 'all' | 'warehouse' | 'branches'; labelKey: string }> = [
    { id: 'all', labelKey: 'tr_location_all' },
    { id: 'warehouse', labelKey: 'tr_warehouse' },
    { id: 'branches', labelKey: 'tr_location_branches_only' },
  ];

  readonly bookingFilterOptions: Array<{
    id: 'all' | 'with_bookings' | 'without_bookings';
    labelKey: string;
  }> = [
    { id: 'all', labelKey: 'tr_products_booking_filter_all' },
    { id: 'with_bookings', labelKey: 'tr_products_booking_filter_with' },
    { id: 'without_bookings', labelKey: 'tr_products_booking_filter_without' },
  ];

  readonly onlineFilterOptions: Array<{
    id: 'all' | 'listed' | 'not_listed';
    labelKey: string;
  }> = [
    { id: 'all', labelKey: 'tr_product_online_filter_all' },
    { id: 'listed', labelKey: 'tr_product_online_filter_yes' },
    { id: 'not_listed', labelKey: 'tr_product_online_filter_no' },
  ];
  totalNumberOfProducts: number;
  viewMode: 'table' | 'cards' = 'cards';

  currentOrder: any = {
    name: '',
    category: ''
  }
  params: any = {
    page: 1,
    limit: this.paginationPerPage,
  };
  categorysParams: any = {
    page: 1,
    limit: 1000,
  };
  paginationData: PaginationData
  categorysPagination: PaginationData
  searchTimeout: any;
  attributeSearchTimeout: any;
  nameSearchTerm: string
  numberSearchTerm: string
  nationalId: string

  private subscriptions: Subscription[] = [];

  constructor(
    private productsService: ProductsSerivce,
    private appNotificationService: AppNotificationService,
    private translateService: TranslateService,
    private dialog: MatDialog,
    private CategoriesServce: CategoriesServce,
    private branchesServce: BranchesServce,
    private vendorsSerivce: VendorsSerivce,
    private globals: Globals,
    private router: Router,
    private storeSettings: StoreSettingsService
  ) { }

  /** Moderator: never create/edit/delete/print products. */
  get canAddProduct(): boolean {
    return !isModerator(this.globals.currentUser?.role);
  }

  /** Moderator: net price must not be visible in the products list. */
  get showNetPrice(): boolean {
    return !isModerator(this.globals.currentUser?.role);
  }

  get showOnlineListingUi(): boolean {
    const s = this.storeSettings.snapshot;
    return (
      Boolean(s.ecommerceIntegrationFeatureAvailable) &&
      Boolean(s.ecommerceIntegrationEnabled) &&
      s.ecommerceCatalogMode !== 'online_only'
    );
  }

  /** Super Admin / Co Admin / Admin / Branch Manager (own branch only); not warehouse products. */
  canTransferProduct(product: Product): boolean {
    if (!product || product.inWarehouse) {
      return false;
    }
    if (isModerator(this.globals.currentUser?.role)) {
      return false;
    }
    const role = this.globals.currentUser?.role as string | undefined;
    if (canPickBranchRole(role)) {
      return true;
    }
    if (!isBranchManager(role)) {
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

  transferReservedQty(product: Product): number {
    return Math.max(0, Math.floor(Number(product.transferReservedQuantity) || 0));
  }

  /** Units available to move to another branch (respects bookings + pending transfer reservations). */
  availableUnitsForBranchTransfer(product: Product): number {
    const stock = Math.max(0, Number(product.stock) || 0);
    const booked = this.bookedQty(product);
    const reserved = this.transferReservedQty(product);
    return Math.max(0, stock - booked - reserved);
  }

  /** Branch Manager may edit/delete only products belonging to their branch (not warehouse / other branches). */
  canBranchManagerModifyProduct(product: Product): boolean {
    if (isModerator(this.globals.currentUser?.role)) {
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

  /** Admins, Warehouse, Moderator: any product. Branch Manager: own branch only (not warehouse). */
  canBookProduct(product: Product): boolean {
    const role = this.globals.currentUser?.role as string | undefined;
    if (canBookAnyProduct(role)) {
      if (!isBranchManager(role)) {
        return true;
      }
    }
    if (!isBranchManager(role)) {
      return false;
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

  showProductActionsMenu(_product: Product): boolean {
    return true;
  }

  openProductHistory(product: Product): void {
    this.dialog.open(ProductHistoryDialogComponent, {
      width: '960px',
      maxWidth: '96vw',
      data: { product },
    });
  }

  /** Build API filter params shared by list + inventory audit. */
  buildProductsFilterParams(): Record<string, string | boolean> {
    const filterParams: Record<string, string | boolean> = {};
    if (this.selectedCategories?.length) {
      filterParams['categoryId'] = this.selectedCategories.filter(Boolean).join(',');
    }
    if (this.selectedAttributeKey && this.selectedAttributeValue) {
      filterParams['attrKey'] = this.selectedAttributeKey;
      filterParams['attrValue'] = this.selectedAttributeValue;
    }
    if (this.bookingFilter === 'with_bookings') {
      filterParams['booked'] = 'true';
    } else if (this.bookingFilter === 'without_bookings') {
      filterParams['booked'] = 'false';
    }
    if (this.showOnlineListingUi) {
      if (this.onlineFilter === 'listed') {
        filterParams['listedOnline'] = 'true';
      } else if (this.onlineFilter === 'not_listed') {
        filterParams['listedOnline'] = 'false';
      }
    }
    if (this.locationFilter === 'warehouse') {
      filterParams['warehouseOnly'] = true;
    } else if (this.locationFilter === 'branches') {
      filterParams['excludeWarehouse'] = true;
      if (this.selectedBranches?.length) {
        filterParams['branchId'] = this.selectedBranches.filter(Boolean).join(',');
      }
    } else if (this.selectedBranches?.length) {
      filterParams['branchId'] = this.selectedBranches.filter(Boolean).join(',');
    }
    if (this.selectedSupplierId) {
      filterParams['supplier_id'] = String(this.selectedSupplierId);
    }
    const search = String(this.nameSearchTerm || this.params['search'] || '').trim();
    if (search) {
      filterParams['search'] = search;
    }
    return filterParams;
  }

  openProductsInventoryAudit(): void {
    clearTimeout(this.searchTimeout);
    clearTimeout(this.attributeSearchTimeout);
    const filterParams = this.buildProductsFilterParams();
    const searchLabel = String(this.nameSearchTerm || this.params['search'] || '').trim();
    this.dialog.open(ProductInventoryAuditDialogComponent, {
      width: '1100px',
      maxWidth: '96vw',
      maxHeight: '92vh',
      panelClass: 'product-inventory-audit-dialog-panel',
      data: { filterParams, searchLabel },
    });
  }

  bookedQty(product: Product): number {
    return Math.max(0, Math.floor(Number(product.bookedQuantity) || 0));
  }

  /** Client or supplier name when device was acquired from someone (optional field). */
  productSourceName(product: Product): string {
    return String(product.acquiredFrom?.displayName || '').trim();
  }

  availableToBook(product: Product): number {
    const stock = Math.max(0, Number(product.stock) || 0);
    const reserved = this.transferReservedQty(product);
    return Math.max(0, stock - this.bookedQty(product) - reserved);
  }

  ngOnInit(): void {
    if (this.globals.currentUser?.role === 'Cashier') {
      this.router.navigate(['/products/serial-track']);
      return;
    }
    const saved = localStorage.getItem('products.viewMode');
    this.viewMode = saved === 'table' ? 'table' : 'cards';
    this.initVendorTypeahead();
    this.getproducts();
    this.getcategorys();
    this.getBranches();
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
    if (!vendorId) {
      this.selectedSupplierLabel = '';
    } else {
      const found = this.vendorSearchItems.find((v) => String(v._id) === String(vendorId));
      this.selectedSupplierLabel = found?.label || found?.nameOfcompany || '';
    }
    this.params.page = 1;
    this.getproducts();
  }

  openSerialTrack(): void {
    this.router.navigate(['/products/serial-track']);
  }

  openTransferProduct(product: Product): void {
    if (!this.canTransferProduct(product)) {
      this.appNotificationService.push(
        this.translateService.instant('tr_product_only_own_branch'),
        'error'
      );
      return;
    }
    const maxQ = this.availableUnitsForBranchTransfer(product);
    if (maxQ <= 0) {
      this.appNotificationService.push(
        this.translateService.instant('tr_branch_transfer_no_capacity'),
        'error'
      );
      return;
    }
    const pid =
      product.branch &&
      (typeof product.branch === 'object' ? (product.branch as Branch)._id : product.branch);
    const branches = (this.branches || []).filter((b) => String(b._id) !== String(pid));
    if (!branches.length) {
      this.appNotificationService.push(
        this.translateService.instant('tr_branch_transfer_no_other_branch'),
        'error'
      );
      return;
    }
    this.dialog
      .open(TransferProductBranchDialogComponent, {
        width: '520px',
        maxWidth: '95vw',
        data: { product, branches, maxQuantity: maxQ },
        disableClose: true,
      })
      .afterClosed()
      .subscribe((ok) => {
        if (ok) {
          this.refreshSidebarPendingCount();
          this.getproducts();
        }
      });
  }

  private refreshSidebarPendingCount(): void {
    const uid = this.globals.currentUser?._id;
    if (!uid) {
      return;
    }
    this.productsService.getPendingBranchTransferCount(String(uid)).subscribe({
      next: (r) => {
        this.globals.pendingBranchTransferCount = Number(r?.count) || 0;
      },
      error: () => {},
    });
  }

  openImportDialog(): void {
    if (!this.canAddProduct) return;
    this.productsService.getProductsImportMetadata().subscribe({
      next: (metadata: ProductsImportMetadata) => {
        this.dialog.open(ImportProductsDialogComponent, {
          width: '900px',
          maxWidth: '95vw',
          panelClass: 'import-products-dialog-panel',
          data: { metadata },
        });
      },
      error: () => {
        this.appNotificationService.push('Failed to load import metadata', 'error');
      },
    });
  }

  setViewMode(mode: 'table' | 'cards'): void {
    this.viewMode = mode;
    localStorage.setItem('products.viewMode', mode);
  }

  productAttributesPairs(p: Product): Array<{ key: string; value: string }> {
    const raw: any = (p as any)?.attributes;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return [];
    }
    const out: Array<{ key: string; value: string }> = [];
    for (const [k, v] of Object.entries(raw)) {
      const key = String(k || '').trim();
      const val = String(v ?? '').trim();
      if (!key || !val) continue;
      out.push({ key, value: val });
    }
    return out.slice(0, 8);
  }

  productAttributesSummary(p: Product): string {
    const pairs = this.productAttributesPairs(p);
    if (!pairs.length) return '—';
    return pairs.map((x) => `${x.key}: ${x.value}`).join(' • ');
  }

  getproducts() {
    this.productsLoading = true;
    delete this.params['branchId'];
    delete this.params['warehouseOnly'];
    delete this.params['excludeWarehouse'];
    delete this.params['booked'];
    delete this.params['categoryId'];
    delete this.params['attrKey'];
    delete this.params['attrValue'];
    delete this.params['search'];
    delete this.params['supplier_id'];
    const filterParams = this.buildProductsFilterParams();
    Object.assign(this.params, filterParams);

    this.subscriptions.push(this.productsService.getProducts(this.params).subscribe((response: any) => {
      this.productsList = response.products
      this.paginationData = response.meta
      this.totalNumberOfProducts = response.meta.totalCount
      this.productsLoading = false;
    },(error:any)=> {
      if(error.status == 403) {
        this.isNotAuthorized = true;
        this.productsLoading = false;
      }
      else {
        this.appNotificationService.push( this.translateService.instant('tr_unexpected_error_message'), 'error');
      }
    }))
  }

  getBranches() {
    let params = {
      'page': 1,
     'limit': 1000
    }
  this.branchesServce.getBranchs(params).subscribe((response: any) => {
      this.branches = response.branches
    })
  }

  getcategorys() {
    this.categorysLoading = true
    this.subscriptions.push(this.CategoriesServce.getCategorys(this.categorysParams).subscribe((response: any) => {
      this.categorysPagination = response.meta;
      this.categorys = this.categorys.concat(response.categories);
      this.refreshAttributeKeyOptions();
      this.categorysLoading = false
    },(error:any)=> {
      if(error.status == 403) {
       this.iscategoryNotAuthorized = true;
       this.categorysLoading = false
      }
    }))
  }

  onCategoryFilterChange(): void {
    this.selectedAttributeKey = '';
    this.selectedAttributeValue = '';
    this.refreshAttributeKeyOptions();
    this.params.page = 1;
    this.getproducts();
  }

  private refreshAttributeKeyOptions(): void {
    if (this.selectedCategories.length !== 1) {
      this.attributeKeyOptions = [];
      this.selectedAttributeKey = '';
      this.selectedAttributeValue = '';
      return;
    }
    const c = this.categorys?.find((x) => String(x._id) === String(this.selectedCategories[0]));
    const defs = Array.isArray((c as any)?.attributeDefs) ? (c as any).attributeDefs : [];
    this.attributeKeyOptions = defs
      .map((d: any) => String(d?.key ?? d ?? '').trim())
      .filter((k: string) => !!k);
  }

  applyAttributeSearch(): void {
    this.params.page = 1;
    this.getproducts();
  }

  applyAttributeSearchDebounced(): void {
    clearTimeout(this.attributeSearchTimeout);
    this.attributeSearchTimeout = setTimeout(() => {
      this.applyAttributeSearch();
    }, 350);
  }
  nextBatch() {
    if (this.categorysPagination.nextPage) {
      this.categorysLoading = true;
      this.categorysParams.page = this.categorysPagination.nextPage;
      this.getcategorys();
    }
  }

  filterproducts(term: any, searchKey: string) {
    clearTimeout(this.searchTimeout);
    this.searchTimeout = setTimeout(() => {
      term = (searchKey == 'by_category_id') ? term : term.target.value.trim()
      this.params['search'] = term;
      this.params.page = 1;
      this.getproducts();
    }, 500);
  }
  paginationUpdate(page: number) {
    this.params.page = page;
    this.getproducts();
  }


  deleteProduct(product: Product) {
    if (!this.canBranchManagerModifyProduct(product)) {
      this.appNotificationService.push(
        this.translateService.instant('tr_product_only_own_branch'),
        'error'
      );
      return;
    }
    const productId = product._id;
    let confirmationData = {
      title: this.translateService.instant('tr_confirmation_message'),
      buttons: [
        {
          label: this.translateService.instant('tr_action.cancel'),
          actionCallback: 'cancel',
          type: 'btn-secondary'
        },
        {
          label: this.translateService.instant('tr_action.delete'),
          actionCallback: 'delete',
          type: 'btn-danger'
        },
      ]
    };
    let dialogRef = this.dialog.open(ConfirmationDialogComponent, {
      width: '450px',
      data: confirmationData,
      disableClose: true,
    });
    dialogRef.afterClosed().subscribe(result => {
      if (result != 'delete') {
        return;
      }
      this.productsService
        .deleteProduct(productId, this.globals.currentUser?._id)
        .subscribe(() => {
        this.params.page = 1;
          this.getproducts()
  
      })
    });


  }
  createOrEditproduct(isEdit: boolean, product?: Product) {
    if (isEdit && product && !this.canBranchManagerModifyProduct(product)) {
      this.appNotificationService.push(
        this.translateService.instant('tr_product_only_own_branch'),
        'error'
      );
      return;
    }
    let dialogRef = this.dialog.open(CreateEditProductComponent, {
      width: '850px',
      data: {isEdit:isEdit,product:product, productId: product?._id},
      disableClose: true,
  });
  dialogRef.afterClosed().subscribe(event => {
    if(event){
       this.getproducts();
    }
  })
  }
  printbarCode(product: Product) {
    if (!this.canBranchManagerModifyProduct(product)) {
      this.appNotificationService.push(
        this.translateService.instant('tr_product_only_own_branch'),
        'error'
      );
      return;
    }
    const bv = productBarcodeAttributeValues(
      product.category,
      product.attributes
    );
    const printPrice =
      product.price != null && Number.isFinite(Number(product.price))
        ? Number(product.price)
        : undefined;
    this.productsService
      .getBarcodeImage(product.code, product.name, bv, printPrice)
      .subscribe((html: any) => {
        this.printHtml(html);
      });
  }
  openBookProduct(product: Product): void {
    if (!this.canBookProduct(product)) {
      this.appNotificationService.push(
        this.translateService.instant('tr_product_only_own_branch'),
        'error'
      );
      return;
    }
    if (this.availableToBook(product) <= 0) {
      this.appNotificationService.push(this.translateService.instant('tr_booking_no_stock'), 'error');
      return;
    }
    const maxQ = this.availableToBook(product);
    if (maxQ <= 0) {
      this.appNotificationService.push(this.translateService.instant('tr_booking_no_capacity'), 'error');
      return;
    }
    this.dialog
      .open(BookProductDialogComponent, {
        width: '640px',
        data: { product, maxQuantity: maxQ },
        disableClose: true,
      })
      .afterClosed()
      .subscribe((ok) => {
        if (ok) {
          this.getproducts();
        }
      });
  }

  openBookingDetails(product: Product): void {
    if (!this.canBookProduct(product)) {
      this.appNotificationService.push(
        this.translateService.instant('tr_product_only_own_branch'),
        'error'
      );
      return;
    }
    this.openViewBookingDialog(product);
  }

  private openViewBookingDialog(product: Product): void {
    this.dialog
      .open(ViewProductBookingDialogComponent, {
        width: '680px',
        data: { product, canAddBooking: this.canBookProduct(product) },
        disableClose: true,
      })
      .afterClosed()
      .subscribe((ok) => {
        if (ok) {
          this.getproducts();
        }
      });
  }

  printHtml(html: string) {
    const printWindow = window.open('', '_blank', 'width=600,height=400');
    
    if (!printWindow) return;
  
    printWindow.document.open();
    printWindow.document.write(html);
  

    printWindow.document.write(`
      <script>
        window.onload = function() {
          window.print();
        };
        window.onafterprint = function() {
          window.close();
        };
      </script>
    `);
  
    printWindow.document.close();
  }
  
  

  ngOnDestroy() {
    this.vendorTypeaheadSub?.unsubscribe();
    this.subscriptions.forEach(s => s && s.unsubscribe())
  }

}

