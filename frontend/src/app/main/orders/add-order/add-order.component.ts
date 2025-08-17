import { OnInit } from "@angular/core";
// import { productsSerivce } from '@shared/services/products.services';
// add-order.component.ts
import { Component } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { MatDialogRef } from "@angular/material/dialog";
import { Product } from "@core/models/products.model";
import { ProductsSerivce } from "@shared/services/products.service copy";

@Component({
  selector: "app-add-order",
  templateUrl: "./add-order.component.html",
  styleUrls: ["./add-order.component.scss"],
})
export class AddOrderComponent {
  orderProducts: Array<{
    _id: string;
    code: string;
    name: string;
    quantity: number;
    price: string;
  }> = [{ _id: "", code: "", name: "", quantity: 1, price: "" }];
  clientName: string = "";
  totalPrice: number = 0;
  products: Product[] = [];

  constructor(
    private http: HttpClient,
    private dialogRef: MatDialogRef<AddOrderComponent>,
    private productsSerivce: ProductsSerivce
  ) {}

  ngOnInit(): void {
    this.getProducts();
  }

  fetchProductDetails(index: number): void {
    const code = this.orderProducts[index].code;
    if (!code) return;
    this.http.get<any>(`/api/products/code/${code}`).subscribe((product) => {
      this.orderProducts[index]._id = product._id;
      this.orderProducts[index].name = product.name;
      this.calculateTotalPrice();
    });
  }

  getProducts() {
    this.productsSerivce.getProducts({}).subscribe((res: any) => {
      console.log("res", res);
      this.products = res.products;
    });
  }
  calculateTotalPrice(): void {
    this.totalPrice = this.orderProducts.reduce(
      (sum, p) => sum + p.quantity * 10,
      0
    ); // Example logic
  }

  addProductRow(): void {
    this.orderProducts.push({
      _id: "",
      code: "",
      name: "",
      quantity: 1,
      price: "",
    });
  }

  removeProduct(index: number): void {
    this.orderProducts.splice(index, 1);
    this.calculateTotalPrice();
  }

  submitForm(): void {
    const product_ids: string[] = ([] as string[]).concat(
      ...this.orderProducts.map((p) => Array(p.quantity).fill(p._id))
    );

    const orderPayload = {
      client_name: this.clientName,
      product_ids: product_ids,
    };

    this.http.post("/api/orders", orderPayload).subscribe((response) => {
      console.log("Order submitted", response);
    });
  }
  closeModal(isSubmit?: boolean) {
    this.dialogRef.close(isSubmit);
  }
  printInvoice() {
    window.print();
  }
}
