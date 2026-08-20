import { Component, Input, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
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
import { Branch, Order, OrderPartyType } from '@core/models/products.model';
import { AddOrderComponent } from '../add-order/add-order.component';
import { PayOrderDialogComponent } from '../pay-order-dialog/pay-order-dialog.component';
import { InvoiceReturnDialogComponent } from '../invoice-return-dialog/invoice-return-dialog.component';
import { InvoiceReturnDetailsDialogComponent } from '../invoice-return-details-dialog/invoice-return-details-dialog.component';
import { AuthenticationService } from '@core/services/authentication.service';
import { DashboardService } from '@shared/services/dashboard.service';
import { orderStatistics } from '@core/models/dashboard.model';
import { BranchesServce } from '@shared/services/branches.service';
import { canPickBranchRole } from '@core/utils/role-utils';
import {
  canReturnOrder as canReturnOrderCheck,
  hasOrderReturns,
  isPayLaterMethod,
  isPayLaterOutstanding,
  isPayLaterSettled,
  orderDisplayPaid,
  orderDisplayRemaining,
} from '@core/utils/order-display.util';
import {
  PAYMENT_METHOD_OPTIONS,
  PaymentMethodOption,
} from '@shared/constants/payment-method-options';
import { formatCairoDMY, formatCairoYMD } from '@core/utils/date-tz.util';
import { paymentMethodDisplayLabel } from '@shared/utils/cashier-payment-methods.util';
import { StoreSettingsService } from '@shared/services/store-settings.service';
import { InvoiceReprintService } from '@shared/services/invoice-reprint.service';

@Component({
  selector: 'app-orders-list',
  templateUrl: './orders-list.component.html',
  styleUrls: ['./orders-list.component.scss']
})
export class OrdersListComponent implements OnInit {
  /** When embedded under unified invoices page, show subsection title instead of main page title. */
  @Input() asSection = false;

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
  status = ['restored', 'partially_restored', 'completed'];
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
  /** `null` = no date filter in stats (all time). */
  fromDate: Date | null = new Date();
  toDate: Date | null = new Date();
  /** List filter dates (second filter card); independent from stats dates. */
  listFromDate: Date | null = null;
  listToDate: Date | null = null;
  selectedBranchId: string | null;
  branches:Branch[] =[]
  /** null = no filter (all payment methods) */
  selectedPaymentMethod: string | null = null;
  readonly paymentMethodOptions: PaymentMethodOption[] = PAYMENT_METHOD_OPTIONS;
  /** Filter installment invoices by plan months (null = all). */
  selectedInstallmentMonths: number | null = null;
  readonly installmentMonthsOptions = [6, 12, 18, 24, 36];
  viewMode: 'table' | 'cards' = 'cards';

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
    private branchesServce: BranchesServce,
    private storeSettings: StoreSettingsService,
    private invoiceReprint: InvoiceReprintService,
    private route: ActivatedRoute,
    private router: Router
  ) { }

  orderPaid(order: Order): number {
    return orderDisplayPaid(order);
  }

  orderRemaining(order: Order): number {
    return orderDisplayRemaining(order);
  }

  orderPartyType(order: Order): OrderPartyType {
    return order?.partyType === 'supplier' ? 'supplier' : 'client';
  }

  orderPartyTypeLabel(order: Order): string {
    return this.orderPartyType(order) === 'supplier'
      ? this.translateService.instant('tr_party_supplier')
      : this.translateService.instant('tr_party_client');
  }

  /** بيع بالآجل (paymentMethod = credit). */
  isPayLaterOrder(order: Order): boolean {
    return isPayLaterMethod(order?.paymentMethod);
  }

  /** بيع بالآجل وما زال عليه متبقي. */
  isPayLaterOutstandingOrder(order: Order): boolean {
    return isPayLaterOutstanding(order);
  }

  /** بيع بالآجل وتم السداد بالكامل. */
  isPayLaterSettledOrder(order: Order): boolean {
    return isPayLaterSettled(order);
  }

  canPayOrder(order: Order): boolean {
    if (!order?._id) return false;
    if (order.status === 'restored') return false;
    if (!isPayLaterMethod(order.paymentMethod)) return false;
    return orderDisplayRemaining(order) > 0;
  }

  canReturnOrder(order: Order): boolean {
    return canReturnOrderCheck(order);
  }

  showOrderActions(order: Order): boolean {
    return (
      this.canPrintOrder(order) ||
      this.canReturnOrder(order) ||
      this.canPayOrder(order) ||
      this.hasReturnDetails(order)
    );
  }

  hasReturnDetails(order: Order): boolean {
    return hasOrderReturns(order);
  }

  canPrintOrder(order: Order): boolean {
    return !!order?._id;
  }

  printOrder(order: Order): void {
    if (!this.canPrintOrder(order)) {
      return;
    }
    this.ordersService.getOrder(order._id).subscribe({
      next: (full: any) => {
        this.invoiceReprint.printSale(full);
      },
      error: () => {
        this.appNotificationService.push(
          this.translateService.instant('tr_unexpected_error_message'),
          'error'
        );
      },
    });
  }

  openPayDialog(order: Order): void {
    const ref = this.dialog.open(PayOrderDialogComponent, {
      width: '520px',
      maxWidth: '96vw',
      panelClass: 'pay-order-dialog-panel',
      backdropClass: 'pay-order-dialog-backdrop',
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
    const saved = localStorage.getItem('orders.viewMode');
    this.viewMode = saved === 'table' ? 'table' : 'cards';

    const qp = this.route.snapshot.queryParamMap;
    const section = String(qp.get('section') || '').trim().toLowerCase();
    const search = (qp.get('search') || '').trim();
    const printOrderId = (qp.get('printOrderId') || '').trim();

    // Purchase deep-links use the same `search` param on the purchases tab.
    if (section !== 'purchases' && search) {
      this.nameSearchTerm = search;
      this.params.search = search;
      this.params.page = 1;
    }

    this.getOrders();
    this.getOrderStatistics();
    this.getBranches();

    if (printOrderId) {
      this.printOrder({ _id: printOrderId } as Order);
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: {},
        replaceUrl: true,
      });
    }
  }

  setViewMode(mode: 'table' | 'cards'): void {
    this.viewMode = mode;
    localStorage.setItem('orders.viewMode', mode);
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

    if (this.selectedInstallmentMonths) {
      this.params['installmentPlanMonths'] = this.selectedInstallmentMonths;
      if (!this.selectedPaymentMethod) {
        this.params['paymentMethod'] = 'installment';
      }
    } else {
      delete this.params['installmentPlanMonths'];
    }

    if (this.listFromDate) {
      this.params.from = formatCairoYMD(this.listFromDate);
    } else {
      delete this.params.from;
    }
    if (this.listToDate) {
      this.params.to = formatCairoYMD(this.listToDate);
    } else {
      delete this.params.to;
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

  onInstallmentMonthsFilterChange(): void {
    if (this.selectedInstallmentMonths && this.selectedPaymentMethod !== 'installment') {
      this.selectedPaymentMethod = 'installment';
    }
    this.params.page = 1;
    this.getOrders();
  }

  onListDateFilterChange(): void {
    this.params.page = 1;
    this.getOrders();
  }

  clearListDateFilters(): void {
    this.listFromDate = null;
    this.listToDate = null;
    this.onListDateFilterChange();
  }

  get hasListDateFilterToClear(): boolean {
    return this.listFromDate != null || this.listToDate != null;
  }

  clearDateFilters(): void {
    this.fromDate = null;
    this.toDate = null;
    this.selectedBranchId = null;
    this.getOrderStatistics();
  }

  get hasDateFilterToClear(): boolean {
    return this.fromDate != null || this.toDate != null || this.selectedBranchId != null;
  }

  /** Subtotal after line discounts, before invoice-level discount (legacy orders: falls back to total). */
  orderSubtotalForList(order: Order): number {
    const s = order.subtotalPrice;
    if (s != null && Number.isFinite(Number(s))) {
      return Number(s);
    }
    return Number(order.totalPrice) || 0;
  }

  /** Positive invoice-level discount (EGP); excludes surcharge. */
  orderInvoiceExtraDiscount(order: Order): number {
    const d = order.invoiceDiscountAmount;
    if (d == null || !Number.isFinite(Number(d)) || Number(d) <= 0) return 0;
    return Number(d);
  }

  /** Positive surcharge when final total was above subtotal (stored as negative discount). */
  orderInvoiceSurcharge(order: Order): number {
    const d = order.invoiceDiscountAmount;
    if (d == null || !Number.isFinite(Number(d)) || Number(d) >= 0) return 0;
    return Math.round(-Number(d) * 100) / 100;
  }

  /** Display stored order.paymentMethod (store settings label when configured). */
  paymentMethodLabel(method: string | undefined): string {
    if (!method) {
      return '—';
    }
    return paymentMethodDisplayLabel(
      method,
      this.storeSettings.snapshot.paymentAppFeePercents,
      this.translateService
    );
  }

  createdAtCairo(order: Order): string {
    return formatCairoDMY(order?.createdAt as any);
  }

  orderStatusLabel(status: string | undefined): string {
    const s = String(status || '').toLowerCase();
    if (s === 'completed') {
      return this.translateService.instant('tr_chart_completed');
    }
    if (s === 'partially_restored') {
      return this.translateService.instant('tr_purchase_invoice_status_partially_returned');
    }
    if (s === 'restored') {
      return this.translateService.instant('tr_restored');
    }
    return status || '—';
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
    if (this.fromDate == null && this.toDate == null) {
      this.isToday = false;
    } else {
      this.isToday =
        this.fromDate != null &&
        this.toDate != null &&
        [this.fromDate, this.toDate].every(
          (d) => new Date(d).toDateString() === today.toDateString()
        );
    }

    const params: {
      from?: string;
      to?: string;
      branch?: string;
    } = {};
    if (canPickBranchRole(this.curentUser?.role)) {
      if (this.selectedBranchId) {
        params.branch = this.selectedBranchId;
      }
    } else if (this.globals.currentUser?.branch?._id) {
      params.branch = this.globals.currentUser.branch._id;
    }
    if (this.fromDate) {
      params.from = formatCairoYMD(this.fromDate);
    }
    if (this.toDate) {
      params.to = formatCairoYMD(this.toDate);
    }
    if (this.curentUser.role === 'Cashier') {
      this.params.branch = this.curentUser.branch?._id
     }

    this.dashboardService.getDashboardStats(params).subscribe(res=> {
      this.orderStatistics = res;  
    })
  }

  restoreOrder(order: Order): void {
    if (!order?._id) return;
    this.ordersService.getOrder(order._id).subscribe({
      next: (full: any) => {
        const fresh: Order = full?.order || full;
        if (!this.canReturnOrder(fresh)) {
          this.getOrders();
          return;
        }
        this.openReturnDialog(fresh);
      },
      error: () => {
        this.appNotificationService.push(
          this.translateService.instant('tr_unexpected_error_message'),
          'error'
        );
      },
    });
  }

  openReturnDetails(order: Order): void {
    if (!order?._id) return;
    const open = (doc: Order) => {
      this.dialog.open(InvoiceReturnDetailsDialogComponent, {
        width: '640px',
        maxWidth: '96vw',
        panelClass: 'invoice-return-dialog-panel',
        backdropClass: 'invoice-return-dialog-backdrop',
        data: { mode: 'sales', order: doc },
      });
    };
    if (hasOrderReturns(order) && order.returns?.length) {
      open(order);
      return;
    }
    this.ordersService.getOrder(order._id).subscribe({
      next: (full: any) => open(full?.order || full),
      error: () => {
        this.appNotificationService.push(
          this.translateService.instant('tr_unexpected_error_message'),
          'error'
        );
      },
    });
  }

  private openReturnDialog(order: Order): void {
    const branchId =
      this.curentUser?.role === 'Cashier' || this.curentUser?.role === 'Branch Manager'
        ? this.curentUser?.branch?._id || this.curentUser?.branch
        : order.branch?._id || order.branch;

    const ref = this.dialog.open(InvoiceReturnDialogComponent, {
      width: '720px',
      maxWidth: '96vw',
      panelClass: 'invoice-return-dialog-panel',
      backdropClass: 'invoice-return-dialog-backdrop',
      data: {
        mode: 'sales',
        order,
        forcedBranchId: branchId ? String(branchId) : null,
      },
      disableClose: true,
    });

    ref.afterClosed().subscribe((ok) => {
      if (ok) {
        this.getOrders();
        this.getOrderStatistics();
      }
    });
  }



  ngOnDestroy() {
    this.subscriptions.forEach(s => s && s.unsubscribe())
  }

}

