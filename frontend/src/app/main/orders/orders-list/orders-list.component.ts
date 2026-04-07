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
import { PayOrderDialogComponent } from '../pay-order-dialog/pay-order-dialog.component';
import { AuthenticationService } from '@core/services/authentication.service';
import { DashboardService } from '@shared/services/dashboard.service';
import { orderStatistics } from '@core/models/dashboard.model';
import { BranchesServce } from '@shared/services/branches.service';
import { canPickBranchRole } from '@core/utils/role-utils';
import { ConfirmationDialogComponent } from '@shared/components/confirmation-dialog/confirmation-dialog.component';
import {
  PAYMENT_METHOD_OPTIONS,
  PaymentMethodOption,
} from '@shared/constants/payment-method-options';

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
  /** null = no filter (all payment methods) */
  selectedPaymentMethod: string | null = null;
  readonly paymentMethodOptions: PaymentMethodOption[] = PAYMENT_METHOD_OPTIONS;

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

  orderPaid(order: Order): number {
    return Math.max(0, Number(order.amountPaid) || 0);
  }

  orderRemaining(order: Order): number {
    const total = Number(order.totalPrice) || 0;
    const paid = this.orderPaid(order);
    return Math.max(0, Math.round((total - paid) * 100) / 100);
  }

  canPayOrder(order: Order): boolean {
    if (!order?._id) return false;
    if (order.status === 'restored') return false;
    return this.orderRemaining(order) > 0;
  }

  openPayDialog(order: Order): void {
    const ref = this.dialog.open(PayOrderDialogComponent, {
      width: '520px',
      data: { order },
      disableClose: true,
    });
    ref.afterClosed().subscribe((ok) => {
      if (ok) {
        this.getOrders();
        this.getOrderStatistics();
      }
    });
  }


  ngOnInit(): void {
    this.getOrders();
    this.getOrderStatistics();
    this.getBranches();
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

  getOrders() {
   this.curentUser = this.authenticationService.getUserFromLocalStorage();
   if (this.curentUser.role === 'Cashier' || this.curentUser.role === 'Branch Manager') {
    this.params.searchBranch = this.curentUser.branch?.name;
   }
   if(this.selectedStatus){
    this.params['status'] = this.selectedStatus
   }
   else {
    delete  this.params['status'] 
   }

    if (this.selectedPaymentMethod) {
      this.params['paymentMethod'] = this.selectedPaymentMethod;
    } else {
      delete this.params['paymentMethod'];
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

  onPaymentMethodFilterChange(): void {
    this.params.page = 1;
    this.getOrders();
  }

  /** Subtotal after line discounts, before invoice-level discount (legacy orders: falls back to total). */
  orderSubtotalForList(order: Order): number {
    const s = order.subtotalPrice;
    if (s != null && Number.isFinite(Number(s))) {
      return Number(s);
    }
    return Number(order.totalPrice) || 0;
  }

  orderInvoiceExtraDiscount(order: Order): number {
    const d = order.invoiceDiscountAmount;
    if (d == null || !Number.isFinite(Number(d))) return 0;
    return Math.max(0, Number(d));
  }

  /** Translate stored order.paymentMethod id for display. */
  paymentMethodLabel(method: string | undefined): string {
    if (!method) {
      return '—';
    }
    const opt = this.paymentMethodOptions.find((o) => o.id === method);
    return opt
      ? this.translateService.instant(opt.labelKey)
      : method;
  }

  createOrEditOrder(isEdit: boolean, order?: Order){
    let dialogRef = this.dialog.open(AddOrderComponent, {
      width: '1000px',
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
      branch: canPickBranchRole(this.curentUser?.role)
        ? this.selectedBranchId
        : this.globals.currentUser.branch._id,
    }
    if (this.curentUser.role === 'Cashier') {
      this.params.branch = this.curentUser.branch?._id
     }

    this.dashboardService.getDashboardStats(params).subscribe(res=> {
      this.orderStatistics = res;  
    })
  }

  restoreOrder(orderId: string): void {
    let confirmationData = {
      title: this.translateService.instant('tr_confirmation_message'),
      buttons: [
        {
          label: this.translateService.instant('tr_action.cancel'),
          actionCallback: 'cancel',
          type: 'btn-secondary'
        },
        {
          label: this.translateService.instant('tr_action.restore'),
          actionCallback: 'restore',
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
      if (result != 'restore') {
        return;
      }
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
    });



  }



  ngOnDestroy() {
    this.subscriptions.forEach(s => s && s.unsubscribe())
  }

}

