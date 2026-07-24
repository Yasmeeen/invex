import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import { formatDate } from '@angular/common';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { AbstractControl, ValidationErrors } from '@angular/forms';
import { TranslateService } from '@ngx-translate/core';
import { of, Subject, Subscription } from 'rxjs';
import { debounceTime, switchMap, catchError, takeUntil } from 'rxjs/operators';
import { Globals } from '@core/globals';
import {
  buildCashierPaymentMethods,
  CashierPaymentMethod,
  paymentMethodDisplayLabel,
} from '@shared/utils/cashier-payment-methods.util';
import {
  findProductByScannedCode,
  productMatchesSearchTerm,
} from '@shared/utils/product-code-match.util';
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
import {
  ProductDetailsDialogComponent,
} from '../../products/product-details-dialog/product-details-dialog.component';
import {
  DeskPurchaseDeferredPaymentDialogComponent,
  ExchangeSettlementTreasuryResult,
} from '../../orders/desk-purchase-deferred-payment-dialog/desk-purchase-deferred-payment-dialog.component';
import { PurchaseTreasurySplit } from '@shared/services/product-purchase-requests.service';
import { DailyExpenseDialogComponent } from '../../expenses/daily-expense-dialog/daily-expense-dialog.component';
import { DrawerCloseDialogComponent } from '../../drawer-close/drawer-close-dialog/drawer-close-dialog.component';
import { DrawerCloseService } from '@shared/services/drawer-close.service';
import { ConfirmationDialogComponent } from '@shared/components/confirmation-dialog/confirmation-dialog.component';
import {
  BookingDepositAllocation,
  CheckoutActiveBooking,
  ProductBookingsService,
} from '@shared/services/product-bookings.service';
import { BookingReprintService } from '@shared/services/booking-reprint.service';
import { InvoiceReprintService } from '@shared/services/invoice-reprint.service';
import {
  PaymentSplitsDialogComponent,
  PaymentSplitsDialogData,
} from '@shared/components/payment-splits-dialog/payment-splits-dialog.component';
import {
  PaymentSplitsResult,
  buildPaymentSplitsResult,
  paymentSplitsNetTotal,
  round2,
} from '@shared/utils/payment-app-fee.util';
import { toDataURL as qrToDataUrl } from 'qrcode';
import { environment } from 'src/environments/environment';

