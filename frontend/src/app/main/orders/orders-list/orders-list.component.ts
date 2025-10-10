import { Component, OnInit } from '@angular/core';
import { CategoriesServce } from './../../../shared/services/categories.service';
import { MatDialog } from '@angular/material/dialog';
// import { ordersSerivce } from '@shared/services/orders.services';
import { PaginationData, User } from '@core/models/users-interfaces.model'
// import { category, order } from '@core/models/orders-interface.model'
import { Subscription } from 'rxjs';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { TranslateService } from '@ngx-translate/core';
import { Globals } from '@core/globals';
import { UserSerivce } from '@shared/services/user.service';
// import { Category, Order } from '@core/models/orders.model';
import { OrdersSerivce } from '@shared/services/orders.service';
import { Order } from '@core/models/products.model';
import { AddOrderComponent } from '../add-order/add-order.component';

@Component({
  selector: 'app-orders-list',
  templateUrl: './orders-list.component.html',
  styleUrls: ['./orders-list.component.scss']
})
export class OrdersListComponent implements OnInit {
  ordersLoading: boolean = true;
  isFilterOpen: boolean = true;
  paginationPerPage:number = 10;
  ordersList: Order[] = [];
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
    private ordersService: OrdersSerivce,
    private appNotificationService: AppNotificationService,
    private translateService: TranslateService,
    private globals: Globals,
    private dialog: MatDialog,
    private CategoriesServce: CategoriesServce
  ) { }


  ngOnInit(): void {
    this.getOrders();
  }

  getOrders() {
    this.ordersLoading = true;
    this.subscriptions.push(this.ordersService.getOrders(this.params).subscribe((response: any) => {
      this.ordersList = response.orders
      this.paginationData = response.meta
      this.ordersLoading = false;
    },(error:any)=> {
      if(error.status == 403) {
        this.isNotAuthorized = true;
        this.ordersLoading = false;
      }
      else {
        this.appNotificationService.push( this.translateService.instant('tr_unexpected_error_message'), 'error');
      }
    }))
  }


  filterorders(term: any, searchKey: string) {
    clearTimeout(this.searchTimeout);
    this.searchTimeout = setTimeout(() => {
      term = (searchKey == 'by_category_id') ? term : term.target.value.trim()
      this.params['search'] = term;
      this.params.page = 1;
      this.getOrders();
    }, 500);
  }
  paginationUpdate(page: number) {
    this.params.page = page;
    this.getOrders();
  }

  createOrEditOrder(isEdit: boolean, order?: Order){
    let dialogRef = this.dialog.open(AddOrderComponent, {
      width: '850px',
      data: {isEdit:isEdit,order:order, orderId: order?._id},
      disableClose: true,
  });
  dialogRef.afterClosed().subscribe(event => {
    if(event){
       this.getOrders();
    }
  })
  }



  ngOnDestroy() {
    this.subscriptions.forEach(s => s && s.unsubscribe())
  }

}

