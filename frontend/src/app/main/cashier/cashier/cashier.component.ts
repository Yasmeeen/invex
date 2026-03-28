import { Component, AfterViewInit, ViewChild, ElementRef } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { TranslateService } from '@ngx-translate/core';
import { debounceTime, switchMap, catchError } from 'rxjs/operators';
import { of } from 'rxjs';
import { Globals } from '@core/globals';

export interface CashierPaymentMethod {
  id: string;
  labelKey: string;
  logo: string;
}
import { Branch, Product } from '@core/models/products.model';
import { User } from '@core/models/users-interfaces.model';
import { AuthenticationService } from '@core/services/authentication.service';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { BranchesServce } from '@shared/services/branches.service';
import { OrdersSerivce } from '@shared/services/orders.service';
import { ProductsSerivce } from '@shared/services/products.service';
import { StoreSettingsService } from '@shared/services/store-settings.service';

@Component({
  selector: 'app-cashier-order',
  templateUrl: './cashier.component.html',
  styleUrls: ['./cashier.component.scss']
})
export class CashierComponent implements AfterViewInit {
  @ViewChild('barcodeInput') barcodeInput!: ElementRef;

  products: Product[] = [];
  orderItems: any[] = [];
  todayDate = new Date();
  createdOrder:any;

  searchTerm = '';
  barcode = '';
  isCashierFullScreen: boolean = false;
  curentUser;
  branches: Branch [] =[];
  adminSelectedBranchId: string

  // Client information section
  isClientInfoOpen = false;
  clientForm: FormGroup;
  isExistingClient = false;
  /** Avoid repeating the same “registered” toast for the same client lookup. */
  private lastNotifiedClientId: string | null = null;

  readonly paymentMethods: CashierPaymentMethod[] = [
    { id: 'cash', labelKey: 'tr_pay_cash', logo: 'assets/images/payment/cash.svg' },
    { id: 'visa', labelKey: 'tr_pay_visa', logo: 'assets/images/payment/visa.svg' },
    { id: 'mastercard', labelKey: 'tr_pay_mastercard', logo: 'assets/images/payment/mastercard.svg' },
    { id: 'meeza', labelKey: 'tr_pay_meeza', logo: 'assets/images/payment/meeza.svg' },
    { id: 'valu', labelKey: 'tr_pay_valu', logo: 'assets/images/payment/valu.svg' },
    { id: 'aman', labelKey: 'tr_pay_aman', logo: 'assets/images/payment/aman.svg' },
    { id: 'halan', labelKey: 'tr_pay_halan', logo: 'assets/images/payment/halan.svg' },
    { id: 'tru', labelKey: 'tr_pay_tru', logo: 'assets/images/payment/tru.svg' },
    { id: 'sohoula', labelKey: 'tr_pay_sohoula', logo: 'assets/images/payment/sohoula.svg' },
    { id: 'maylo_seven', labelKey: 'tr_pay_maylo_seven', logo: 'assets/images/payment/maylo-seven.svg' },
    { id: 'fawry', labelKey: 'tr_pay_fawry', logo: 'assets/images/payment/fawry.svg' },
    { id: 'vodafone_cash', labelKey: 'tr_pay_vodafone_cash', logo: 'assets/images/payment/vodafone-cash.svg' },
    { id: 'instapay', labelKey: 'tr_pay_instapay', logo: 'assets/images/payment/instapay.svg' },
  ];

