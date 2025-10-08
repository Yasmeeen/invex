
import { OnInit } from "@angular/core";
import { Component } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { MatDialogRef } from "@angular/material/dialog";
import { Order, Product, productOrder } from "@core/models/products.model";
import { ProductsSerivce } from "@shared/services/products.service copy";
import { OrdersSerivce } from "@shared/services/orders.service";
import { AppNotificationService } from "@shared/services/app-notification.service";

@Component({
  selector: "app-add-order",
  templateUrl: "./add-order.component.html",
  styleUrls: ["./add-order.component.scss"],
})
export class AddOrderComponent implements OnInit {

  todayDate = new Date();
  createdOrder:any;
  order: Order = {
    clientName: '',
    clientPhoneNumber: '',
    clientAddress:'',
    sellerName:''
  } 

  // 🔹 Order products
  orderProducts: productOrder []= [
    {  quantity: 1, totalPrice: 0, selectedProduct: {} }
  ];

  // 🔹 Totals
  totalPrice: number = 0;

  // 🔹 Product list for select
  products: Product[] = [];

  constructor(
    private http: HttpClient,
    private dialogRef: MatDialogRef<AddOrderComponent>,
    private productsSerivce: ProductsSerivce,
    private ordersSerivce: OrdersSerivce,
    private appNotificationService: AppNotificationService
  ) {}

  ngOnInit(): void {
    this.getProducts();
  }

  // Fetch all products for dropdown
  getProducts() {
    this.productsSerivce.getProducts({}).subscribe((res: any) => {
      this.products = res.products;
    });
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
    console.log("orderProducts",this.orderProducts);
    
    const product_ids: string[] = ([] as string[]).concat(
      ...this.orderProducts.map((p) => Array(p.quantity).fill(p._id))
    );
 

    const orderPayload = {
      clientName: this.order.clientName,
      clientPhoneNumber: this.order.clientPhoneNumber,
      clientAddress: this.order.clientAddress,
      sellerName: this.order.sellerName,
      products: this.orderProducts,
      branch: this.order.branch?._id
    };

    console.log("orderPayload",orderPayload);
    
    this.ordersSerivce.createOrder(orderPayload).subscribe((response:any) => {

      this.createdOrder = response.newOrder[0];    
        console.log("response",this.createdOrder);
      this.appNotificationService.push('Created Successfully', 'success');
      // this.closeModal(true)
      this.printInvoice(); // auto print after submit
    }, error=> {
      console.log(error.error);
      this.appNotificationService.push(error.error.error, 'error');
    });
  }


  // Close modal
  closeModal(isSubmit?: boolean) {
    this.dialogRef.close(isSubmit);
  }

  // Print invoice
  printInvoice() {
    window.print()
  }
}
