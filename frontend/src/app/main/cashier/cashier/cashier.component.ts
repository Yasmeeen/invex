import { Component, AfterViewInit, ViewChild, ElementRef } from '@angular/core';
import { Globals } from '@core/globals';
import { Branch, Product } from '@core/models/products.model';
import { User } from '@core/models/users-interfaces.model';
import { AuthenticationService } from '@core/services/authentication.service';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { BranchesServce } from '@shared/services/branches.service';
import { OrdersSerivce } from '@shared/services/orders.service';
import { ProductsSerivce } from '@shared/services/products.service';
import { environment } from 'src/environments/environment.prod';

@Component({
  selector: 'app-cashier-order',
  templateUrl: './cashier.component.html',
  styleUrls: ['./cashier.component.scss']
})
export class CashierComponent implements AfterViewInit {
  @ViewChild('barcodeInput') barcodeInput!: ElementRef;

  products: Product[] = [];
  orderItems: any[] = [];
  storeName = environment.storeName
  storePhoneNumber =  environment.storePhoneNumber
  todayDate = new Date();
  createdOrder:any;

  searchTerm = '';
  barcode = '';
  isCashierFullScreen: boolean = true;
  curentUser;
  branches: Branch [] =[];
  adminSelectedBranchId: string

  constructor(
    private productsSerivce: ProductsSerivce, 
    private ordersSerivce: OrdersSerivce,
    private authenticationService: AuthenticationService,
    private branchesServce: BranchesServce,
    private globals: Globals,
    private appNotificationService: AppNotificationService
  ) {
    this.curentUser = this.authenticationService.getUserFromLocalStorage();
    if( this.curentUser.role == 'Super Admin'){
      this.getBranches();
    }
    this.loadProducts();
  }
  getBranches() {
    let params = {
      'page': 1,
     'limit': 1000
    }
   this.branchesServce.getBranchs(params).subscribe((response: any) => {
      this.branches = response.branches
      this.adminSelectedBranchId = this.branches[0]._id
      this.loadProducts();
   })
  }

  ngAfterViewInit() {
    this.focusBarcodeInput();
  }

  focusBarcodeInput() {
    if (this.barcodeInput) {
      this.barcodeInput.nativeElement.focus();
    }
  }

  loadProducts() {
    let params:any ={
      page:1,
      limit:1000
    }
    let selectedBranchId = this.curentUser.role == 'Super Admin' ? this.adminSelectedBranchId :this.globals.currentUser.branch._id
 
    params['branchId'] = selectedBranchId;
  
    
    this.productsSerivce.getProducts(params).subscribe((res:any) => {
      this.products = res.products;
    });
  }

  filteredProducts() {
    if (!this.searchTerm) return this.products;
    return this.products.filter((p:Product) =>
      p.name.toLowerCase().includes(this.searchTerm.toLowerCase())
    );
  }

  addProduct(product: any) {
    if(product.stock == 0)
      return
    const index = this.orderItems.findIndex(i => i.productId === product._id);
    if (index > -1) this.orderItems[index].quantity++;
    else this.orderItems.push({ ...product, quantity: 1, productId: product._id });

    this.focusBarcodeInput(); // focus دايمًا بعد أي إضافة
  }

  scanProduct(code: string) {
    if (!code) return;
    const product = this.products.find(p => p.code === code);
    if (product) this.addProduct(product);
    this.barcode = '';
  }

  increaseQty(i: number) { this.orderItems[i].quantity++; this.focusBarcodeInput(); }
  decreaseQty(i: number) { 
    if (this.orderItems[i].quantity > 1) this.orderItems[i].quantity--; 
    this.focusBarcodeInput();
  }
  removeItem(i: number) { this.orderItems.splice(i, 1); this.focusBarcodeInput(); }

  getTotal() { 
    return this.orderItems.reduce((acc, item) => acc + item.price * item.quantity, 0); 
  }
  getDiscountAmount() {
    return this.orderItems.reduce((acc, item) => {
      const discountPercent = item.discount || 0; 
      return acc + (item.price * discountPercent / 100) * item.quantity;
    }, 0);
  }
  getTotalAfterDiscount() {
    return this.getTotal() - this.getDiscountAmount();
  }
  getAverageDiscountPercent() {
    if (!this.orderItems || this.orderItems.length === 0) return 0;
    const totalDiscount = this.orderItems.reduce((sum, item) => sum + (item.discount || 0), 0);
    return totalDiscount / this.orderItems.length;
  }

  checkout() {
    if (!this.orderItems.length) return alert('No products in order');

    let selectedBranchId = this.curentUser.role == 'Super Admin' ? this.adminSelectedBranchId :this.globals.currentUser.branch._id
 
    const orderData = {
      products: this.orderItems.map(i => ({ selectedProduct: i, quantity: i.quantity })),
      clientName: 'Walk-in',
      clientPhoneNumber: '00',
      clientAddress: '-',
      paymentMethod: 'cash',
      branch: selectedBranchId,
      status: 'completed',
      userId: this.curentUser._id
    };

    this.ordersSerivce.createOrder(orderData).subscribe((res:any) => {
      this.createdOrder = res.newOrder;
      this.printInvoice();

      this.loadProducts();
      this.focusBarcodeInput();

    }, error=> {
      console.log("error",error);
      
      this.appNotificationService.push(error.error.details, 'error');
    });
  }

  printInvoice() {
    setTimeout(() => {
      window.print();
      this.orderItems = [];
    }, 300);
  }

  openCashier() {
    this.isCashierFullScreen = true;
    setTimeout(() => this.focusBarcodeInput(), 100);
  }

  closeCashier() {
    this.isCashierFullScreen = false;
  }
}