  constructor(
    private productsSerivce: ProductsSerivce, 
    private ordersSerivce: OrdersSerivce,
    private authenticationService: AuthenticationService,
    private branchesServce: BranchesServce,
    private globals: Globals,
    private appNotificationService: AppNotificationService,
    private fb: FormBuilder,
    private translate: TranslateService,
    public storeSettings: StoreSettingsService
  ) {
    this.curentUser = this.authenticationService.getUserFromLocalStorage();
    if (this.curentUser.role === 'Super Admin') {
      this.getBranches(); // loadProducts runs after a branch is selected
    } else {
      this.loadProducts();
    }
    this.initClientForm();
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

  private initClientForm() {
    this.clientForm = this.fb.group({
      paymentMethod: ['cash'],
      phone: ['', [Validators.required]],
      name: [''],
      address: ['']
    });

    const phoneControl = this.clientForm.get('phone');
    const nameControl = this.clientForm.get('name');
    const addressControl = this.clientForm.get('address');

    phoneControl?.valueChanges
      .pipe(
        debounceTime(400),
        switchMap((phone: string) => {
          if (!phone) {
            this.isExistingClient = false;
            nameControl?.reset();
            addressControl?.reset();
            nameControl?.clearValidators();
            addressControl?.clearValidators();
            nameControl?.updateValueAndValidity({ emitEvent: false });
            addressControl?.updateValueAndValidity({ emitEvent: false });
            nameControl?.enable({ emitEvent: false });
            addressControl?.enable({ emitEvent: false });
            return of(null);
          }
          return this.ordersSerivce.getClientByPhone(phone).pipe(
            catchError((err) => {
              if (err.status === 404) {
                this.isExistingClient = false;
                nameControl?.enable({ emitEvent: false });
                addressControl?.enable({ emitEvent: false });
                nameControl?.setValidators([Validators.required]);
                addressControl?.setValidators([Validators.required]);
                nameControl?.updateValueAndValidity({ emitEvent: false });
                addressControl?.updateValueAndValidity({ emitEvent: false });
                nameControl?.reset();
                addressControl?.reset();
              }
              return of(null);
            })
          );
        })
      )
      .subscribe((client: any) => {
        if (client) {
          const dedupeKey =
            client._id != null
              ? String(client._id)
              : String(client.phoneNumber || '');
          if (dedupeKey && dedupeKey !== this.lastNotifiedClientId) {
            this.lastNotifiedClientId = dedupeKey;
            this.translate
              .get('tr_cashier_client_registered')
              .subscribe((msg) => this.appNotificationService.push(msg, 'success'));
          }

          this.isExistingClient = true;
          nameControl?.setValue(client.name, { emitEvent: false });
          addressControl?.setValue(client.address, { emitEvent: false });
          nameControl?.disable({ emitEvent: false });
          addressControl?.disable({ emitEvent: false });
          nameControl?.clearValidators();
          addressControl?.clearValidators();
          nameControl?.updateValueAndValidity({ emitEvent: false });
          addressControl?.updateValueAndValidity({ emitEvent: false });
        } else {
          this.lastNotifiedClientId = null;
        }
      });
  }

  toggleClientInfo() {
    this.isClientInfoOpen = !this.isClientInfoOpen;
    if (!this.isClientInfoOpen) {
      this.resetClientFormFields();
    }
  }

  /** Reset phone, name, address, payment to defaults and re-enable disabled controls. */
  private resetClientFormFields(): void {
    this.lastNotifiedClientId = null;
    this.clientForm.reset({
      paymentMethod: 'cash',
      phone: '',
      name: '',
      address: ''
    });
    this.clientForm.get('name')?.enable({ emitEvent: false });
    this.clientForm.get('address')?.enable({ emitEvent: false });
    this.isExistingClient = false;
  }

  /** After successful pay + print: collapse client section and clear form. */
  private clearClientInformationAfterCheckout(): void {
    this.isClientInfoOpen = false;
    this.resetClientFormFields();
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
    let params: any = {
      page: 1,
      limit: 1000
    };
    const selectedBranchId =
      this.curentUser.role === 'Super Admin'
        ? this.adminSelectedBranchId
        : this.globals.currentUser?.branch?._id;

    if (selectedBranchId) {
      params['branchId'] = selectedBranchId;
    } else {
      params['excludeWarehouse'] = true;
    }

    this.productsSerivce.getProducts(params).subscribe((res: any) => {
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

    this.focusBarcodeInput(); 
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
    if (!this.orderItems.length) {
      this.translate.get('tr_cashier.NO_ITEMS').subscribe((msg) => alert(msg));
      return;
    }

    if (this.isClientInfoOpen) {
      this.clientForm.markAllAsTouched();
      if (!this.clientForm.valid) {
        this.translate.get('tr_invalid_cashier_client').subscribe((msg) =>
          this.appNotificationService.push(msg, 'error')
        );
        return;
      }
    }

    const selectedBranchId =
      this.curentUser.role === 'Super Admin'
        ? this.adminSelectedBranchId
        : this.globals.currentUser.branch._id;

    let clientName = 'Walk-in';
    let clientPhoneNumber = '00';
    let clientAddress = '-';

    if (this.isClientInfoOpen) {
      const raw = this.clientForm.getRawValue();
      clientName = (raw.name || '').trim() || 'Walk-in';
      clientPhoneNumber = (raw.phone || '').trim() || '00';
      clientAddress = (raw.address || '').trim() || '-';
    }

    const paymentMethod =
      this.clientForm.get('paymentMethod')?.value || 'cash';

    const orderData = {
      products: this.orderItems.map((i) => ({ selectedProduct: i, quantity: i.quantity })),
      clientName,
      clientPhoneNumber,
      clientAddress,
      paymentMethod,
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
      this.clearClientInformationAfterCheckout();
    }, 300);
  }

  openCashier() {
    this.isCashierFullScreen = true;
    setTimeout(() => this.focusBarcodeInput(), 100);
  }

  closeCashier() {
    this.isCashierFullScreen = false;
  }

  /**
   * Receipt: show client block only when order has real client data (not cashier defaults:
   * phone "00", name "Walk-in", address "-").
   */
  get showReceiptClientSection(): boolean {
    const o = this.createdOrder;
    if (!o) {
      return false;
    }
    const phone = (o.clientPhoneNumber || '').trim();
    const name = (o.clientName || '').trim();
    const addr = (o.clientAddress || '').trim();
    if (phone && phone !== '00') {
      return true;
    }
    if (name && name !== 'Walk-in') {
      return true;
    }
    if (addr && addr !== '-') {
      return true;
    }
    return false;
  }
}
