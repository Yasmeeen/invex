
import { OnInit } from "@angular/core";
import { Component } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { MatDialogRef } from "@angular/material/dialog";
import { Branch, Order, Product, productOrder } from "@core/models/products.model";
// import { ProductsSerivce } from "@shared/services/products.service copy";
import { OrdersSerivce } from "@shared/services/orders.service";
import { AppNotificationService } from "@shared/services/app-notification.service";
import { Globals } from "@core/globals";
import { StoreSettingsService } from '@shared/services/store-settings.service';
import { BranchesServce } from "@shared/services/branches.service";
import { Subscription } from "rxjs";
import { TranslateService } from "@ngx-translate/core";
import { AuthenticationService } from "@core/services/authentication.service";
import { ProductsSerivce } from "@shared/services/products.service";
import { BrowserMultiFormatReader } from '@zxing/browser';
import { canPickBranchRole } from '@core/utils/role-utils';

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
  codeReader = new BrowserMultiFormatReader();
  isCameraActive = false;
  currentScanIndex: number ; 
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
    private authenticationService: AuthenticationService,
    public storeSettings: StoreSettingsService
  ) {}

  ngOnInit(): void {
    this.curentUser = this.authenticationService.getUserFromLocalStorage();
    if (canPickBranchRole(this.curentUser?.role)) {
      this.getBranches();
    }

    this.getProducts();
  }

  // Fetch all products for dropdown
  getProducts() {
    let params ={
      branchId: canPickBranchRole(this.curentUser?.role)
        ? this.adminSelectedBranchId
        : this.globals.currentUser.branch._id,
      'page': 1,
      'limit': 1000
    }
    this.productsSerivce.getProducts(params).subscribe((res: any) => {
      this.products = res.products;
    });
  }

  getBranches() {
    let params = {
      'page': 1,
     'limit': 1000
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

    const selectedBranchId = canPickBranchRole(this.curentUser?.role)
      ? this.adminSelectedBranchId
      : this.globals.currentUser.branch._id;
 

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
      this.createdOrder = response.newOrder;   
      setTimeout(() => {
        this.printInvoice();
      }, 0);
      this.appNotificationService.push('Created Successfully', 'success');
   

    }, error=> {
      this.appNotificationService.push(error.error.details, 'error');
    });
  }
  changeBranch(){
     this.orderProducts = [
      {  quantity: 1, totalPrice: 0, selectedProduct: {} }
    ];
    this.getProducts();
  }
  startProductScan(index: number) {
    this.isCameraActive = true;
    this.currentScanIndex = index;
  
    // Scan مرة واحدة فقط
    this.codeReader
      .decodeOnceFromVideoDevice(undefined, 'video')
      .then(result => {
        if (result) {
          this.onProductScanned(result.getText());
          this.isCameraActive = false;
        }
      })
      .catch(err => {
        console.error('Scan error', err);
        this.appNotificationService.push('Unable to scan code', 'error');
        this.isCameraActive = false;
      });
  }
  
  onProductScanned(code: string) {
    if (!code) return;
  
    const foundProduct = this.products.find(p => p.code === code);
    if (!foundProduct) {
      this.appNotificationService.push('Product not found', 'error');
      return;
    }
  
    // Patch the selected product to the correct row
    this.orderProducts[this.currentScanIndex].selectedProduct = foundProduct;
    this.orderProducts[this.currentScanIndex].quantity = 1;
    this.getOrderProductPrice(this.orderProducts[this.currentScanIndex]);
  
    this.appNotificationService.push('Product added successfully', 'success');
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

  /**
   * Rows for the printable receipt: after save uses API snapshot (incl. invoiceAttributes);
   * before submit uses cart lines + category flags for preview.
   */
  receiptTableRows(): Array<{
    totalPrice: number;
    quantity: number;
    discountPct: number;
    unitPrice: number;
    name: string;
    invoiceAttributes: Array<{ label: string; value: string }>;
  }> {
    const saved = this.createdOrder?.products as any[] | undefined;
    if (Array.isArray(saved) && saved.length > 0) {
      return saved.map((p: any) => ({
        totalPrice: Math.round(Number(p.price || 0) * Number(p.quantity || 0) * 100) / 100,
        quantity: Number(p.quantity || 0),
        discountPct: 0,
        unitPrice: Number(p.price || 0),
        name: String(p.name || ''),
        invoiceAttributes: Array.isArray(p.invoiceAttributes) ? p.invoiceAttributes : [],
      }));
    }
    return this.orderProducts.map((item) => {
      const sp = item.selectedProduct || {};
      const qty = Number(item.quantity) || 0;
      const unit = Number(sp.price) || 0;
      const totalFromRow =
        Number(item.totalPrice) ||
        (sp.isApplyDiscount && sp.discount > 0
          ? (unit - (unit * Number(sp.discount)) / 100) * qty
          : unit * qty);
      return {
        totalPrice: Math.round(totalFromRow * 100) / 100,
        quantity: qty,
        discountPct: sp.isApplyDiscount ? Number(sp.discount) || 0 : 0,
        unitPrice: unit,
        name: String(sp.name || ''),
        invoiceAttributes: this.invoiceAttrsFromProductDraft(sp),
      };
    });
  }

  private normalizeAttrKey(raw: any): string {
    return String(raw || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_');
  }

  private invoiceAttrsFromProductDraft(prod: any): Array<{ label: string; value: string }> {
    const attrs = prod?.attributes;
    const defs = prod?.category?.attributeDefs;
    if (!attrs || typeof attrs !== 'object' || !Array.isArray(defs) || !defs.length) {
      return [];
    }
    const out: Array<{ label: string; value: string }> = [];
    for (const def of defs) {
      const key =
        typeof def === 'string' ? this.normalizeAttrKey(def) : this.normalizeAttrKey(def?.key);
      if (!key) continue;
      const showOnInvoice = typeof def === 'object' && def ? !!def.showOnInvoice : false;
      if (!showOnInvoice) continue;
      const label =
        typeof def === 'object' && def
          ? String(def.label || '').trim() || key
          : key;
      const val = String(attrs[key] ?? '').trim();
      if (!val) continue;
      // Display the exact stored attribute value in the receipt preview.
      out.push({ label, value: val });
    }
    return out;
  }

  /**
   * Receipt print formatting: compact numbers (no commas, no decimals) to avoid wrapping on 58mm paper.
   */
  formatReceiptAmount(value: any): string {
    const n = Number(value);
    if (!Number.isFinite(n)) return '0';
    const rounded = Math.round(n);
    return new Intl.NumberFormat('en-US', {
      useGrouping: false,
      maximumFractionDigits: 0,
    }).format(rounded);
  }
}
