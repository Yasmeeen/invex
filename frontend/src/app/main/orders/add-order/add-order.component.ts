
import { OnInit } from "@angular/core";
import { Component } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { MatDialogRef } from "@angular/material/dialog";
import { Order, Product, productOrder } from "@core/models/products.model";
import { ProductsSerivce } from "@shared/services/products.service copy";
import { OrdersSerivce } from "@shared/services/orders.service";

@Component({
  selector: "app-add-order",
  templateUrl: "./add-order.component.html",
  styleUrls: ["./add-order.component.scss"],
})
export class AddOrderComponent implements OnInit {

  todayDate = new Date();
  order: Order = {
    clientName: '',
    clientPhoneNumber: '',
    clientAddress:'',
    sellerName:''
  } 

  // 🔹 Order products
  orderProducts: productOrder []= [
    { _id: "", code: "", name: "", quantity: 1, price: 0, discount: 0, selectedProduct: {} }
  ];

  // 🔹 Totals
  totalPrice: number = 0;

  // 🔹 Product list for select
  products: Product[] = [];

  constructor(
    private http: HttpClient,
    private dialogRef: MatDialogRef<AddOrderComponent>,
    private productsSerivce: ProductsSerivce,
    private ordersSerivce: OrdersSerivce
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

  // Fetch product details by code (when user selects product)
  fetchProductDetails(index: number): void {
    const code = this.orderProducts[index].code;
    if (!code) return;

    this.http.get<any>(`/api/products/code/${code}`).subscribe((product) => {
      this.orderProducts[index]._id = product._id;
      this.orderProducts[index].name = product.name;
      this.orderProducts[index].price = product.price; // assign backend price
      this.calculateTotalPrice();
    });
  }

  // Calculate total price with discount applied
  calculateTotalPrice(): void {
    this.totalPrice = this.orderProducts.reduce((sum, p) => {
      const discountedPrice = p.price - (p.price * (p.discount || 0) / 100);
      return sum + discountedPrice * p.quantity;
    }, 0);
  }

  // Add / Remove product rows
  addProductRow(): void {
    this.orderProducts.push({
      _id: "",
      code: "",
      name: "",
      quantity: 1,
      price: 0,
      discount: 0,
      selectedProduct:{}
    });
  }

  removeProduct(index: number): void {
    this.orderProducts.splice(index, 1);
    this.calculateTotalPrice();
  }

  // Submit form to backend
  submitForm(): void {
    const product_ids: string[] = ([] as string[]).concat(
      ...this.orderProducts.map((p) => Array(p.quantity).fill(p._id))
    );

    console.log("this.orderProducts",this.orderProducts);
    

    const orderPayload = {
      clientName: this.order.clientName,
      clientPhoneNumber: this.order.clientPhoneNumber,
      clientAddress: this.order.clientAddress,
      sellerName: this.order.sellerName,
      products: this.orderProducts.map((p) => p.selectedProduct._id),
      branch: this.order.branch?._id
    };

    this.ordersSerivce.createOrder(orderPayload).subscribe((response) => {
      console.log("Order submitted", response);
      this.closeModal(true)
      this.printInvoice(); // auto print after submit
    });
  }

  // Close modal
  closeModal(isSubmit?: boolean) {
    this.dialogRef.close(isSubmit);
  }

  // Print invoice
  printInvoice() {
    // const printContents = document.getElementById('print-container')?.innerHTML;
    // if (printContents) {
    //   const win = window.open('', '', 'width=800,height=600');
    //   win!.document.write(printContents);
    //   win!.document.close();
    //   win!.print();
    // }
    window.print()
  }
}
