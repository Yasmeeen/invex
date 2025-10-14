
import { OnInit } from "@angular/core";
import { Component } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { MatDialogRef } from "@angular/material/dialog";
import { Branch, Order, Product, productOrder } from "@core/models/products.model";
import { ProductsSerivce } from "@shared/services/products.service copy";
import { OrdersSerivce } from "@shared/services/orders.service";
import { AppNotificationService } from "@shared/services/app-notification.service";
import { Globals } from "@core/globals";
import { environment } from "src/environments/environment";
import { BranchesServce } from "@shared/services/branches.service";
import { Subscription } from "rxjs";
import { TranslateService } from "@ngx-translate/core";
import { AuthenticationService } from "@core/services/authentication.service";

@Component({
  selector: "app-add-order",
  templateUrl: "./add-order.component.html",
  styleUrls: ["./add-order.component.scss"],
})
export class AddOrderComponent implements OnInit {

  todayDate = new Date();
  createdOrder:any;
  branches: Branch [] = [];
  adminSelectedBranchId: string ='';
  storeName = environment.storeName
  storePhoneNumber =  environment.storePhoneNumber
  paymentMethods = [
    {
     name: this.translateService.instant('tr_cash'),
     value: 'cash' 
    },
    {
      name: this.translateService.instant('tr_online'),
      value: 'online' 
     }
  ]
  curentUser: any;
  order: Order = {
    clientName: '',
    clientPhoneNumber: '',
    clientAddress:'',
    sellerName:'',
    paymentMethod:''
  } 

  // 🔹 Order products
  orderProducts: productOrder []= [
    {  quantity: 1, totalPrice: 0, selectedProduct: {} }
  ];

  // 🔹 Totals
  totalPrice: number = 0;

  // 🔹 Product list for select
  products: Product[] = [];
  private subscriptions: Subscription[] = [];

  constructor(
    private http: HttpClient,
    private dialogRef: MatDialogRef<AddOrderComponent>,
    private productsSerivce: ProductsSerivce,
    private ordersSerivce: OrdersSerivce,
    private appNotificationService: AppNotificationService,
    private branchesServce: BranchesServce,
    private translateService: TranslateService,
    public globals:Globals,
    private authenticationService: AuthenticationService
  ) {}

  ngOnInit(): void {
    this.curentUser = this.authenticationService.getUserFromLocalStorage();
    if( this.curentUser.role == 'Super Admin'){
      this.getBranches();
    }

    this.getProducts();
  }

  // Fetch all products for dropdown
  getProducts() {
    let params ={
      branchId: this.curentUser.role == 'Super Admin' ? this.adminSelectedBranchId :this.globals.currentUser.branch._id,
      'page': 1,
      'per_page': 1000
    }
    this.productsSerivce.getProducts(params).subscribe((res: any) => {
      this.products = res.products;
    });
  }

  getBranches() {
    let params = {
      'page': 1,
     'per_page': 1000
    }
    this.subscriptions.push(this.branchesServce.getBranchs(params).subscribe((response: any) => {
      this.branches = response.branches
    },(error:any)=> {

      this.appNotificationService.push( this.translateService.instant('tr_unexpected_error_message'), 'error');
    }))
  }


  getOrderProductPrice(product:productOrder){
    const discountPercentage = product.selectedProduct.discount 
    const totalPrice = product.selectedProduct.price
    if(product.selectedProduct.isApplyDiscount){
      const discountedPrice = totalPrice - (totalPrice * discountPercentage / 100);
      product.totalPrice = discountedPrice * product.quantity 
      return discountedPrice * product.quantity 
    }
    else {
      product.totalPrice = totalPrice * product.quantity 
      return totalPrice * product.quantity 
    }

  }

  // Add / Remove product rows
  addProductRow(): void {
    this.orderProducts.push({
      _id: "",
      quantity: 1,
      totalPrice: 0,
      selectedProduct:{}
    });
  }

  removeProduct(index: number): void {
    this.orderProducts.splice(index, 1);
  }

  // Submit form to backend
  submitForm(): void {
    const product_ids: string[] = ([] as string[]).concat(
      ...this.orderProducts.map((p) => Array(p.quantity).fill(p._id))
    );
    console.log(this.order.paymentMethod,"AdminSelectedBranch",this.adminSelectedBranchId);
    

    let selectedBranchId = this.curentUser.role == 'Super Admin' ? this.adminSelectedBranchId :this.globals.currentUser.branch._id
 

    const orderPayload = {
      clientName: this.order.clientName,
      clientPhoneNumber: this.order.clientPhoneNumber,
      clientAddress: this.order.clientAddress,
      sellerName: this.order.sellerName,
      products: this.orderProducts,
      paymentMethod: this.order.paymentMethod,
      branch: selectedBranchId
    };

    this.ordersSerivce.createOrder(orderPayload).subscribe((response:any) => {

      this.createdOrder = response.newOrder[0];    
      setTimeout(() => {
        this.printInvoice();
      }, 0);
      this.appNotificationService.push('Created Successfully', 'success');
   

    }, error=> {
      console.log(error.error);
      this.appNotificationService.push(error.error.details, 'error');
    });
  }


  // Close modal
  closeModal(isSubmit?: boolean) {
    this.dialogRef.close(isSubmit);
  }

  // Print invoice
  printInvoice() {
    window.print();
    this.closeModal(true)
  }
}
