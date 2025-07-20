import { CategoriesServce } from './../../../shared/services/categories.service';
import { MatDialog } from '@angular/material/dialog';
import { Component, OnInit } from '@angular/core';
// import { productsSerivce } from '@shared/services/products.services';
import { PaginationData, User } from '@core/models/users-interfaces.model'
// import { category, product } from '@core/models/products-interface.model'
import { Subscription } from 'rxjs';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { TranslateService } from '@ngx-translate/core';
import { Globals } from '@core/globals';
import { UserSerivce } from '@shared/services/user.service';
import { Category, Product } from '@core/models/products.model';
import { CreateEditProductComponent } from '../create-edit-product/create-edit-product.component';
import { ProductsSerivce } from '@shared/services/products.service';

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

  currentOrder: any = {
    name: '',
    category: ''
  }
  params: any = {
    page: 1,
    perPage: this.paginationPerPage,
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
    private globals: Globals,
    private dialog: MatDialog,
    private CategoriesServce: CategoriesServce
  ) { }

  ngOnInit(): void {
    this.getproducts();
    this.getcategorys();
  }
  getproducts() {
    this.productsLoading = true;
    this.subscriptions.push(this.productsService.getProducts(this.params).subscribe((response: any) => {
      this.productsList = response.products
      this.paginationData = response.meta
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

  createOrEditproduct(isEdit: boolean, product?: Product){
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

  deleteProduct(productId: string){
    this.productsService.deleteProduct(productId).subscribe(() => {
      this.params.page = 1;
        this.getproducts()

    })
  }

  ngOnDestroy() {
    this.subscriptions.forEach(s => s && s.unsubscribe())
  }

}

