import { CategoriesServce } from './../../../shared/services/categories.service';
import { MatDialog } from '@angular/material/dialog';
import { Component, OnInit } from '@angular/core';
// import { productsSerivce } from '@shared/services/products.services';
import { PaginationData } from '@core/models/users-interfaces.model'
// import { category, product } from '@core/models/products-interface.model'
import { Subscription } from 'rxjs';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { TranslateService } from '@ngx-translate/core';
import { Branch, Category, Product } from '@core/models/products.model';
import { CreateEditProductComponent } from '../create-edit-product/create-edit-product.component';
import { ProductsSerivce } from '@shared/services/products.service';
import { BranchesServce } from '@shared/services/branches.service';
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

@Component({
  selector: 'app-products-list',
  templateUrl: './products-list.component.html',
  styleUrls: ['./products-list.component.scss']
})
export class ProductsListComponent implements OnInit {
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
  /** all | warehouse | branches */
  locationFilter: 'all' | 'warehouse' | 'branches' = 'all';
  /** all | with_bookings | without_bookings — maps to API `booked` */
  bookingFilter: 'all' | 'with_bookings' | 'without_bookings' = 'all';

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
    per_page: 10,
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
    private globals: Globals
  ) { }

  /** Moderator: never create/edit/delete/print products. */
  get canAddProduct(): boolean {
    return !isModerator(this.globals.currentUser?.role);
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

  showProductActionsMenu(product: Product): boolean {
    return this.canBranchManagerModifyProduct(product) || this.canBookProduct(product);
  }

  bookedQty(product: Product): number {
    return Math.max(0, Math.floor(Number(product.bookedQuantity) || 0));
  }

  availableToBook(product: Product): number {
    const stock = Math.max(0, Number(product.stock) || 0);
    return Math.max(0, stock - this.bookedQty(product));
  }

  ngOnInit(): void {
    const saved = localStorage.getItem('products.viewMode');
    this.viewMode = saved === 'table' ? 'table' : 'cards';
    this.getproducts();
    this.getcategorys();
    this.getBranches();
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
    if (this.selectedCategories?.length) {
      this.params['categoryId'] = this.selectedCategories.filter(Boolean).join(',');
    }
    if (this.selectedAttributeKey && this.selectedAttributeValue) {
      this.params['attrKey'] = this.selectedAttributeKey;
      this.params['attrValue'] = this.selectedAttributeValue;
    }

    if (this.bookingFilter === 'with_bookings') {
      this.params['booked'] = 'true';
    } else if (this.bookingFilter === 'without_bookings') {
      this.params['booked'] = 'false';
    }

    if (this.locationFilter === 'warehouse') {
      this.params['warehouseOnly'] = true;
    } else if (this.locationFilter === 'branches') {
      this.params['excludeWarehouse'] = true;
      if (this.selectedBranches?.length) {
        this.params['branchId'] = this.selectedBranches.filter(Boolean).join(',');
      }
    } else {
      if (this.selectedBranches?.length) {
        this.params['branchId'] = this.selectedBranches.filter(Boolean).join(',');
      }
    }

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
      this.productsService.deleteProduct(productId).subscribe(() => {
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
    this.productsService.getBarcodeImage(product.code, product.name).subscribe((html: any) => {
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
    if (product.stock === 0) {
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
    this.subscriptions.forEach(s => s && s.unsubscribe())
  }

}

