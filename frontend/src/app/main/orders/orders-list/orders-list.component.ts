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
import { Branch, Order } from '@core/models/products.model';
import { AddOrderComponent } from '../add-order/add-order.component';
import { AuthenticationService } from '@core/services/authentication.service';
import { DashboardService } from '@shared/services/dashboard.service';
import { orderStatistics } from '@core/models/dashboard.model';
import { BranchesServce } from '@shared/services/branches.service';

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
  isToday: boolean = true;
  status = ['restored','completed']
  selectedStatus: string;

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
  curentUser:any;
  orderStatistics: orderStatistics
  today:Date = new Date();
  fromDate: Date =new Date();
  toDate: Date = new Date();
  selectedBranchId: string ;
  branches:Branch[] =[]

  private subscriptions: Subscription[] = [];

  constructor(
    private ordersService: OrdersSerivce,
    private appNotificationService: AppNotificationService,
    private translateService: TranslateService,
    private globals: Globals,
    private dialog: MatDialog,
    private CategoriesServce: CategoriesServce,
    private authenticationService: AuthenticationService,
    private dashboardService: DashboardService,
    private branchesServce: BranchesServce
  ) { }


  ngOnInit(): void {
    this.getOrders();
    this.getOrderStatistics();
    this.getBranches();
  }
  getBranches() {
    let params = {
      'page': 1,
     'per_page': 1000
    }
  this.branchesServce.getBranchs(params).subscribe((response: any) => {
      this.branches = response.branches
    })
  }

  getOrders() {
   this.curentUser = this.authenticationService.getUserFromLocalStorage();
   if( this.curentUser.role == 'Employee'){
    this.params.searchBranch = this.curentUser.branch?.name
   }
   if(this.selectedStatus){
    this.params['status'] = this.selectedStatus
   }
   else {
    delete  this.params['status'] 
   }

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
      this.params[searchKey] = term;
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
       this.getOrderStatistics();
    }
  })
  }

  getOrderStatistics(){
    const today = new Date();
    this.isToday = 
      [this.fromDate, this.toDate].every(d =>
        new Date(d).toDateString() === today.toDateString()
      );


    let params ={
      from:  this.fromDate.toLocaleDateString('en-CA'),
      to:   this.toDate.toLocaleDateString('en-CA'),
      branch: this.curentUser.role == 'Super Admin' ? this.selectedBranchId :this.globals.currentUser.branch._id,
    }
    if( this.curentUser.role == 'Employee'){
      this.params.branch = this.curentUser.branch?._id
     }

    this.dashboardService.getDashboardStats(params).subscribe(res=> {
      this.orderStatistics = res;  
    })
  }

  restoreOrder(orderId: string): void {

    this.ordersService.restoreOrder(orderId).subscribe({
      next: (res) => {
        this.appNotificationService.push( this.translateService.instant('Order restored successfully!'), 'success');
        // refresh orders list
     this.getOrders();
     this.getOrderStatistics();
      },
      error: (err) => {
        this.appNotificationService.push( this.translateService.instant('tr_unexpected_error_message'), 'error');
      }
    });
  }



  ngOnDestroy() {
    this.subscriptions.forEach(s => s && s.unsubscribe())
  }

}