@Component({
  selector: 'app-cashier-order',
  templateUrl: './cashier.component.html',
  styleUrls: ['./cashier.component.scss']
})
export class CashierComponent implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild('barcodeInput') barcodeInput!: ElementRef;

  products: Product[] = [];
  orderItems: any[] = [];
  /** Index of order line whose unit price is being edited; null when not editing. */
  editingPriceIndex: number | null = null;
  /** Draft unit price while editing (invoice-only; does not update catalog). */
  editingPriceValue: number | string = '';
  todayDate = new Date();
  createdOrder:any;
  /** Data URL for Innovation website QR on printed receipt. */
  invoiceQrDataUrl: string | null = null;
  /** How the cashier enters invoice-level discount: %, fixed amount, or target final total. */
  invoiceDiscountMode: 'percent' | 'amount' | 'final' = 'percent';
  /** Meaning depends on `invoiceDiscountMode` (see `appliedInvoiceDiscount`). */
  invoiceExtraValue = 0;
  /** Confirmed split payment from dialog (net splits + fee allocations). */
  confirmedPayment: PaymentSplitsResult | null = null;
  private confirmedPaymentForTotal: number | null = null;

  searchTerm = '';
  barcode = '';
  isCashierFullScreen: boolean = true;
  curentUser;
  branches: Branch [] =[];
  adminSelectedBranchId: string
  branchSalespeople: string[] = [];
  selectedSellerName: string | null = null;
  sellerFieldTouched = false;

  /** Cash left in drawer from the last close (opening balance for today). */
  drawerOpeningBalance = 0;
  drawerPeriodAlreadyClosed = false;
  drawerReopening = false;

  /** Desk product purchase (inventory intake); receipt print uses shared component. */
  createdDeskPurchase: any = null;
  printMode: 'sale' | 'deskPurchase' = 'sale';

  /** Exchange: trade-in product intake recorded via desk purchase; cleared after checkout / cancel. */
  exchangeTradeInPurchase: any = null;
  /** After sale receipt print, optionally print trade-in purchase receipt. */
  private pendingExchangePurchaseReceipt: any = null;
  /** Store pays customer/supplier the exchange difference — treasury chosen at checkout. */
  private pendingExchangeSettlement: ExchangeSettlementTreasuryResult | null = null;

  // Client / supplier information section
  isClientInfoOpen = true;
  clientForm: FormGroup;
  partyType: OrderPartyType = 'client';
  isExistingClient = false;
  isExistingVendor = false;
  selectedClientId: string | null = null;
  selectedVendorId: string | null = null;
  supplierCompanyName = '';
  /** Avoid repeating the same “registered” toast for the same lookup. */
  private lastNotifiedPartyId: string | null = null;

  /** Active product bookings for the current client (deposit credit at checkout). */
  clientActiveBookings: CheckoutActiveBooking[] = [];
  private clientBookingsLoadToken = 0;
  private readonly destroy$ = new Subject<void>();

  /** Built from store settings; refreshed on settings$ updates (receipt labels). */
  paymentMethods: CashierPaymentMethod[] = [];

  private settingsSub?: Subscription;
  /** Debounce barcode scanner input so product adds without pressing Enter. */
  private barcodeScanTimer: ReturnType<typeof setTimeout> | null = null;

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
    private drawerCloseService: DrawerCloseService,
    private productBookings: ProductBookingsService,
    private bookingReprint: BookingReprintService,
    private invoiceReprint: InvoiceReprintService,
    private cdr: ChangeDetectorRef
  ) {
    this.curentUser = this.authenticationService.getUserFromLocalStorage();
    if (canPickBranchRole(this.curentUser?.role)) {
      this.getBranches(); // loadProducts runs after a branch is selected
    } else {
      this.loadProducts();
      this.loadBranchSalespeople();
    }
    this.initClientForm();
  }

  ngOnInit(): void {
    this.rebuildPaymentMethods();
    this.settingsSub = this.storeSettings.settings$.subscribe(() => this.rebuildPaymentMethods());
    this.loadDrawerOpeningBalance();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.settingsSub?.unsubscribe();
    if (this.barcodeScanTimer != null) {
      clearTimeout(this.barcodeScanTimer);
      this.barcodeScanTimer = null;
    }
  }

  private rebuildPaymentMethods(): void {
    this.paymentMethods = buildCashierPaymentMethods(
      this.storeSettings.snapshot.paymentAppFeePercents,
      this.translate
    );
    this.cdr.markForCheck();
  }

  hasValidConfirmedPayment(): boolean {
    if (!this.confirmedPayment || this.confirmedPaymentForTotal == null) {
      return false;
    }
    return Math.abs(this.confirmedPaymentForTotal - this.effectiveCheckoutTotal()) < 0.01;
  }

  paymentSummaryText(): string {
    if (!this.confirmedPayment) {
      return '';
    }
    const methods = this.confirmedPayment.paymentSplits.filter((s) => s.amount > 0).length;
    const total = paymentSplitsNetTotal(this.confirmedPayment.paymentSplits);
    return this.translate.instant('tr_payment_splits_summary', {
      count: methods,
      total,
    });
  }

  /** Short preview shown in collapsed client-info header (phone / name). */
  clientInfoPreview(): string {
    const phone = String(this.clientForm.get('phone')?.value ?? '').trim();
    const name = String(this.clientForm.get('name')?.value ?? '').trim();
    const parts: string[] = [];
    if (phone && name) {
      parts.push(`${phone} · ${name}`);
    } else {
      const primary = phone || name;
      if (primary) {
        parts.push(primary);
      }
    }
    if (this.selectedSellerName) {
      parts.push(this.selectedSellerName);
    }
    return parts.join(' · ');
  }

  openPaymentSplitsDialog(autoCheckout = false): void {
    const data: PaymentSplitsDialogData = {
      invoiceNetTotal: this.effectiveCheckoutTotal(),
      mode: 'checkout',
      initialState: this.hasValidConfirmedPayment()
        ? {
            selectedPayMethods: this.confirmedPayment!.paymentSplits.map((s) => s.method),
            payAmounts: this.confirmedPayment!.paymentSplits.reduce(
              (acc, s) => {
                acc[s.method] = s.amount;
                return acc;
              },
              {} as Record<string, number>
            ),
            feeSources: this.confirmedPayment!.feeAllocations.map((f) => ({
              forMethod: f.forMethod,
              paidVia: f.paidVia === f.forMethod ? 'same' : f.paidVia,
            })),
          }
        : undefined,
    };

    const ref = this.dialog.open(PaymentSplitsDialogComponent, {
      width: '560px',
      maxWidth: '95vw',
      panelClass: 'payment-splits-dialog-panel',
      backdropClass: 'payment-splits-dialog-backdrop',
      data,
    });

    ref.afterClosed().subscribe((result: PaymentSplitsResult | null) => {
      if (!result) {
        return;
      }
      this.confirmedPayment = result;
      this.confirmedPaymentForTotal = this.effectiveCheckoutTotal();
      if (autoCheckout) {
        this.performCheckout(result);
      }
    });
  }

  private invalidateConfirmedPayment(): void {
    this.confirmedPayment = null;
    this.confirmedPaymentForTotal = null;
  }

  startExchangeFlow(): void {
    this.openDeskPurchaseProductDialog({ mode: 'exchange' });
  }

  cancelExchangeFlow(): void {
    this.exchangeTradeInPurchase = null;
    this.pendingExchangeSettlement = null;
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
      width: '640px',
      maxWidth: '96vw',
      panelClass: 'drawer-close-dialog-panel',
      backdropClass: 'drawer-close-dialog-backdrop',
      data: {
        userId: uid,
        forcedBranchId: String(selectedBranchId),
      },
      disableClose: true,
    });

    ref.afterClosed().subscribe((ok) => {
      if (ok) {
        this.loadDrawerOpeningBalance();
      }
    });
  }

  private cashierBranchId(): string | null {
    const id = canPickBranchRole(this.curentUser?.role)
      ? this.adminSelectedBranchId
      : (this.globals.currentUser?.branch as { _id?: string } | string | undefined);
    if (!id) return null;
    return typeof id === 'string' ? String(id).trim() : id?._id ? String(id._id).trim() : null;
  }

  reopenLastDrawerClose(): void {
    const branchId = this.cashierBranchId();
    const uid = this.curentUser?._id;
    if (!branchId || !uid || this.drawerReopening) return;

    const dialogRef = this.dialog.open(ConfirmationDialogComponent, {
      width: '450px',
      disableClose: true,
      data: {
        title: this.translate.instant('tr_drawer_close_reopen_confirm_short'),
        buttons: [
          {
            label: this.translate.instant('tr_action.cancel'),
            actionCallback: 'cancel',
            type: 'btn-secondary',
          },
          {
            label: this.translate.instant('tr_drawer_close_reopen_action'),
            actionCallback: 'reopen',
            type: 'btn-danger',
          },
        ],
      },
    });

    dialogRef.afterClosed().subscribe((result) => {
      if (result !== 'reopen') return;
      this.drawerReopening = true;
      const today = formatDate(new Date(), 'yyyy-MM-dd', 'en-US');
      this.drawerCloseService.reopenLast({ userId: uid, branch: branchId, date: today }).subscribe({
        next: () => {
          this.drawerReopening = false;
          this.translate
            .get('tr_drawer_close_reopen_success')
            .subscribe((msg) => this.appNotificationService.push(msg, 'success'));
          this.loadDrawerOpeningBalance();
        },
        error: (err) => {
          this.drawerReopening = false;
          const msg = err?.error?.error || this.translate.instant('tr_unexpected_error_message');
          this.appNotificationService.push(msg, 'error');
        },
      });
    });
  }

  loadDrawerOpeningBalance(): void {
    const branchId = this.cashierBranchId();
    const uid = this.curentUser?._id;
    if (!branchId || !uid) {
      this.drawerOpeningBalance = 0;
      this.drawerPeriodAlreadyClosed = false;
      return;
    }

    const today = formatDate(new Date(), 'yyyy-MM-dd', 'en-US');
    this.drawerCloseService.openingBalance({ userId: uid, branch: branchId, date: today }).subscribe({
      next: (res) => {
        this.drawerOpeningBalance = round2(Number(res.openingCashBalance ?? 0));
        this.drawerPeriodAlreadyClosed = Boolean(res.periodAlreadyClosed);
        this.cdr.markForCheck();
      },
      error: () => {
        this.drawerOpeningBalance = 0;
        this.drawerPeriodAlreadyClosed = false;
      },
    });
  }

  drawerOpeningBalanceFormatted(): string {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: 'EGP',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(this.drawerOpeningBalance);
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

  /** Payment totals compare against this amount at cashier when exchange / booking deposit active. */
  effectiveCheckoutTotal(): number {
    let due = Math.round(this.finalOrderTotal() * 100) / 100;
    if (this.exchangeTradeInPurchase) {
      due = this.exchangeAmountDue();
    }
    const bookingCredit = this.bookingDepositCredit();
    return Math.round(Math.max(0, due - bookingCredit) * 100) / 100;
  }

  /** Prepaid booking deposits applied to matching cart lines for the current client. */
  bookingDepositCredit(): number {
    return this.bookingDepositAllocations().reduce((s, a) => s + a.creditApplied, 0);
  }

  bookingDepositAllocations(): BookingDepositAllocation[] {
    if (this.partyType !== 'client' || !this.clientActiveBookings?.length || !this.orderItems?.length) {
      return [];
    }
    const remainingByBooking = new Map<string, number>();
    for (const b of this.clientActiveBookings) {
      remainingByBooking.set(String(b._id), Math.max(1, Math.floor(Number(b.quantity) || 1)));
    }
    const depositByBooking = new Map<string, number>();
    for (const b of this.clientActiveBookings) {
      depositByBooking.set(
        String(b._id),
        Math.round((Number(b.depositAmount) || 0) * 100) / 100
      );
    }
    const qtyByBooking = new Map<string, number>();
    for (const b of this.clientActiveBookings) {
      qtyByBooking.set(String(b._id), Math.max(1, Math.floor(Number(b.quantity) || 1)));
    }

    const byProduct = new Map<string, CheckoutActiveBooking[]>();
    for (const b of this.clientActiveBookings) {
      const pid = String(b.productId || '');
      if (!pid) continue;
      const list = byProduct.get(pid) || [];
      list.push(b);
      byProduct.set(pid, list);
    }

    const allocations: BookingDepositAllocation[] = [];
    let saleRemaining =
      this.exchangeTradeInPurchase
        ? this.exchangeAmountDue()
        : Math.round(this.finalOrderTotal() * 100) / 100;

    for (const item of this.orderItems) {
      if (saleRemaining <= 0) break;
      const pid = String(item.productId || item._id || '');
      const bookings = byProduct.get(pid);
      if (!bookings?.length) continue;

      let needQty = Math.max(0, Math.floor(Number(item.quantity) || 0));
      const lineTotal = Math.round(this.lineUnitPrice(item) * needQty * 100) / 100;
      let lineCreditCap = Math.min(lineTotal, saleRemaining);

      for (const b of bookings) {
        if (needQty <= 0 || lineCreditCap <= 0 || saleRemaining <= 0) break;
        const id = String(b._id);
        const left = remainingByBooking.get(id) || 0;
        if (left <= 0) continue;
        const take = Math.min(needQty, left);
        const bookedQty = qtyByBooking.get(id) || take;
        const dep = depositByBooking.get(id) || 0;
        let credit = Math.round((dep * (take / bookedQty)) * 100) / 100;
        credit = Math.min(credit, lineCreditCap, saleRemaining, dep);
        if (credit <= 0 || take <= 0) continue;

        allocations.push({
          bookingId: id,
          quantityApplied: take,
          creditApplied: credit,
        });
        remainingByBooking.set(id, left - take);
        needQty -= take;
        lineCreditCap = Math.round((lineCreditCap - credit) * 100) / 100;
        saleRemaining = Math.round((saleRemaining - credit) * 100) / 100;
      }
    }

    return allocations;
  }

  private refreshExchangePaymentDefaults(): void {
    this.invalidateConfirmedPayment();
  }

  private loadClientActiveBookings(): void {
    if (this.partyType !== 'client') {
      this.clientActiveBookings = [];
      this.invalidateConfirmedPayment();
      return;
    }
    const phone = String(this.clientForm?.get('phone')?.value || '').trim();
    const clientId = this.selectedClientId || '';
    if (!phone && !clientId) {
      this.clientActiveBookings = [];
      this.invalidateConfirmedPayment();
      return;
    }
    const token = ++this.clientBookingsLoadToken;
    this.productBookings
      .getActiveForCheckout({ phone: phone || undefined, clientId: clientId || undefined })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          if (token !== this.clientBookingsLoadToken) return;
          this.clientActiveBookings = Array.isArray(res?.bookings) ? res.bookings : [];
          this.invalidateConfirmedPayment();
          const hasDeposit = this.clientActiveBookings.some(
            (b) => (Number(b.depositAmount) || 0) > 0
          );
          if (hasDeposit) {
            this.translate.get('tr_cashier_booking_deposit_applied').subscribe((msg) => {
              this.appNotificationService.push(msg, 'success');
            });
          }
        },
        error: () => {
          if (token !== this.clientBookingsLoadToken) return;
          this.clientActiveBookings = [];
          this.invalidateConfirmedPayment();
        },
      });
  }

  private clearClientActiveBookings(): void {
    this.clientBookingsLoadToken++;
    this.clientActiveBookings = [];
  }

  receiptExchangeCredit(): number {
    const v = Number(this.createdOrder?.exchangeTradeInCreditAmount);
    return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
  }

  receiptBookingDepositCredit(): number {
    const v = Number(this.createdOrder?.bookingDepositCreditAmount);
    return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
  }

  receiptExchangeCollected(): number {
    const v = Number(this.createdOrder?.amountPaid);
    return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
  }

  printDeskPurchaseReceipt(): void {
    setTimeout(() => {
      this.cdr.detectChanges();
      this.runCashierPrint();
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
      this.loadBranchSalespeople();
   })
  }

  onAdminBranchChange(): void {
    this.loadProducts();
    this.loadBranchSalespeople();
  }

  private resolveCashierBranchId(): string | null {
    if (canPickBranchRole(this.curentUser?.role)) {
      return this.adminSelectedBranchId || null;
    }
    const branch = this.globals.currentUser?.branch as { _id?: string } | string | undefined;
    if (typeof branch === 'string') {
      return branch;
    }
    return branch?._id ? String(branch._id) : null;
  }

  loadBranchSalespeople(branchId?: string): void {
    const id = branchId || this.resolveCashierBranchId();
    if (!id) {
      this.branchSalespeople = [];
      this.selectedSellerName = null;
      return;
    }

    this.branchesServce.getBranch(id).subscribe({
      next: (branch: any) => {
        this.branchSalespeople = (branch?.salespeople || [])
          .filter((sp: { active?: boolean; name?: string }) => sp.active !== false && String(sp.name || '').trim())
          .map((sp: { name: string }) => String(sp.name).trim());

        if (this.branchSalespeople.length === 1) {
          this.selectedSellerName = this.branchSalespeople[0];
        } else if (
          !this.selectedSellerName ||
          !this.branchSalespeople.includes(this.selectedSellerName)
        ) {
          this.selectedSellerName = null;
        }
      },
      error: () => {
        this.branchSalespeople = [];
        this.selectedSellerName = null;
      },
    });
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
            this.clearClientActiveBookings();
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
                // Still try bookings by phone (customer may only exist on booking).
                if (this.partyType === 'client') {
                  this.loadClientActiveBookings();
                } else {
                  this.clearClientActiveBookings();
                }
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
          this.clearClientActiveBookings();
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
          this.loadClientActiveBookings();
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
    this.clearClientActiveBookings();
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
    this.clearClientActiveBookings();
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
    this.loadClientActiveBookings();
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
    this.resetSellerNameAfterCheckout();
  }

  private resetSellerNameAfterCheckout(): void {
    this.sellerFieldTouched = false;
    if (this.branchSalespeople.length === 1) {
      this.selectedSellerName = this.branchSalespeople[0];
      return;
    }
    this.selectedSellerName = null;
  }

  private resetPaymentLinesAfterCheckout(): void {
    this.invalidateConfirmedPayment();
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
    this.loadDrawerOpeningBalance();
  }

  filteredProducts() {
    const inStock = this.products.filter((p: Product) => Number(p.stock ?? 0) > 0);
    if (!this.searchTerm) return inStock;
    return inStock.filter((p: Product) =>
      productMatchesSearchTerm(p, this.searchTerm)
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

  /** UI label for a payment method id (uses store settings names when set). */
  payMethodDisplayLabel(method: string | undefined | null): string {
    return paymentMethodDisplayLabel(
      method,
      this.storeSettings.snapshot.paymentAppFeePercents,
      this.translate
    );
  }

  /** Receipt label in store receipt language. */
  payMethodReceiptLabel(method: string | undefined | null): string {
    return paymentMethodDisplayLabel(
      method,
      this.storeSettings.snapshot.paymentAppFeePercents,
      this.translate,
      this.storeSettings.snapshot.receiptLanguage
    );
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

  openProductDetails(product: Product | any, event?: Event): void {
    event?.stopPropagation();
    if (!product) return;
    this.dialog.open(ProductDetailsDialogComponent, {
      width: '760px',
      maxWidth: '95vw',
      data: { product, allowAddToOrder: false },
      autoFocus: false,
    });
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

  /**
   * Auto-add when scanner/type finishes (no Enter needed).
   * Scanners dump chars quickly then pause; debounce waits for that pause.
   */
  onBarcodeInput(): void {
    if (this.barcodeScanTimer != null) {
      clearTimeout(this.barcodeScanTimer);
    }
    const code = (this.barcode || '').trim();
    if (!code) return;

    this.barcodeScanTimer = setTimeout(() => {
      this.barcodeScanTimer = null;
      if (findProductByScannedCode(this.products, code)) {
        this.scanProduct(code);
      }
    }, 180);
  }

  scanProduct(code: string) {
    if (this.barcodeScanTimer != null) {
      clearTimeout(this.barcodeScanTimer);
      this.barcodeScanTimer = null;
    }
    if (!code) return;
    const product = findProductByScannedCode(this.products, code);
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
    if (this.editingPriceIndex === i) {
      this.cancelEditLinePrice();
    } else if (this.editingPriceIndex != null && this.editingPriceIndex > i) {
      this.editingPriceIndex--;
    }
    this.orderItems.splice(i, 1);
    this.refreshExchangePaymentDefaults();
    this.focusBarcodeInput();
  }

  /** Start inline edit of unit price for this invoice line only. */
  startEditLinePrice(i: number): void {
    const item = this.orderItems[i];
    if (!item) return;
    this.editingPriceIndex = i;
    this.editingPriceValue = Math.round(this.lineUnitPrice(item) * 100) / 100;
    setTimeout(() => {
      const el = document.querySelector(
        '.order-line-price-input'
      ) as HTMLInputElement | null;
      if (el) {
        el.focus();
        el.select();
      }
    }, 0);
  }

  onLinePriceKeydown(event: KeyboardEvent, i: number): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.commitLinePrice(i);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.cancelEditLinePrice();
      this.focusBarcodeInput();
    }
  }

  /**
   * Apply edited unit price to this order line only (catalog product price unchanged).
   * Clears line discount so the receipt shows exactly the entered price.
   */
  commitLinePrice(i: number): void {
    if (this.editingPriceIndex !== i) return;
    const item = this.orderItems[i];
    if (!item) {
      this.cancelEditLinePrice();
      return;
    }

    let v = Number(this.editingPriceValue);
    if (!Number.isFinite(v) || v < 0) {
      this.cancelEditLinePrice();
      this.focusBarcodeInput();
      return;
    }

    v = Math.round(v * 100) / 100;
    const previous = Math.round(this.lineUnitPrice(item) * 100) / 100;
    if (v === previous) {
      this.cancelEditLinePrice();
      this.focusBarcodeInput();
      return;
    }

    // Invoice-line override only — catalog product.price is never updated.
    item.price = v;
    item.isApplyDiscount = false;
    item.priceOverridden = true;
    this.cancelEditLinePrice();
    this.refreshExchangePaymentDefaults();
    this.focusBarcodeInput();
  }

  cancelEditLinePrice(): void {
    this.editingPriceIndex = null;
    this.editingPriceValue = '';
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

  onPayClick(): void {
    if (!this.orderItems.length) {
      this.translate.get('tr_cashier.NO_ITEMS').subscribe((msg) => alert(msg));
      return;
    }

    if (this.branchSalespeople.length && !this.selectedSellerName) {
      this.isClientInfoOpen = true;
      this.sellerFieldTouched = true;
      this.appNotificationService.push(
        this.translate.instant('tr_cashier_seller_required'),
        'error'
      );
      return;
    }

    if (this.exchangeTradeInPurchase) {
      const storeOwes = this.exchangeStoreOwesCustomer();
      if (storeOwes > 0.01) {
        this.openExchangeSettlementTreasuryDialog(storeOwes, () => this.continueExchangeCheckout());
        return;
      }
      this.pendingExchangeSettlement = null;
      this.continueExchangeCheckout();
      return;
    }

    if (!this.isClientInfoOpen) {
      this.performCheckout(this.buildDefaultCashPayment());
      return;
    }

    this.clientForm.markAllAsTouched();
    if (!this.clientForm.valid) {
      this.translate.get('tr_invalid_cashier_client').subscribe((msg) =>
        this.appNotificationService.push(msg, 'error')
      );
      return;
    }

    if (this.hasValidConfirmedPayment() && this.confirmedPayment) {
      this.performCheckout(this.confirmedPayment);
      return;
    }

    this.openPaymentSplitsDialog(true);
  }

  /** After trade-in intake: collect due payment and/or record store payout treasury. */
  private continueExchangeCheckout(): void {
    const amountDue = this.exchangeAmountDue();

    if (!this.isClientInfoOpen) {
      if (amountDue > 0.01) {
        this.openPaymentSplitsDialog(true);
        return;
      }
      this.performCheckout(this.buildDefaultCashPayment());
      return;
    }

    this.clientForm.markAllAsTouched();
    if (!this.clientForm.valid) {
      this.translate.get('tr_invalid_cashier_client').subscribe((msg) =>
        this.appNotificationService.push(msg, 'error')
      );
      return;
    }

    if (amountDue <= 0.01) {
      this.performCheckout(this.buildDefaultCashPayment());
      return;
    }

    if (this.hasValidConfirmedPayment() && this.confirmedPayment) {
      this.performCheckout(this.confirmedPayment);
      return;
    }

    this.openPaymentSplitsDialog(true);
  }

  private openExchangeSettlementTreasuryDialog(
    amount: number,
    onConfirmed: () => void
  ): void {
    const selectedBranchId = canPickBranchRole(this.curentUser?.role)
      ? this.adminSelectedBranchId
      : this.globals.currentUser?.branch?._id;

    if (!selectedBranchId) {
      this.translate.get('tr_branch_required').subscribe((msg) => this.appNotificationService.push(msg, 'error'));
      return;
    }

    const af = this.exchangeTradeInPurchase?.productPayload?.acquiredFrom;
    const partyType = String(af?.partyType || 'client').toLowerCase();
    const partyTypeKey =
      partyType === 'supplier' ? 'tr_supplier_info' : 'tr_client_info';

    const ref = this.dialog.open(DeskPurchaseDeferredPaymentDialogComponent, {
      width: '520px',
      maxWidth: '95vw',
      panelClass: 'payment-splits-dialog-panel',
      data: {
        exchangeSettlementOnly: true,
        remaining: amount,
        productName: this.exchangeTradeInPurchase?.productPayload?.name || '',
        partyName: String(af?.displayName || af?.name || '').trim(),
        partyTypeLabel: this.translate.instant(partyTypeKey),
        forcedBranchId: String(selectedBranchId),
      },
      disableClose: true,
    });

    ref.afterClosed().subscribe((res) => {
      if (!res || typeof res !== 'object' || !('paymentTreasurySplits' in res)) {
        return;
      }
      this.pendingExchangeSettlement = res as ExchangeSettlementTreasuryResult;
      onConfirmed();
    });
  }

  /** Walk-in checkout when client-info card is collapsed: full amount as cash, no dialog. */
  private buildDefaultCashPayment(): PaymentSplitsResult {
    const total = this.effectiveCheckoutTotal();
    return buildPaymentSplitsResult(
      [{ method: 'cash', amount: total }],
      [],
      this.storeSettings.snapshot.paymentAppFeePercents
    );
  }

  private performCheckout(payment: PaymentSplitsResult): void {
    const selectedBranchId = canPickBranchRole(this.curentUser?.role)
      ? this.adminSelectedBranchId
      : this.globals.currentUser.branch._id;

    const clientDetails = this.resolveCheckoutClientDetails();

    const paymentSplits = payment.paymentSplits.map((s) => ({
      method: s.method,
      amount: round2(s.amount),
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
      paymentFeeAllocations: payment.feeAllocations,
      branch: selectedBranchId,
      status: 'completed',
      userId: this.curentUser._id,
      invoiceDiscountAmount: this.appliedInvoiceDiscount(),
    };

    if (this.selectedSellerName) {
      orderData.sellerName = this.selectedSellerName;
    }

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

    const bookingAllocations = this.bookingDepositAllocations();
    const bookingCredit = round2(
      bookingAllocations.reduce((s, a) => s + a.creditApplied, 0)
    );
    if (bookingCredit > 0 && bookingAllocations.length) {
      orderData.bookingDepositCreditAmount = bookingCredit;
      orderData.bookingDepositAllocations = bookingAllocations;
    }

    const settlement = this.pendingExchangeSettlement;
    if (settlement?.paymentTreasurySplits?.length) {
      orderData.exchangeSettlementTreasurySplits = settlement.paymentTreasurySplits.map(
        (s: PurchaseTreasurySplit) => ({
          key: s.key,
          label: s.label,
          amount: round2(s.amount),
        })
      );
    }
    this.pendingExchangeSettlement = null;

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
        bookingDepositCreditAmount:
          Number(base?.bookingDepositCreditAmount) > 0
            ? Number(base.bookingDepositCreditAmount)
            : bookingCredit,
      };

      this.pendingExchangePurchaseReceipt =
        exchangeCredit > 0 && pendingPurchaseReceipt ? pendingPurchaseReceipt : null;

      this.clearClientActiveBookings();
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
      this.runCashierPrint();

      this.orderItems = [];
      this.cancelEditLinePrice();
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
            this.runCashierPrint();
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

  /** Isolates cashier invoice from booking / order reprint hosts. */
  private runCashierPrint(): void {
    this.bookingReprint.clearPending();
    this.invoiceReprint.clearPending();
    if (typeof document === 'undefined') {
      window.print();
      return;
    }
    document.body.setAttribute('data-receipt-print', 'cashier');
    const clearFlag = () => {
      if (document.body.getAttribute('data-receipt-print') === 'cashier') {
        document.body.removeAttribute('data-receipt-print');
      }
      window.removeEventListener('afterprint', clearFlag);
    };
    window.addEventListener('afterprint', clearFlag);
    window.print();
    // Fallback if afterprint never fires (some browsers / cancelled dialogs)
    setTimeout(clearFlag, 60000);
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

  receiptPaidPayments(): Array<{ method?: string; amount: number; feeForMethod?: string }> {
    const list = this.createdOrder?.payments;
    if (!Array.isArray(list)) {
      return [];
    }
    return list.filter(
      (p: any) => Number(p?.amount) > 0 && p?.countsTowardInvoice !== false && !p?.feeForMethod
    );
  }

  receiptFeePayments(): Array<{ method?: string; amount: number; feeForMethod?: string }> {
    const list = this.createdOrder?.payments;
    if (!Array.isArray(list)) {
      return [];
    }
    return list.filter((p: any) => Number(p?.amount) > 0 && p?.feeForMethod);
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
