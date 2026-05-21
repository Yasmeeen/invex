import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  ElementRef,
  ViewChild,
} from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { AbstractControl, ValidationErrors } from '@angular/forms';
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
import { VendorsSerivce } from '@shared/services/vendors.service';
import { OrderPartyType } from '@core/models/products.model';
import { ProductsSerivce } from '@shared/services/products.service';
import { StoreSettingsService } from '@shared/services/store-settings.service';
import { canPickBranchRole } from '@core/utils/role-utils';
import { MatDialog } from '@angular/material/dialog';
import { CreateEditProductComponent } from '../../products/create-edit-product/create-edit-product.component';
import { DailyExpenseDialogComponent } from '../../expenses/daily-expense-dialog/daily-expense-dialog.component';
import { DrawerCloseDialogComponent } from '../../drawer-close/drawer-close-dialog/drawer-close-dialog.component';
import { toDataURL as qrToDataUrl } from 'qrcode';
import { environment } from 'src/environments/environment';

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
  /** Data URL for Innovation website QR on printed receipt. */
  invoiceQrDataUrl: string | null = null;
  /** How the cashier enters invoice-level discount: %, fixed amount, or target final total. */
  invoiceDiscountMode: 'percent' | 'amount' | 'final' = 'percent';
  /** Meaning depends on `invoiceDiscountMode` (see `appliedInvoiceDiscount`). */
  invoiceExtraValue = 0;
  /**
   * Split payment: multi-select methods, then amount per selected method.
   */
  selectedPayMethods: string[] = ['cash'];
  payAmounts: Record<string, number> = { cash: 0 };

  searchTerm = '';
  barcode = '';
  isCashierFullScreen: boolean = true;
  curentUser;
  branches: Branch [] =[];
  adminSelectedBranchId: string

  /** Desk product purchase (inventory intake); receipt print uses shared component. */
  createdDeskPurchase: any = null;
  printMode: 'sale' | 'deskPurchase' = 'sale';

  /** Exchange: trade-in product intake recorded via desk purchase; cleared after checkout / cancel. */
  exchangeTradeInPurchase: any = null;
  /** After sale receipt print, optionally print trade-in purchase receipt. */
  private pendingExchangePurchaseReceipt: any = null;

  // Client / supplier information section
  isClientInfoOpen = false;
  clientForm: FormGroup;
  partyType: OrderPartyType = 'client';
  isExistingClient = false;
  isExistingVendor = false;
  selectedClientId: string | null = null;
  selectedVendorId: string | null = null;
  supplierCompanyName = '';
  /** Avoid repeating the same “registered” toast for the same lookup. */
  private lastNotifiedPartyId: string | null = null;

  readonly paymentMethods: CashierPaymentMethod[] = [
    { id: 'cash', labelKey: 'tr_pay_cash', logo: 'assets/images/payment/cash.svg' },
    { id: 'credit', labelKey: 'tr_pay_credit', logo: 'assets/images/payment/cash.svg' },
    { id: 'visa', labelKey: 'tr_pay_visa', logo: 'assets/images/payment/visa.svg' },
    { id: 'mastercard', labelKey: 'tr_pay_mastercard', logo: 'assets/images/payment/mastercard.svg' },
    { id: 'meeza', labelKey: 'tr_pay_meeza', logo: 'assets/images/payment/meeza.svg' },
    { id: 'valu', labelKey: 'tr_pay_valu', logo: 'assets/images/payment/valu.svg' },
    { id: 'aman', labelKey: 'tr_pay_aman', logo: 'assets/images/payment/aman.svg' },
    { id: 'halan', labelKey: 'tr_pay_halan', logo: 'assets/images/payment/halan.svg' },
    { id: 'tru', labelKey: 'tr_pay_tru', logo: 'assets/images/payment/tru.svg' },
    { id: 'sohoula', labelKey: 'tr_pay_sohoula', logo: 'assets/images/payment/sohoula.svg' },
    { id: 'maylo_seven', labelKey: 'tr_pay_maylo_seven', logo: 'assets/images/payment/maylo-seven.svg' },
    { id: 'forsa', labelKey: 'tr_pay_forsa', logo: 'assets/images/payment/cash.svg' },
    { id: 'fawry', labelKey: 'tr_pay_fawry', logo: 'assets/images/payment/fawry.svg' },
    { id: 'vodafone_cash', labelKey: 'tr_pay_vodafone_cash', logo: 'assets/images/payment/vodafone-cash.svg' },
    { id: 'instapay', labelKey: 'tr_pay_instapay', logo: 'assets/images/payment/instapay.svg' },
  ];

  /** Stable array reference for ng-select (do not use a getter — breaks multi-select). */
  readonly paymentMethodsForSplit: CashierPaymentMethod[] = this.paymentMethods;

  constructor(
    private productsSerivce: ProductsSerivce, 
    private ordersSerivce: OrdersSerivce,
    private vendorsSerivce: VendorsSerivce,
    private dialog: MatDialog,
    private authenticationService: AuthenticationService,
    private branchesServce: BranchesServce,
    private globals: Globals,
    private appNotificationService: AppNotificationService,
    private fb: FormBuilder,
    private translate: TranslateService,
    public storeSettings: StoreSettingsService,
    private cdr: ChangeDetectorRef
  ) {
    this.curentUser = this.authenticationService.getUserFromLocalStorage();
    if (canPickBranchRole(this.curentUser?.role)) {
      this.getBranches(); // loadProducts runs after a branch is selected
    } else {
      this.loadProducts();
    }
    this.initClientForm();
  }

  startExchangeFlow(): void {
    this.openDeskPurchaseProductDialog({ mode: 'exchange' });
  }

  cancelExchangeFlow(): void {
    this.exchangeTradeInPurchase = null;
    this.refreshExchangePaymentDefaults();
    this.translate.get('tr_exchange_cancelled').subscribe((msg) => this.appNotificationService.push(msg, 'success'));
  }

  /** Record cash-drawer daily expense (same dialog as `/expenses` page). */
  openDailyExpenseDialog(): void {
    const uid = this.curentUser?._id;
    const selectedBranchId = canPickBranchRole(this.curentUser?.role)
      ? this.adminSelectedBranchId
      : this.globals.currentUser?.branch?._id;

    if (!selectedBranchId) {
      this.translate.get('tr_branch_required').subscribe((msg) => this.appNotificationService.push(msg, 'error'));
      return;
    }

    const ref = this.dialog.open(DailyExpenseDialogComponent, {
      width: '440px',
      panelClass: 'daily-expense-dialog-panel',
      backdropClass: 'daily-expense-dialog-backdrop',
      data: {
        userId: uid,
        forcedBranchId: String(selectedBranchId),
      },
      disableClose: true,
    });

    ref.afterClosed().subscribe(() => {});
  }

  /** End-of-day drawer reconciliation (preview + counted cash). */
  openDrawerCloseDialog(): void {
    const uid = this.curentUser?._id;
    const selectedBranchId = canPickBranchRole(this.curentUser?.role)
      ? this.adminSelectedBranchId
      : this.globals.currentUser?.branch?._id;

    if (!selectedBranchId) {
      this.translate.get('tr_branch_required').subscribe((msg) => this.appNotificationService.push(msg, 'error'));
      return;
    }

    const ref = this.dialog.open(DrawerCloseDialogComponent, {
      width: '580px',
      maxWidth: '96vw',
      panelClass: 'drawer-close-dialog-panel',
      backdropClass: 'drawer-close-dialog-backdrop',
      data: {
        userId: uid,
        forcedBranchId: String(selectedBranchId),
      },
      disableClose: true,
    });

    ref.afterClosed().subscribe(() => {});
  }

  /** Desk intake purchase popup (`exchange`: trade-in step; defer purchase receipt until after sale checkout). */
  openDeskPurchaseProductDialog(opts?: { mode?: 'desk' | 'exchange' }): void {
    const selectedBranchId = canPickBranchRole(this.curentUser?.role)
      ? this.adminSelectedBranchId
      : this.globals.currentUser?.branch?._id;

    if (!selectedBranchId) {
      this.translate.get('tr_branch_required').subscribe((msg) => this.appNotificationService.push(msg, 'error'));
      return;
    }

    const isExchange = opts?.mode === 'exchange';

    const ref = this.dialog.open(CreateEditProductComponent, {
      width: '850px',
      data: {
        isEdit: false,
        cashDeskPurchase: true,
        forcedBranchId: String(selectedBranchId),
        exchangeFlow: isExchange,
      },
      disableClose: true,
    });

    ref.afterClosed().subscribe((res: any) => {
      if (!res?.submitted || !res?.deskPurchaseResult) {
        return;
      }
      const body = res.deskPurchaseResult;
      const purchase = body?.purchase || body;

      if (isExchange) {
        this.exchangeTradeInPurchase = purchase;
        this.applyExchangeClientFromTradeIn(purchase);
        this.refreshExchangePaymentDefaults();
        const msgKey = body?.createdProduct ? 'tr_exchange_trade_in_ok_auto' : 'tr_exchange_trade_in_ok_pending';
        this.translate.get(msgKey).subscribe((msg) => this.appNotificationService.push(msg, 'success'));
        this.loadProducts();
        return;
      }

      this.createdDeskPurchase = purchase;
      this.printMode = 'deskPurchase';
      this.printDeskPurchaseReceipt();
      const msgKey = body?.createdProduct ? 'tr_product_purchase_created_ok' : 'tr_product_purchase_pending_ok';
      this.translate.get(msgKey).subscribe((msg) => this.appNotificationService.push(msg, 'success'));
      this.loadProducts();
    });
  }

  /** Purchase cost credited toward exchange settlement (= agreed trade-in value toward sale). */
  exchangeTradeInCredit(): number {
    const p = this.exchangeTradeInPurchase;
    if (!p?.productPayload) return 0;
    const q = Math.max(1, Math.floor(Number(p.quantity) || 1));
    const net = Number(p.productPayload.netPrice);
    if (!Number.isFinite(net) || net < 0) return 0;
    return Math.round(net * q * 100) / 100;
  }

  /** Cash to collect after trade-in credit (minimum zero). */
  exchangeAmountDue(): number {
    const sale = Math.round(this.finalOrderTotal() * 100) / 100;
    const cr = this.exchangeTradeInCredit();
    return Math.round(Math.max(0, sale - cr) * 100) / 100;
  }

  /** If trade-in credit exceeds sale total, store may owe this to customer (informational). */
  exchangeStoreOwesCustomer(): number {
    const sale = Math.round(this.finalOrderTotal() * 100) / 100;
    const cr = this.exchangeTradeInCredit();
    return Math.round(Math.max(0, cr - sale) * 100) / 100;
  }

  /** Payment totals compare against this amount at cashier when exchange active. */
  effectiveCheckoutTotal(): number {
    if (this.exchangeTradeInPurchase) {
      return this.exchangeAmountDue();
    }
    return Math.round(this.finalOrderTotal() * 100) / 100;
  }

  private refreshExchangePaymentDefaults(): void {
    if (!this.exchangeTradeInPurchase) return;
    this.ensureDefaultPayAmounts();
  }

  receiptExchangeCredit(): number {
    const v = Number(this.createdOrder?.exchangeTradeInCreditAmount);
    return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
  }

  receiptExchangeCollected(): number {
    const v = Number(this.createdOrder?.amountPaid);
    return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
  }

  printDeskPurchaseReceipt(): void {
    setTimeout(() => {
      this.cdr.detectChanges();
      window.print();
      this.printMode = 'sale';
    }, 250);
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
      phone: ['', [Validators.required, this.phoneFormatValidator]],
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
            this.clearPartyLookupState(nameControl, addressControl, false);
            nameControl?.reset();
            addressControl?.reset();
            return of(null);
          }
          const lookup$ =
            this.partyType === 'supplier'
              ? this.vendorsSerivce.getVendorByPhone(phone)
              : this.ordersSerivce.getClientByPhone(phone);

          return lookup$.pipe(
            catchError((err) => {
              if (err.status === 404) {
                this.clearPartyLookupState(nameControl, addressControl, true);
              }
              return of(null);
            })
          );
        })
      )
      .subscribe((party: any) => {
        if (!party) {
          this.lastNotifiedPartyId = null;
          return;
        }

        const nameControl = this.clientForm.get('name');
        const addressControl = this.clientForm.get('address');

        if (this.partyType === 'supplier') {
          const dedupeKey = party._id != null ? String(party._id) : String(party.phone || '');
          if (dedupeKey && dedupeKey !== this.lastNotifiedPartyId) {
            this.lastNotifiedPartyId = dedupeKey;
            this.translate
              .get('tr_cashier_supplier_registered')
              .subscribe((msg) => this.appNotificationService.push(msg, 'success'));
          }
          this.isExistingVendor = true;
          this.isExistingClient = false;
          this.selectedClientId = null;
          this.selectedVendorId = party._id ? String(party._id) : null;
          this.supplierCompanyName = party.nameOfcompany || '';
          nameControl?.setValue(party.name, { emitEvent: false });
          addressControl?.setValue(party.address || '', { emitEvent: false });
          nameControl?.disable({ emitEvent: false });
          addressControl?.disable({ emitEvent: false });
          nameControl?.clearValidators();
          addressControl?.clearValidators();
        } else {
          const dedupeKey =
            party._id != null ? String(party._id) : String(party.phoneNumber || '');
          if (dedupeKey && dedupeKey !== this.lastNotifiedPartyId) {
            this.lastNotifiedPartyId = dedupeKey;
            this.translate
              .get('tr_cashier_client_registered')
              .subscribe((msg) => this.appNotificationService.push(msg, 'success'));
          }
          this.isExistingClient = true;
          this.isExistingVendor = false;
          this.selectedClientId = party._id ? String(party._id) : null;
          this.selectedVendorId = null;
          this.supplierCompanyName = '';
          nameControl?.setValue(party.name, { emitEvent: false });
          addressControl?.setValue(party.address, { emitEvent: false });
          nameControl?.disable({ emitEvent: false });
          addressControl?.disable({ emitEvent: false });
          nameControl?.clearValidators();
          addressControl?.clearValidators();
        }
        nameControl?.updateValueAndValidity({ emitEvent: false });
        addressControl?.updateValueAndValidity({ emitEvent: false });
      });
  }

  private clearPartyLookupState(
    nameControl: AbstractControl | null,
    addressControl: AbstractControl | null,
    requireFields: boolean
  ): void {
    this.isExistingClient = false;
    this.isExistingVendor = false;
    this.selectedClientId = null;
    this.selectedVendorId = null;
    this.supplierCompanyName = '';
    nameControl?.enable({ emitEvent: false });
    addressControl?.enable({ emitEvent: false });
    if (requireFields) {
      nameControl?.setValidators([Validators.required]);
      addressControl?.setValidators([Validators.required]);
    } else {
      nameControl?.clearValidators();
      addressControl?.clearValidators();
    }
    nameControl?.updateValueAndValidity({ emitEvent: false });
    addressControl?.updateValueAndValidity({ emitEvent: false });
    if (requireFields) {
      nameControl?.reset();
      addressControl?.reset();
    }
  }

  onPartyTypeChange(type: OrderPartyType): void {
    if (this.partyType === type) return;
    this.partyType = type;
    this.lastNotifiedPartyId = null;
    const phone = String(this.clientForm.get('phone')?.value || '').trim();
    const nameControl = this.clientForm.get('name');
    const addressControl = this.clientForm.get('address');
    this.clearPartyLookupState(nameControl, addressControl, !!phone);
    if (phone) {
      this.clientForm.get('phone')?.setValue(phone);
    }
  }

  partyInfoTitleKey(): string {
    return this.partyType === 'supplier' ? 'tr_supplier_info' : 'tr_client_info';
  }

  partyNameLabelKey(): string {
    return this.partyType === 'supplier' ? 'tr_supplier_contact_name' : 'tr_client_name';
  }

  /**
   * Phone format: digits only (optional leading '+'), length 7..15.
   * We ignore spaces, hyphens, and parentheses for user convenience.
   */
  private phoneFormatValidator(control: AbstractControl): ValidationErrors | null {
    const raw = String(control.value ?? '').trim();
    if (!raw) return null;
    const normalized = raw.replace(/[\s\-()]/g, '');
    const ok = /^\+?\d{7,15}$/.test(normalized);
    return ok ? null : { phoneFormat: true };
  }

  toggleClientInfo() {
    this.isClientInfoOpen = !this.isClientInfoOpen;
    if (!this.isClientInfoOpen) {
      this.resetClientFormFields();
    }
  }

  /** Reset phone, name, address, payment to defaults and re-enable disabled controls. */
  private resetClientFormFields(): void {
    this.lastNotifiedPartyId = null;
    this.clientForm.reset({
      phone: '',
      name: '',
      address: ''
    });
    this.clientForm.get('name')?.enable({ emitEvent: false });
    this.clientForm.get('address')?.enable({ emitEvent: false });
    this.isExistingClient = false;
    this.isExistingVendor = false;
    this.selectedClientId = null;
    this.selectedVendorId = null;
    this.supplierCompanyName = '';
  }

  /**
   * Exchange trade-in already captured the client on the purchase; mirror them on the sale
   * so the order is linked in client history even if the cashier panel stays collapsed.
   */
  private applyExchangeClientFromTradeIn(purchase: any): void {
    const af = purchase?.productPayload?.acquiredFrom;
    if (!af || String(af.partyType || 'client').toLowerCase() === 'supplier') {
      return;
    }

    const phone = String(af.phone || '').trim();
    const name = String(af.displayName || af.name || '').trim();
    const address = String(af.address || '').trim();
    const clientId = af.clientId ? String(af.clientId) : null;

    if (!phone && !clientId) {
      return;
    }

    this.partyType = 'client';
    this.isClientInfoOpen = true;
    this.isExistingVendor = false;
    this.selectedVendorId = null;
    this.supplierCompanyName = '';

    if (clientId) {
      this.selectedClientId = clientId;
      this.isExistingClient = true;
    } else {
      this.selectedClientId = null;
      this.isExistingClient = false;
    }

    const nameControl = this.clientForm.get('name');
    const addressControl = this.clientForm.get('address');
    this.clientForm.patchValue(
      { phone: phone || '', name, address: address || '' },
      { emitEvent: false }
    );

    if (this.isExistingClient) {
      nameControl?.disable({ emitEvent: false });
      addressControl?.disable({ emitEvent: false });
      nameControl?.clearValidators();
      addressControl?.clearValidators();
    } else {
      nameControl?.enable({ emitEvent: false });
      addressControl?.enable({ emitEvent: false });
      if (phone) {
        nameControl?.setValidators([Validators.required]);
        addressControl?.setValidators([Validators.required]);
      }
    }
    nameControl?.updateValueAndValidity({ emitEvent: false });
    addressControl?.updateValueAndValidity({ emitEvent: false });
  }

  /** Client fields for checkout: open panel, or exchange trade-in source when panel is closed. */
  private resolveCheckoutClientDetails(): {
    clientName: string;
    clientPhoneNumber: string;
    clientAddress: string;
    clientId?: string;
    partyType: OrderPartyType;
    linkParty: boolean;
  } {
    if (this.isClientInfoOpen) {
      const raw = this.clientForm.getRawValue();
      return {
        clientName: (raw.name || '').trim() || 'Walk-in',
        clientPhoneNumber: (raw.phone || '').trim() || '00',
        clientAddress: (raw.address || '').trim() || '-',
        clientId: this.selectedClientId || undefined,
        partyType: this.partyType,
        linkParty: true,
      };
    }

    const af = this.exchangeTradeInPurchase?.productPayload?.acquiredFrom;
    if (af && String(af.partyType || 'client').toLowerCase() !== 'supplier') {
      const phone = String(af.phone || '').trim();
      const name = String(af.displayName || af.name || '').trim();
      const address = String(af.address || '').trim();
      const clientId = af.clientId ? String(af.clientId) : undefined;
      if (phone || clientId) {
        return {
          clientName: name || 'Walk-in',
          clientPhoneNumber: phone || '00',
          clientAddress: address || '-',
          clientId,
          partyType: 'client',
          linkParty: true,
        };
      }
    }

    return {
      clientName: 'Walk-in',
      clientPhoneNumber: '00',
      clientAddress: '-',
      partyType: 'client',
      linkParty: false,
    };
  }

  /** After successful pay + print: collapse client section and clear form. */
  private clearClientInformationAfterCheckout(): void {
    this.isClientInfoOpen = false;
    this.resetClientFormFields();
  }

  private resetPaymentLinesAfterCheckout(): void {
    this.selectedPayMethods = ['cash'];
    this.payAmounts = { cash: 0 };
  }

  ngAfterViewInit() {
    this.focusBarcodeInput();
    const qrUrl = environment.innovationWebsiteUrl || 'https://www.innovation-tec.com/';
    qrToDataUrl(qrUrl, {
      width: 240,
      margin: 1,
      color: { dark: '#000000', light: '#ffffff' },
    })
      .then((dataUrl) => {
        this.invoiceQrDataUrl = dataUrl;
        this.cdr.detectChanges();
      })
      .catch(() => {
        this.invoiceQrDataUrl = null;
      });
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
    const selectedBranchId = canPickBranchRole(this.curentUser?.role)
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

  /** Confirmed active reservation count on this SKU (unconfirmed bookings do not warn cashier). */
  bookedQty(product: Product | any): number {
    const c = product?.confirmedBookedQuantity;
    if (c != null && Number.isFinite(Number(c))) {
      return Math.max(0, Math.floor(Number(c)));
    }
    return 0;
  }

  /** Units sellable without touching reserved quantity. */
  freeSellableQty(product: Product | any): number {
    const stock = Math.max(0, Math.floor(Number(product?.stock ?? 0)));
    return Math.max(0, stock - this.bookedQty(product));
  }

  ensureDefaultPayAmounts(): void {
    if (this.selectedPayMethods.length !== 1) {
      return;
    }
    const id = this.selectedPayMethods[0];
    const netDue = Math.round(this.effectiveCheckoutTotal() * 100) / 100;
    const cur = Number(this.payAmounts[id]);
    if (!Number.isFinite(cur) || cur <= 0) {
      if (id === 'credit') {
        this.payAmounts = { ...this.payAmounts, credit: 0 };
        return;
      }
      const pct = this.paymentAppFeePercent(id);
      const gross =
        pct > 0 ? Math.round(netDue * (1 + pct / 100) * 100) / 100 : netDue;
      this.payAmounts = { ...this.payAmounts, [id]: Math.max(0, gross) };
    }
  }

  isCreditPayMethod(id: string | undefined | null): boolean {
    return String(id || '').trim().toLowerCase() === 'credit';
  }

  hasCreditPayMethodSelected(): boolean {
    return this.selectedPayMethods.some((id) => this.isCreditPayMethod(id));
  }

  /** `max` on number inputs must be string | number (not null). */
  payAmountInputMax(methodId: string): number | undefined {
    return this.isCreditPayMethod(methodId)
      ? this.effectiveCheckoutTotal()
      : undefined;
  }

  onSelectedPayMethodsChange(ids: string[] | null): void {
    const raw = Array.isArray(ids) ? ids.filter((x) => !!String(x || '').trim()) : [];
    if (!raw.length) {
      this.selectedPayMethods = ['cash'];
      this.reconcilePayAmountsKeys(['cash']);
      return;
    }
    this.reconcilePayAmountsKeys(raw);
  }

  private reconcilePayAmountsKeys(ids: string[]): void {
    const next: Record<string, number> = {};
    for (const id of ids) {
      if (this.isCreditPayMethod(id) && !Number.isFinite(Number(this.payAmounts[id]))) {
        next[id] = 0;
      } else {
        next[id] = Number(this.payAmounts[id]) || 0;
      }
    }
    this.payAmounts = next;
  }

  trackPayMethodId(_index: number, id: string): string {
    return id;
  }

  /** Native tooltip for “+N” overflow chips (no skolera-tooltip in this app). */
  payMethodsOverflowTitle(items: readonly unknown[] | null | undefined): string {
    if (!items?.length || items.length <= 2) {
      return '';
    }
    return items
      .slice(2)
      .map((row) => {
        const item = row as CashierPaymentMethod;
        return item?.labelKey ? this.translate.instant(item.labelKey) : '';
      })
      .filter(Boolean)
      .join(', ');
  }

  getPayMethodDef(id: string): CashierPaymentMethod | undefined {
    return this.paymentMethods.find((m) => m.id === id);
  }

  /** BNPL / wallet surcharge from store settings (0 if unset). */
  paymentAppFeePercent(methodId: string | undefined | null): number {
    const m = String(methodId || '')
      .trim()
      .toLowerCase();
    const row = this.storeSettings.snapshot.paymentAppFeePercents?.find((x) => x.method === m);
    const p = Number(row?.percent);
    return Number.isFinite(p) && p > 0 ? Math.min(p, 100) : 0;
  }

  /**
   * Converts cashier-entered gross (what customer paid in the app, incl. fee) to invoice net.
   */
  payAmountNetForInvoice(methodId: string, enteredGross: number): number {
    const pct = this.paymentAppFeePercent(methodId);
    const g = Number(enteredGross) || 0;
    if (pct <= 0) {
      return Math.round(g * 100) / 100;
    }
    const net = g / (1 + pct / 100);
    return Math.round(net * 100) / 100;
  }

  cashierPaymentHasAnyFee(): boolean {
    return this.selectedPayMethods.some((id) => this.paymentAppFeePercent(id) > 0);
  }

  paymentSplitsTotal(): number {
    const sum = this.selectedPayMethods.reduce(
      (acc, id) => acc + this.payAmountNetForInvoice(id, Number(this.payAmounts[id]) || 0),
      0
    );
    return Math.round(sum * 100) / 100;
  }

  paymentRemaining(): number {
    return Math.round((this.effectiveCheckoutTotal() - this.paymentSplitsTotal()) * 100) / 100;
  }

  paymentOverAllocated(): boolean {
    return this.paymentSplitsTotal() > this.effectiveCheckoutTotal() + 0.001;
  }

  /** Receipt: translation key for payment method id (store receipt language). */
  payMethodLabelKey(method: string | undefined | null): string {
    const m = String(method || '').trim().toLowerCase();
    const opt = this.paymentMethods.find((x) => x.id === m);
    if (opt) {
      return opt.labelKey;
    }
    if (m === 'mixed') {
      return 'tr_pay_mixed';
    }
    return 'tr_pay_cash';
  }

  private maybePushBookingWarning(product: Product | any, newLineQuantity: number): void {
    if (this.bookedQty(product) <= 0) {
      return;
    }
    if (newLineQuantity <= this.freeSellableQty(product)) {
      return;
    }
    this.translate
      .get('tr_cashier_booked_product_warning')
      .subscribe((msg) => this.appNotificationService.push(msg, 'warning'));
  }

  addProduct(product: any) {
    if(product.stock == 0)
      return
    const index = this.orderItems.findIndex(i => i.productId === product._id);
    if (index > -1) {
      const item = this.orderItems[index];
      // Auto-apply product discount by default (when defined on the product).
      if (item?.isApplyDiscount == null) {
        item.isApplyDiscount = Number(item?.discount) > 0;
      }
      const maxStock = Math.max(0, Math.floor(Number(product.stock ?? item.stock ?? 0)));
      if (item.quantity >= maxStock) {
        this.focusBarcodeInput();
        return;
      }
      item.quantity++;
      this.maybePushBookingWarning(item, item.quantity);
      this.refreshExchangePaymentDefaults();
    } else {
      this.maybePushBookingWarning(product, 1);
      this.orderItems.push({
        ...product,
        quantity: 1,
        productId: product._id,
        // Auto-apply discount when product has discount%.
        isApplyDiscount: Number(product?.discount) > 0,
      });
    }

    this.focusBarcodeInput();
    this.refreshExchangePaymentDefaults();
  }

  scanProduct(code: string) {
    if (!code) return;
    const product = this.products.find(p => p.code === code);
    if (product) this.addProduct(product);
    this.barcode = '';
  }

  increaseQty(i: number) {
    const item = this.orderItems[i];
    const maxStock = Math.max(0, Math.floor(Number(item.stock ?? 0)));
    if (item.quantity >= maxStock) {
      this.focusBarcodeInput();
      return;
    }
    item.quantity++;
    this.maybePushBookingWarning(item, item.quantity);
    this.refreshExchangePaymentDefaults();
    this.focusBarcodeInput();
  }
  decreaseQty(i: number) { 
    if (this.orderItems[i].quantity > 1) this.orderItems[i].quantity--; 
    this.refreshExchangePaymentDefaults();
    this.focusBarcodeInput();
  }
  removeItem(i: number) {
    this.orderItems.splice(i, 1);
    this.refreshExchangePaymentDefaults();
    this.focusBarcodeInput();
  }

  /** Unit price after product-level discount (matches backend). */
  lineUnitPrice(item: any): number {
    let p = Number(item?.price) || 0;
    if (item?.isApplyDiscount && Number(item?.discount) > 0) {
      p = p - (p * Number(item.discount)) / 100;
    }
    return Math.round(p * 10000) / 10000;
  }

  /** Product card price after discount% (visual only; cards don't toggle discount). */
  cardDiscountedPrice(product: any): number {
    const p = Number(product?.price) || 0;
    const d = Number(product?.discount) || 0;
    if (d <= 0) return p;
    return Math.round((p - (p * d) / 100) * 100) / 100;
  }

  cardHasDiscount(product: any): boolean {
    return (Number(product?.discount) || 0) > 0;
  }

  /** Sum of lines after product discounts, before invoice extra discount. */
  orderSubtotal(): number {
    return this.orderItems.reduce(
      (acc, item) => acc + this.lineUnitPrice(item) * Number(item.quantity || 0),
      0
    );
  }

  /** Invoice extra discount in EGP (derived from current mode + input). */
  appliedInvoiceDiscount(): number {
    const sub = Math.round(this.orderSubtotal() * 100) / 100;
    if (sub <= 0) return 0;
    const v = Number(this.invoiceExtraValue);
    if (!Number.isFinite(v)) return 0;

    switch (this.invoiceDiscountMode) {
      case 'percent': {
        if (v <= 0) return 0;
        const p = Math.min(100, Math.max(0, v));
        return Math.round(((sub * p) / 100) * 100) / 100;
      }
      case 'amount': {
        if (v <= 0) return 0;
        return Math.min(Math.round(v * 100) / 100, sub);
      }
      case 'final': {
        const target = Math.max(0, Math.round(v * 100) / 100);
        return Math.round((sub - target) * 100) / 100;
      }
      default:
        return 0;
    }
  }

  canApplyInvoiceDiscount(): boolean {
    return (this.orderItems?.length || 0) > 0 && this.orderSubtotal() > 0;
  }

  finalOrderTotal(): number {
    const sub = Math.round(this.orderSubtotal() * 100) / 100;
    return Math.round((sub - this.appliedInvoiceDiscount()) * 100) / 100;
  }

  /** Equivalent % of subtotal (discount or surcharge vs lines total). */
  invoiceDiscountPercentEquivalent(): number {
    const sub = Math.round(this.orderSubtotal() * 100) / 100;
    if (sub <= 0) return 0;
    const d = this.appliedInvoiceDiscount();
    if (d === 0) return 0;
    const mag = Math.abs(d);
    return Math.round((mag / sub) * 10000) / 100;
  }

  onInvoiceDiscountModeChange(): void {
    if (!this.canApplyInvoiceDiscount()) {
      this.invoiceDiscountMode = 'percent';
    }
    this.invoiceExtraValue = 0;
    this.refreshExchangePaymentDefaults();
  }

  /** Max value for the number input (percent 0–100; amount capped at subtotal; final unbounded). */
  invoiceExtraInputMax(): number {
    if (this.invoiceDiscountMode === 'percent') return 100;
    if (this.invoiceDiscountMode === 'final') return 999999999;
    return Math.max(0, Math.round(this.orderSubtotal() * 100) / 100);
  }

  onInvoiceExtraValueChange(): void {
    if (!this.canApplyInvoiceDiscount()) {
      this.invoiceExtraValue = 0;
      return;
    }
    const sub = Math.round(this.orderSubtotal() * 100) / 100;
    let v = Number(this.invoiceExtraValue);
    if (!Number.isFinite(v)) return;

    if (this.invoiceDiscountMode === 'percent') {
      if (v < 0) v = 0;
      if (v > 100) v = 100;
    } else if (this.invoiceDiscountMode === 'amount') {
      if (v < 0) v = 0;
      if (v > sub) v = sub;
    } else {
      if (v < 0) v = 0;
    }
    this.invoiceExtraValue = Math.round(v * 100) / 100;
    this.refreshExchangePaymentDefaults();
  }

  getTotal() { 
    return this.orderSubtotal(); 
  }
  getDiscountAmount() {
    return this.orderItems.reduce((acc, item) => {
      if (!item?.isApplyDiscount || Number(item.discount) <= 0) return acc;
      const base = Number(item.price) || 0;
      const unitDisc = (base * Number(item.discount)) / 100;
      return acc + unitDisc * Number(item.quantity || 0);
    }, 0);
  }
  getTotalAfterDiscount() {
    return this.finalOrderTotal();
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

    this.ensureDefaultPayAmounts();

    if (this.paymentOverAllocated()) {
      this.translate
        .get('tr_cashier_payment_over')
        .subscribe((msg) => this.appNotificationService.push(msg, 'error'));
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

    const selectedBranchId = canPickBranchRole(this.curentUser?.role)
      ? this.adminSelectedBranchId
      : this.globals.currentUser.branch._id;

    const clientDetails = this.resolveCheckoutClientDetails();

    const paymentSplits = this.selectedPayMethods
      .filter((id) => String(id || '').trim())
      .map((id) => ({
        method: String(id).trim().toLowerCase(),
        amount: this.payAmountNetForInvoice(id, Number(this.payAmounts[id]) || 0),
      }));

    const exchangeCredit = this.exchangeTradeInPurchase ? this.exchangeTradeInCredit() : 0;
    const exchangePurchaseId = this.exchangeTradeInPurchase?._id;

    const orderData: Record<string, unknown> = {
      products: this.orderItems.map((i) => ({ selectedProduct: i, quantity: i.quantity })),
      partyType: clientDetails.linkParty ? clientDetails.partyType : 'client',
      clientName: clientDetails.clientName,
      clientPhoneNumber: clientDetails.clientPhoneNumber,
      clientAddress: clientDetails.clientAddress,
      paymentSplits,
      branch: selectedBranchId,
      status: 'completed',
      userId: this.curentUser._id,
      invoiceDiscountAmount: this.appliedInvoiceDiscount(),
    };

    if (clientDetails.clientId) {
      orderData.clientId = clientDetails.clientId;
    }

    if (clientDetails.linkParty && clientDetails.partyType === 'supplier' && this.selectedVendorId) {
      orderData.vendorId = this.selectedVendorId;
    }

    if (exchangeCredit > 0) {
      orderData.exchangeTradeInCreditAmount = exchangeCredit;
      if (exchangePurchaseId) {
        orderData.exchangeProductPurchaseRequestId = exchangePurchaseId;
      }
    }

    const receiptSubtotal = Math.round(this.orderSubtotal() * 100) / 100;
    const receiptInvoiceDisc = Math.round(this.appliedInvoiceDiscount() * 100) / 100;
    const receiptFinal =
      Math.round((receiptSubtotal - receiptInvoiceDisc) * 100) / 100;

    this.ordersSerivce.createOrder(orderData).subscribe((res: any) => {
      const pendingPurchaseReceipt = this.exchangeTradeInPurchase;
      this.exchangeTradeInPurchase = null;

      const base = res?.newOrder ?? {};
      // Receipt must show invoice-level discount even if API omits fields or CD lags.
      this.createdOrder = {
        ...base,
        partyType: clientDetails.linkParty ? clientDetails.partyType : 'client',
        subtotalPrice: receiptSubtotal,
        invoiceDiscountAmount: receiptInvoiceDisc,
        totalPrice: receiptFinal,
      };

      this.pendingExchangePurchaseReceipt =
        exchangeCredit > 0 && pendingPurchaseReceipt ? pendingPurchaseReceipt : null;

      this.printInvoice();

      this.loadProducts();
      this.focusBarcodeInput();

    }, error=> {
      console.log("error",error);
      
      this.appNotificationService.push(error.error.details, 'error');
    });
  }

  printInvoice(): void {
    setTimeout(() => {
      this.cdr.detectChanges();
      window.print();

      this.orderItems = [];
      this.resetPaymentLinesAfterCheckout();
      this.invoiceDiscountMode = 'percent';
      this.invoiceExtraValue = 0;
      this.clearClientInformationAfterCheckout();

      const snap = this.pendingExchangePurchaseReceipt;
      this.pendingExchangePurchaseReceipt = null;

      if (snap) {
        setTimeout(() => {
          this.createdDeskPurchase = snap;
          this.printMode = 'deskPurchase';
          this.cdr.detectChanges();
          setTimeout(() => {
            window.print();
            setTimeout(() => {
              this.printMode = 'sale';
              this.createdDeskPurchase = null;
              this.cdr.detectChanges();
            }, 400);
          }, 320);
        }, 650);
      }
    }, 300);
  }

  receiptLinesSubtotal(): number {
    const o = this.createdOrder;
    const raw = o?.subtotalPrice;
    if (
      o &&
      raw != null &&
      raw !== '' &&
      Number.isFinite(Number(raw))
    ) {
      return Math.round(Number(raw) * 100) / 100;
    }
    if (!o?.products?.length) return 0;
    const sum = o.products.reduce(
      (s: number, item: any) => s + Number(item.price || 0) * Number(item.quantity || 0),
      0
    );
    return Math.round(sum * 100) / 100;
  }

  /** Positive extra discount amount (EGP), for receipt line. */
  receiptInvoiceExtraDiscount(): number {
    const d = Number(this.createdOrder?.invoiceDiscountAmount);
    if (!Number.isFinite(d) || d <= 0) return 0;
    return Math.round(d * 100) / 100;
  }

  /** Positive surcharge amount when final total was set above subtotal. */
  receiptInvoiceSurchargeAmount(): number {
    const d = Number(this.createdOrder?.invoiceDiscountAmount);
    if (!Number.isFinite(d) || d >= 0) return 0;
    return Math.round(-d * 100) / 100;
  }

  receiptFinalTotal(): number {
    const t = Number(this.createdOrder?.totalPrice);
    if (Number.isFinite(t)) {
      return Math.round(t * 100) / 100;
    }
    const sub = this.receiptLinesSubtotal();
    const adj = Number(this.createdOrder?.invoiceDiscountAmount);
    const disc = Number.isFinite(adj) ? adj : 0;
    return Math.round((sub - disc) * 100) / 100;
  }

  receiptPaidPayments(): Array<{ method?: string; amount: number }> {
    const list = this.createdOrder?.payments;
    if (!Array.isArray(list)) {
      return [];
    }
    return list.filter((p: any) => Number(p?.amount) > 0);
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

  /** Receipt currency suffix for 58mm print. */
  receiptCurrencyLabel(receiptLanguage: string | null | undefined): string {
    const l = String(receiptLanguage || '').toLowerCase();
    // Keep it short to avoid wrapping in narrow columns.
    return l.startsWith('ar') ? 'ج.م' : 'LE';
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
  receiptPartyType(): OrderPartyType {
    const t = this.createdOrder?.partyType;
    return t === 'supplier' ? 'supplier' : 'client';
  }

  receiptPartyTypeLabelKey(): string {
    return this.receiptPartyType() === 'supplier'
      ? 'tr_invoice_party_supplier'
      : 'tr_invoice_party_client';
  }

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
