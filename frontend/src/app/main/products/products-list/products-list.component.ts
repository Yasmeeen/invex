import { CategoriesServce } from './../../../shared/services/categories.service';
import { MatDialog } from '@angular/material/dialog';
import { Component, OnInit } from '@angular/core';
// import { productsSerivce } from '@shared/services/products.services';
import { PaginationData } from '@core/models/users-interfaces.model'
// import { category, product } from '@core/models/products-interface.model'
import { Subscription } from 'rxjs';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { TranslateService } from '@ngx-translate/core';
import { Branch, Category, Product, ProductActiveBooking } from '@core/models/products.model';
import { CreateEditProductComponent } from '../create-edit-product/create-edit-product.component';
import { ProductsSerivce } from '@shared/services/products.service';
import { BranchesServce } from '@shared/services/branches.service';
import { ConfirmationDialogComponent } from '@shared/components/confirmation-dialog/confirmation-dialog.component';
import { Globals } from '@core/globals';
import { canPickBranchRole, isBranchManager } from '@core/utils/role-utils';
import { BookProductDialogComponent } from '../book-product-dialog/book-product-dialog.component';
import { ViewProductBookingDialogComponent } from '../view-product-booking-dialog/view-product-booking-dialog.component';
import { ProductBookingsService } from '@shared/services/product-bookings.service';

@Component({
  selector: 'app-products-list',
  templateUrl: './products-list.component.html',
  styleUrls: ['./products-list.component.scss']
})
export class ProductsListComponent implements OnInit {
  productsLoading: boolean = true;
  isFilterOpen: boolean = true;
  paginationPerPage:number = 10;
  categorys: Category[] = [];
  selectedcategory: string;
  productsList: Product[] = [];
  categorysLoading: boolean = false;
  fullscreenEnabled = false;
  searchTerm: string;
  isNotAuthorized: boolean = false;
  iscategoryNotAuthorized: boolean = false;
  selectedBranch: string ;
  branches: Branch [] = [];
  /** all | warehouse | branches */
  locationFilter: 'all' | 'warehouse' | 'branches' = 'all';
  totalNumberOfProducts: number;

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
    private globals: Globals,
    private productBookingsService: ProductBookingsService
  ) { }

  /** Branch Manager may edit/delete only products belonging to their branch (not warehouse / other branches). */
  canBranchManagerModifyProduct(product: Product): boolean {
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

  /** Super Admin / Co Admin: any product. Branch Manager: own branch only (not warehouse). */
  canBookProduct(product: Product): boolean {
    const role = this.globals.currentUser?.role as string | undefined;
    if (canPickBranchRole(role)) {
      return true;
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

  ngOnInit(): void {
    this.getproducts();
    this.getcategorys();
    this.getBranches();
  }

  getproducts() {
    this.productsLoading = true;
    delete this.params['branchId'];
    delete this.params['warehouseOnly'];
    delete this.params['excludeWarehouse'];

    if (this.locationFilter === 'warehouse') {
      this.params['warehouseOnly'] = true;
    } else if (this.locationFilter === 'branches') {
      this.params['excludeWarehouse'] = true;
      if (this.selectedBranch) {
        this.params['branchId'] = this.selectedBranch;
      }
    } else {
      if (this.selectedBranch) {
        this.params['branchId'] = this.selectedBranch;
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
      this.categorysLoading = false
    },(error:any)=> {
      if(error.status == 403) {
       this.iscategoryNotAuthorized = true;
       this.categorysLoading = false
      }
    }))
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
    if (product.bookingStatus === 'active') {
      this.appNotificationService.push(this.translateService.instant('tr_booking_already_active'), 'error');
      return;
    }
    this.dialog
      .open(BookProductDialogComponent, {
        width: '640px',
        data: { product },
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
    const fromList = product.activeBooking as ProductActiveBooking | undefined;
    if (fromList?._id) {
      this.openViewBookingDialog(product, fromList);
      return;
    }
    this.productBookingsService.getByProductId(product._id).subscribe({
      next: (res: { booking: ProductActiveBooking | null }) => {
        if (res?.booking && (res.booking as ProductActiveBooking)._id) {
          this.openViewBookingDialog(product, res.booking as ProductActiveBooking);
        } else {
          this.appNotificationService.push(
            this.translateService.instant('tr_booking_not_found'),
            'error'
          );
        }
      },
      error: () => {
        this.appNotificationService.push(
          this.translateService.instant('tr_unexpected_error_message'),
          'error'
        );
      },
    });
  }

  private openViewBookingDialog(product: Product, booking: ProductActiveBooking): void {
    this.dialog
      .open(ViewProductBookingDialogComponent, {
        width: '520px',
        data: { product, booking },
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

