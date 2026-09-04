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
import { Observable, of, Subject, Subscription } from 'rxjs';
import { debounceTime, switchMap, catchError, takeUntil, distinctUntilChanged, tap, map } from 'rxjs/operators';
import { Globals } from '@core/globals';
import {
  buildCashierPaymentMethods,
  CashierPaymentMethod,
  paymentMethodDisplayLabel,
} from '@shared/utils/cashier-payment-methods.util';
import {
  findProductByScannedCode,
  findUniqueProductByName,
  productMatchesSearchTerm,
} from '@shared/utils/product-code-match.util';
import {
  parseScaleBarcode,
  scaleBarcodeLookupCodes,
} from '@shared/utils/scale-barcode.util';
import { Branch, Product } from '@core/models/products.model';
import { User } from '@core/models/users-interfaces.model';
import { AuthenticationService } from '@core/services/authentication.service';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { BranchesServce } from '@shared/services/branches.service';
import { OrdersSerivce } from '@shared/services/orders.service';
import { VendorsSerivce } from '@shared/services/vendors.service';
import { CollectionsService } from '@shared/services/collections.service';
import { OrderPartyType } from '@core/models/products.model';
import { ProductsSerivce } from '@shared/services/products.service';
import { StoreSettingsService } from '@shared/services/store-settings.service';
import {
  formatWeightQuantity,
  isWeightSaleUnit,
  normalizeWeightQuantity,
  resolveSellByWeight,
  roundWeight,
} from '@shared/utils/sale-quantity.util';
import { canPickBranchRole } from '@core/utils/role-utils';
import {
  isInstallmentSale as orderIsInstallmentSale,
  isPayLaterMethod,
  isPayLaterSettled,
  orderDisplayPaid,
  orderDisplayRemaining,
  orderInstallmentMonthlyAmount,
  orderInstallmentMonths,
  orderInstallmentPlanName,
} from '@core/utils/order-display.util';
import { MatDialog } from '@angular/material/dialog';
import { CreateEditProductComponent } from '../../products/create-edit-product/create-edit-product.component';
import {
  PurchaseQuantityDialogComponent,
} from '../../products/purchase-quantity-dialog/purchase-quantity-dialog.component';
import {
  ProductDetailsDialogComponent,
} from '../../products/product-details-dialog/product-details-dialog.component';
import {
  DeskPurchaseDeferredPaymentDialogComponent,
  ExchangeSettlementTreasuryResult,
} from '../../orders/desk-purchase-deferred-payment-dialog/desk-purchase-deferred-payment-dialog.component';
import {
  ProductPurchaseRequestsService,
  PurchaseTreasurySplit,
} from '@shared/services/product-purchase-requests.service';
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
import { IsolatedReceiptPrintHandle, printIsolatedReceipt } from '@shared/utils/isolated-receipt-print';

@Component({
  selector: 'app-cashier-order',
  templateUrl: './cashier.component.html',
  styleUrls: ['./cashier.component.scss']
})
export class CashierComponent implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild('barcodeInput') barcodeInput!: ElementRef;

  products: Product[] = [];
  /** Infinite-scroll product list (first page + append on scroll). */
  readonly productsPageSize = 20;
  productsLoading = false;
  productsHasMore = true;
  private productsPage = 1;
  private productsLoadToken = 0;
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
  branchDeliveryStaff: string[] = [];
  selectedSellerName: string | null = null;
  sellerFieldTouched = false;
  isDeliveryOrder = false;
  selectedDeliveryPersonName: string | null = null;
  checkoutInProgress = false;

  /** Seller is required only when client info panel is expanded. */
  get sellerNameRequired(): boolean {
    return this.isClientInfoOpen && this.branchSalespeople.length > 0;
  }

  get deliveryOrdersEnabled(): boolean {
    return Boolean(this.storeSettings.snapshot.deliveryOrdersEnabled);
  }

  /** Cash left in drawer from the last close (opening balance for today). */
  drawerOpeningBalance = 0;
  drawerPeriodAlreadyClosed = false;
  drawerReopening = false;

  /** Desk product purchase (inventory intake); receipt print uses shared component. */
  createdDeskPurchase: any = null;
  printMode: 'sale' | 'deskPurchase' = 'sale';

  /** Exchange: one trade-in purchase invoice (may contain multiple product lines). */
  exchangeTradeInPurchase: any = null;
  /** After sale receipt print, print the single trade-in purchase receipt. */
  private pendingExchangePurchaseReceipt: any = null;
  /** Store pays customer/supplier the exchange difference — treasury chosen at checkout. */
  private pendingExchangeSettlement: ExchangeSettlementTreasuryResult | null = null;
  private cashierPrintHandle: IsolatedReceiptPrintHandle | null = null;
  private cashierPrintClearTimer: ReturnType<typeof setTimeout> | null = null;

  // Client / supplier information section
  isClientInfoOpen = true;
  clientForm: FormGroup;
  partyType: OrderPartyType = 'client';
  isExistingClient = false;
  isExistingVendor = false;
  selectedClientId: string | null = null;
  selectedVendorId: string | null = null;
  supplierCompanyName = '';
  /** Searchable supplier picker (company / contact / phone). */
  vendorSearchItems: any[] = [];
  selectedVendor: any = null;
  vendorsLoading = false;
  readonly vendorTypeahead$ = new Subject<string>();
  /** Avoid repeating the same “registered” toast for the same lookup. */
  private lastNotifiedPartyId: string | null = null;

  /** Active product bookings for the current client (deposit credit at checkout). */
  clientActiveBookings: CheckoutActiveBooking[] = [];
  private clientBookingsLoadToken = 0;
  /** Confirmed reservations by product id (red cart-line warning). */
  productReservationsById: Record<string, CheckoutActiveBooking[]> = {};
  private productReservationLoadTokens = new Map<string, number>();
  /** Avoid repeating the same red reservation toast for a SKU in this cart session. */
  private foreignBookingToastShown = new Set<string>();
  private listedOnlineToastShown = new Set<string>();
  private readonly destroy$ = new Subject<void>();

  /** Built from store settings; refreshed on settings$ updates (receipt labels). */
  paymentMethods: CashierPaymentMethod[] = [];

  private settingsSub?: Subscription;
  /** Debounce barcode scanner input so product adds without pressing Enter. */
  private barcodeScanTimer: ReturnType<typeof setTimeout> | null = null;
  /** Weight from a scale label when the PLU is not in Invex yet — applied on the next add. */
  private pendingScaleWeightKg: number | null = null;

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
    private productPurchaseRequests: ProductPurchaseRequestsService,
    private collectionsService: CollectionsService,
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
    this.initVendorTypeahead();
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
    this.disposeCashierPrint();
  }

  private rebuildPaymentMethods(): void {
    this.paymentMethods = buildCashierPaymentMethods(
      this.storeSettings.snapshot.paymentAppFeePercents,
      this.translate,
      this.storeSettings.snapshot.paymentMethodsCatalog
    );
    this.cdr.markForCheck();
  }

  hasValidConfirmedPayment(): boolean {
    if (this.isCheckoutFullyPrepaid()) {
      return true;
    }
    if (!this.confirmedPayment || this.confirmedPaymentForTotal == null) {
      return false;
    }
    return Math.abs(this.confirmedPaymentForTotal - this.effectiveCheckoutTotal()) < 0.01;
  }

  /** Sale remaining after trade-in / booking deposit is zero — no payment methods needed. */
  isCheckoutFullyPrepaid(): boolean {
    return this.effectiveCheckoutTotal() <= 0.01;
  }

  paymentSummaryText(): string {
    if (this.isCheckoutFullyPrepaid()) {
      const deposit = this.bookingDepositCredit();
      if (deposit > 0) {
        return this.translate.instant('tr_cashier_booking_fully_paid', {
          deposit: deposit.toFixed(2),
        });
      }
      return this.translate.instant('tr_cashier_amount_due_after_credits') + ': 0';
    }
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
    if (this.isDeliveryOrder) {
      parts.push(this.translate.instant('tr_cashier_delivery_preview'));
      if (this.selectedDeliveryPersonName) {
        parts.push(this.selectedDeliveryPersonName);
      }
    }
    return parts.join(' · ');
  }

  openPaymentSplitsDialog(autoCheckout = false): void {
    if (this.isCheckoutFullyPrepaid()) {
      const prepaid = this.buildDefaultCashPayment();
      this.confirmedPayment = prepaid;
      this.confirmedPaymentForTotal = this.effectiveCheckoutTotal();
      if (autoCheckout) {
        this.performCheckout(prepaid);
      }
      return;
    }

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

  /**
   * Keep cashier-confirmed payment methods when client phone lookup / bookings refresh.
   * Only wipe or rescale when the amount due actually changes (e.g. booking deposit credit).
   */
  private reconcileConfirmedPaymentWithCheckoutTotal(): void {
    if (!this.confirmedPayment || this.confirmedPaymentForTotal == null) {
      return;
    }
    const total = this.effectiveCheckoutTotal();
    if (Math.abs(this.confirmedPaymentForTotal - total) < 0.01) {
      return;
    }

    const splits = (this.confirmedPayment.paymentSplits || []).filter(
      (s) => (Number(s.amount) || 0) > 0 && String(s.method || '').trim()
    );
    const single = splits.length === 1 ? splits[0] : null;
    const method = String(single?.method || '')
      .trim()
      .toLowerCase();

    // Single non-credit method: keep Instapay/visa/… and update the amount.
    if (single && method && method !== 'credit') {
      const feeSources = (this.confirmedPayment.feeAllocations || []).map((f) => ({
        forMethod: f.forMethod,
        paidVia: f.paidVia === f.forMethod ? 'same' : f.paidVia,
      }));
      this.confirmedPayment = buildPaymentSplitsResult(
        [{ method, amount: total }],
        feeSources,
        this.storeSettings.snapshot.paymentAppFeePercents
      );
      this.confirmedPaymentForTotal = total;
      return;
    }

    // Multi-split / credit: amounts are no longer valid — cashier must reconfirm.
    this.invalidateConfirmedPayment();
  }

  startExchangeFlow(): void {
    this.openDeskPurchaseProductDialog({ mode: 'exchange' });
  }

  cancelExchangeFlow(): void {
    const purchaseId = this.exchangeTradeInPurchase?._id
      ? String(this.exchangeTradeInPurchase._id)
      : '';
    const userId = this.curentUser?._id ? String(this.curentUser._id) : '';

    const clearLocal = () => {
      this.exchangeTradeInPurchase = null;
      this.pendingExchangeSettlement = null;
      this.refreshExchangePaymentDefaults();
      this.translate.get('tr_exchange_cancelled').subscribe((msg) => this.appNotificationService.push(msg, 'success'));
    };

    if (!purchaseId || !userId) {
      clearLocal();
      return;
    }

    this.productPurchaseRequests
      .reject(purchaseId, {
        userId,
        resolutionNote: 'Cancelled at cashier before checkout',
      })
      .subscribe({
        next: () => clearLocal(),
        error: () => {
          // Still clear the desk; draft may already be rejected or legacy-approved.
          clearLocal();
        },
      });
  }

  hasExchangeTradeIn(): boolean {
    return !!this.exchangeTradeInPurchase;
  }

  /** All product lines on the current exchange purchase invoice. */
  exchangeTradeInLines(): Array<{ productPayload: any; quantity: number }> {
    const p = this.exchangeTradeInPurchase;
    if (!p) return [];
    if (Array.isArray(p.lines) && p.lines.length) {
      return p.lines
        .map((l: any) => ({
          productPayload: l?.productPayload,
          quantity: Math.max(1, Math.floor(Number(l?.quantity) || 1)),
        }))
        .filter((l: any) => l.productPayload);
    }
    if (!p.productPayload) return [];
    return [
      {
        productPayload: p.productPayload,
        quantity: Math.max(1, Math.floor(Number(p.quantity) || 1)),
      },
    ];
  }

  tradeInLineCredit(line: { productPayload?: any; quantity?: number }): number {
    const q = Math.max(1, Math.floor(Number(line?.quantity) || 1));
    const net = Number(line?.productPayload?.netPrice);
    if (!Number.isFinite(net) || net < 0) return 0;
    return Math.round(net * q * 100) / 100;
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

  /** Desk product purchase (inventory intake); receipt print uses shared component. */
  openPurchaseQuantityDialog(): void {
    const selectedBranchId = this.resolveCashierBranchId();
    if (!selectedBranchId) {
      this.translate.get('tr_branch_required').subscribe((msg) => this.appNotificationService.push(msg, 'error'));
      return;
    }

    const branchLabel =
      canPickBranchRole(this.curentUser?.role)
        ? this.branches.find((b) => String(b._id) === String(selectedBranchId))?.name || ''
        : String(this.globals.currentUser?.branch?.name || '');

    const ref = this.dialog.open(PurchaseQuantityDialogComponent, {
      width: '780px',
      maxWidth: '96vw',
      data: {
        cashierMode: true,
        forcedBranchId: String(selectedBranchId),
        forcedBranchLabel: branchLabel,
      },
    });

    ref.afterClosed().subscribe((res: any) => {
      if (!res?.ok) return;
      if (res.purchase) {
        this.createdDeskPurchase = res.purchase;
        this.printMode = 'deskPurchase';
        this.printDeskPurchaseReceipt();
      }
      this.loadProducts();
    });
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
    const appendToId =
      isExchange && this.exchangeTradeInPurchase?._id
        ? String(this.exchangeTradeInPurchase._id)
        : '';

    const ref = this.dialog.open(CreateEditProductComponent, {
      width: '850px',
      data: {
        isEdit: false,
        cashDeskPurchase: true,
        forcedBranchId: String(selectedBranchId),
        exchangeFlow: isExchange,
        ...(appendToId ? { appendToExchangePurchaseId: appendToId } : {}),
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
        // Trade-in stock is deferred until Pay — no product grid refresh needed yet.
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
    return Math.round(
      this.exchangeTradeInLines().reduce((sum, line) => sum + this.tradeInLineCredit(line), 0) * 100
    ) / 100;
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
    if (this.hasExchangeTradeIn()) {
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
      this.hasExchangeTradeIn()
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
      this.reconcileConfirmedPaymentWithCheckoutTotal();
      return;
    }
    const phone = String(this.clientForm?.get('phone')?.value || '').trim();
    const clientId = this.selectedClientId || '';
    if (!phone && !clientId) {
      this.clientActiveBookings = [];
      this.reconcileConfirmedPaymentWithCheckoutTotal();
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
          this.reconcileConfirmedPaymentWithCheckoutTotal();
          this.notifyMatchedBookingDeposit();
        },
        error: () => {
          if (token !== this.clientBookingsLoadToken) return;
          this.clientActiveBookings = [];
          this.reconcileConfirmedPaymentWithCheckoutTotal();
        },
      });
  }

  /** Toast when the entered phone matches a booking with deposit on cart lines. */
  private lastNotifiedDepositCredit = -1;
  private notifyMatchedBookingDeposit(): void {
    const credit = this.bookingDepositCredit();
    if (credit <= 0) {
      this.lastNotifiedDepositCredit = -1;
      return;
    }
    if (Math.abs(credit - this.lastNotifiedDepositCredit) < 0.01) return;
    this.lastNotifiedDepositCredit = credit;
    const remaining = this.effectiveCheckoutTotal();
    if (remaining <= 0.009) {
      this.translate
        .get('tr_cashier_booking_fully_paid', {
          deposit: credit.toFixed(2),
        })
        .subscribe((msg) => this.appNotificationService.push(msg, 'success'));
    } else {
      this.translate
        .get('tr_cashier_booking_deposit_matched', {
          deposit: credit.toFixed(2),
          remaining: remaining.toFixed(2),
        })
        .subscribe((msg) => this.appNotificationService.push(msg, 'success'));
    }
  }

  private clearClientActiveBookings(): void {
    this.clientBookingsLoadToken++;
    this.clientActiveBookings = [];
    this.reconcileConfirmedPaymentWithCheckoutTotal();
  }

  private orderLineProductId(item: any): string {
    return String(item?.productId || item?._id || '').trim();
  }

  private phoneLast10(phone: string | undefined | null): string {
    return String(phone || '').replace(/\D/g, '').slice(-10);
  }

  private phonesMatch(a: string | undefined | null, b: string | undefined | null): boolean {
    const da = this.phoneLast10(a);
    const db = this.phoneLast10(b);
    return da.length >= 10 && db.length >= 10 && da === db;
  }

  isBookingMatchedToCurrentClient(b: CheckoutActiveBooking): boolean {
    if (this.partyType !== 'client' || !b) return false;
    const phone = String(this.clientForm?.get('phone')?.value || '').trim();
    if (phone && this.phonesMatch(phone, b.customerPhone)) return true;
    if (
      this.selectedClientId &&
      b.clientId &&
      String(this.selectedClientId) === String(b.clientId)
    ) {
      return true;
    }
    return false;
  }

  /** Load reservation holders for a SKU (red warning details). */
  ensureProductReservationsLoaded(product: Product | any, opts?: { toast?: boolean }): void {
    const productId = this.orderLineProductId(product);
    if (!productId || !this.hasActiveBookingSignal(product)) return;
    if (Object.prototype.hasOwnProperty.call(this.productReservationsById, productId)) {
      if (opts?.toast) {
        this.pushForeignBookingWarningToast(productId);
      }
      return;
    }
    const token = (this.productReservationLoadTokens.get(productId) || 0) + 1;
    this.productReservationLoadTokens.set(productId, token);
    this.productBookings
      .getActiveReservationsForProduct(productId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          if (this.productReservationLoadTokens.get(productId) !== token) return;
          this.productReservationsById = {
            ...this.productReservationsById,
            [productId]: Array.isArray(res?.bookings) ? res.bookings : [],
          };
          if (opts?.toast) {
            this.pushForeignBookingWarningToast(productId);
          }
        },
        error: () => {
          if (this.productReservationLoadTokens.get(productId) !== token) return;
          this.productReservationsById = {
            ...this.productReservationsById,
            [productId]: [],
          };
        },
      });
  }

  reservationsForProduct(productId: string): CheckoutActiveBooking[] {
    return this.productReservationsById[productId] || [];
  }

  foreignReservationsForProduct(productId: string): CheckoutActiveBooking[] {
    return this.reservationsForProduct(productId).filter(
      (b) => !this.isBookingMatchedToCurrentClient(b)
    );
  }

  matchedReservationsForProduct(productId: string): CheckoutActiveBooking[] {
    return this.reservationsForProduct(productId).filter((b) =>
      this.isBookingMatchedToCurrentClient(b)
    );
  }

  bookingDaysAgo(b: CheckoutActiveBooking): number {
    const raw = b?.bookingDate || b?.createdAt;
    if (!raw) return 0;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return 0;
    return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
  }

  /** Persistent red line warning when cart item is reserved for someone else. */
  lineShowsForeignBookingWarning(item: any): boolean {
    const pid = this.orderLineProductId(item);
    if (!pid) return false;
    const loaded = Object.prototype.hasOwnProperty.call(this.productReservationsById, pid);
    if (loaded) {
      return this.foreignReservationsForProduct(pid).length > 0;
    }
    if (!this.hasActiveBookingSignal(item)) return false;
    const matchedViaCheckout = (this.clientActiveBookings || []).some(
      (b) => String(b.productId) === pid && this.isBookingMatchedToCurrentClient(b)
    );
    // If this client already matches a booking, suppress the generic red until holders load.
    return !matchedViaCheckout;
  }

  lineForeignBookingWarningParams(item: any): {
    name: string;
    phone: string;
    days: number;
    fromWebsite: boolean;
  } | null {
    const pid = this.orderLineProductId(item);
    const foreign = this.foreignReservationsForProduct(pid);
    const b = foreign[0];
    if (!b) return null;
    return {
      name: String(b.customerName || '').trim() || '—',
      phone: String(b.customerPhone || '').trim() || '—',
      days: this.bookingDaysAgo(b),
      fromWebsite: b.source === 'ecommerce',
    };
  }

  /** Bars above the cart table: reserved items (not for the current client). */
  cartForeignBookingBars(): Array<{
    productId: string;
    productName: string;
    name: string;
    phone: string;
    days: number;
    fromWebsite: boolean;
  }> {
    const bars: Array<{
      productId: string;
      productName: string;
      name: string;
      phone: string;
      days: number;
      fromWebsite: boolean;
    }> = [];
    const seen = new Set<string>();
    for (const item of this.orderItems || []) {
      if (!this.lineShowsForeignBookingWarning(item)) continue;
      const productId = this.orderLineProductId(item);
      if (!productId || seen.has(productId)) continue;
      seen.add(productId);
      const wp = this.lineForeignBookingWarningParams(item);
      bars.push({
        productId,
        productName: String(item?.name || '').trim() || '—',
        name: wp?.name || '—',
        phone: wp?.phone || '—',
        days: wp?.days ?? 0,
        fromWebsite: !!wp?.fromWebsite,
      });
    }
    return bars;
  }

  /** Bars above the cart table: deposit matched to current client. */
  cartMatchedDepositBars(): Array<{
    productId: string;
    productName: string;
    deposit: number;
    remaining: number;
    fullyPaid: boolean;
  }> {
    const bars: Array<{
      productId: string;
      productName: string;
      deposit: number;
      remaining: number;
      fullyPaid: boolean;
    }> = [];
    const seen = new Set<string>();
    for (const item of this.orderItems || []) {
      if (!this.lineShowsMatchedDepositInfo(item)) continue;
      const productId = this.orderLineProductId(item);
      if (!productId || seen.has(productId)) continue;
      seen.add(productId);
      bars.push({
        productId,
        productName: String(item?.name || '').trim() || '—',
        deposit: this.lineMatchedDepositDisplayAmount(item),
        remaining: this.lineRemainingAfterMatchedDeposit(item),
        fullyPaid: this.lineFullyPaidByDeposit(item),
      });
    }
    return bars;
  }

  /** Green deposit info when the checkout client holds the reservation on this line. */
  lineShowsMatchedDepositInfo(item: any): boolean {
    const pid = this.orderLineProductId(item);
    if (!pid) return false;
    if (this.matchedReservationsForProduct(pid).length > 0) return true;
    return (this.clientActiveBookings || []).some(
      (b) => String(b.productId) === pid && (Number(b.depositAmount) || 0) > 0
    );
  }

  lineMatchedDepositCredit(item: any): number {
    const pid = this.orderLineProductId(item);
    return this.bookingDepositAllocations()
      .filter((a) => {
        const b =
          this.clientActiveBookings.find((x) => String(x._id) === String(a.bookingId)) ||
          this.reservationsForProduct(pid).find((x) => String(x._id) === String(a.bookingId));
        return b && String(b.productId) === pid;
      })
      .reduce((s, a) => s + (Number(a.creditApplied) || 0), 0);
  }

  lineRemainingAfterMatchedDeposit(item: any): number {
    const qty = Math.max(0, Math.floor(Number(item?.quantity) || 0));
    const lineTotal = Math.round(this.lineUnitPrice(item) * qty * 100) / 100;
    const credit = this.lineMatchedDepositCredit(item);
    // If allocations not yet computed but matched bookings exist, estimate from booking deposits.
    if (credit <= 0) {
      const pid = this.orderLineProductId(item);
      const matched =
        this.matchedReservationsForProduct(pid).length > 0
          ? this.matchedReservationsForProduct(pid)
          : (this.clientActiveBookings || []).filter((b) => String(b.productId) === pid);
      let est = 0;
      let need = qty;
      for (const b of matched) {
        if (need <= 0) break;
        const bq = Math.max(1, Math.floor(Number(b.quantity) || 1));
        const take = Math.min(need, bq);
        const dep = Math.round((Number(b.depositAmount) || 0) * 100) / 100;
        est += Math.round((dep * (take / bq)) * 100) / 100;
        need -= take;
      }
      return Math.max(0, Math.round((lineTotal - Math.min(est, lineTotal)) * 100) / 100);
    }
    return Math.max(0, Math.round((lineTotal - credit) * 100) / 100);
  }

  lineFullyPaidByDeposit(item: any): boolean {
    if (!this.lineShowsMatchedDepositInfo(item)) return false;
    return this.lineRemainingAfterMatchedDeposit(item) <= 0.009;
  }

  /** Deposit amount shown on the matched green line (allocated or estimated). */
  lineMatchedDepositDisplayAmount(item: any): number {
    const credit = this.lineMatchedDepositCredit(item);
    if (credit > 0) return Math.round(credit * 100) / 100;
    const qty = Math.max(0, Math.floor(Number(item?.quantity) || 0));
    const lineTotal = Math.round(this.lineUnitPrice(item) * qty * 100) / 100;
    const remaining = this.lineRemainingAfterMatchedDeposit(item);
    return Math.max(0, Math.round((lineTotal - remaining) * 100) / 100);
  }

  private pushForeignBookingWarningToast(productId: string): void {
    const foreign = this.foreignReservationsForProduct(productId);
    if (!foreign.length) return;
    if (this.foreignBookingToastShown.has(productId)) return;
    this.foreignBookingToastShown.add(productId);
    const b = foreign[0];
    const days = this.bookingDaysAgo(b);
    const fromWebsite = b.source === 'ecommerce';
    const key =
      days <= 0
        ? fromWebsite
          ? 'tr_cashier_booked_for_customer_website_today'
          : 'tr_cashier_booked_for_customer_today'
        : fromWebsite
          ? 'tr_cashier_booked_for_customer_website'
          : 'tr_cashier_booked_for_customer';
    this.translate
      .get(key, {
        name: String(b.customerName || '').trim() || '—',
        phone: String(b.customerPhone || '').trim() || '—',
        days,
      })
      .subscribe((msg) => this.appNotificationService.push(msg, 'error'));
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

  isCreditSale(): boolean {
    return isPayLaterMethod(this.createdOrder?.paymentMethod);
  }

  isInstallmentSale(): boolean {
    return orderIsInstallmentSale(this.createdOrder);
  }

  isCreditFullySettled(): boolean {
    return isPayLaterSettled(this.createdOrder);
  }

  receiptCreditPaid(): number {
    return orderDisplayPaid(this.createdOrder);
  }

  receiptCreditRemaining(): number {
    return orderDisplayRemaining(this.createdOrder);
  }

  receiptInstallmentMonths(): number {
    return orderInstallmentMonths(this.createdOrder);
  }

  receiptInstallmentMonthlyAmount(): number {
    return orderInstallmentMonthlyAmount(this.createdOrder);
  }

  receiptInstallmentPlanName(): string {
    return orderInstallmentPlanName(this.createdOrder);
  }

  receiptInstallmentStartDate(): string | Date | null {
    return this.createdOrder?.installmentStartDate || null;
  }

  receiptInstallmentDownPayment(): number {
    return orderDisplayPaid(this.createdOrder);
  }

  receiptInstallmentDiscount(): number {
    const n = Number(this.createdOrder?.installmentDiscountAmount);
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
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
      this.branchDeliveryStaff = [];
      this.selectedSellerName = null;
      this.selectedDeliveryPersonName = null;
      return;
    }

    this.branchesServce.getBranch(id).subscribe({
      next: (branch: any) => {
        this.branchSalespeople = (branch?.salespeople || [])
          .filter((sp: { active?: boolean; name?: string }) => sp.active !== false && String(sp.name || '').trim())
          .map((sp: { name: string }) => String(sp.name).trim());

        this.branchDeliveryStaff = (branch?.deliveryStaff || [])
          .filter((ds: { active?: boolean; name?: string }) => ds.active !== false && String(ds.name || '').trim())
          .map((ds: { name: string }) => String(ds.name).trim());

        if (this.branchSalespeople.length === 1) {
          this.selectedSellerName = this.branchSalespeople[0];
        } else if (
          !this.selectedSellerName ||
          !this.branchSalespeople.includes(this.selectedSellerName)
        ) {
          this.selectedSellerName = null;
        }

        if (
          this.selectedDeliveryPersonName &&
          !this.branchDeliveryStaff.includes(this.selectedDeliveryPersonName)
        ) {
          this.selectedDeliveryPersonName = null;
        }
      },
      error: () => {
        this.branchSalespeople = [];
        this.branchDeliveryStaff = [];
        this.selectedSellerName = null;
        this.selectedDeliveryPersonName = null;
      },
    });
  }

  onDeliveryOrderChange(enabled: boolean): void {
    this.isDeliveryOrder = enabled;
    if (!enabled) {
      this.selectedDeliveryPersonName = null;
    }
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
        takeUntil(this.destroy$),
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
          this.applySelectedCashierVendor(party, true);
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
          this.selectedVendor = null;
          this.supplierCompanyName = '';
          nameControl?.setValue(party.name, { emitEvent: false });
          addressControl?.setValue(party.address, { emitEvent: false });
          nameControl?.disable({ emitEvent: false });
          addressControl?.disable({ emitEvent: false });
          nameControl?.clearValidators();
          addressControl?.clearValidators();
          nameControl?.updateValueAndValidity({ emitEvent: false });
          addressControl?.updateValueAndValidity({ emitEvent: false });
          this.loadClientActiveBookings();
        }
      });
  }

  private initVendorTypeahead(): void {
    this.vendorTypeahead$
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        takeUntil(this.destroy$),
        tap(() => (this.vendorsLoading = true)),
        switchMap((term: string) => {
          const search = String(term || '').trim();
          const params: Record<string, string | number> = { page: 1, limit: 25 };
          if (search) {
            params.search = search;
          }
          return this.vendorsSerivce.getVendors(params).pipe(
            catchError(() => of({ vendors: [] })),
            tap(() => (this.vendorsLoading = false))
          );
        })
      )
      .subscribe((res: any) => {
        const list = Array.isArray(res?.vendors) ? res.vendors : [];
        this.vendorSearchItems = list.map((v: any) => this.withVendorLabel(v));
        if (
          this.selectedVendor?._id &&
          !this.vendorSearchItems.some(
            (v) => String(v._id) === String(this.selectedVendor._id)
          )
        ) {
          this.vendorSearchItems = [
            this.withVendorLabel(this.selectedVendor),
            ...this.vendorSearchItems,
          ];
        }
      });
  }

  onVendorSelectOpen(): void {
    this.vendorTypeahead$.next('');
  }

  private withVendorLabel(vendor: any): any {
    if (!vendor) {
      return vendor;
    }
    const company = String(vendor.nameOfcompany || '').trim();
    const name = String(vendor.name || '').trim();
    const phone = String(vendor.phone || '').trim();
    return {
      ...vendor,
      label: [company, name, phone].filter(Boolean).join(' — '),
    };
  }

  onCashierVendorPicked(vendor: any): void {
    if (!vendor) {
      this.clearSelectedCashierVendor(true);
      return;
    }
    this.applySelectedCashierVendor(vendor, true);
  }

  onCashierVendorIdChange(vendorId: string | null): void {
    if (!vendorId) {
      this.onCashierVendorPicked(null);
      return;
    }
    const found = this.vendorSearchItems.find((v) => String(v._id) === String(vendorId));
    if (found) {
      this.onCashierVendorPicked(found);
      return;
    }
    this.vendorsSerivce.getVendor(String(vendorId)).subscribe({
      next: (v) => this.onCashierVendorPicked(v),
      error: () => this.onCashierVendorPicked(null),
    });
  }

  private applySelectedCashierVendor(vendor: any, notify: boolean): void {
    if (!vendor) {
      return;
    }
    const labeled = this.withVendorLabel(vendor);
    this.selectedVendor = labeled;
    if (
      !this.vendorSearchItems.some((v) => String(v._id) === String(labeled._id))
    ) {
      this.vendorSearchItems = [labeled, ...this.vendorSearchItems];
    }

    const nameControl = this.clientForm.get('name');
    const addressControl = this.clientForm.get('address');
    const phoneControl = this.clientForm.get('phone');

    if (notify) {
      const dedupeKey = labeled._id != null ? String(labeled._id) : String(labeled.phone || '');
      if (dedupeKey && dedupeKey !== this.lastNotifiedPartyId) {
        this.lastNotifiedPartyId = dedupeKey;
        this.translate
          .get('tr_cashier_supplier_registered')
          .subscribe((msg) => this.appNotificationService.push(msg, 'success'));
      }
    }

    this.isExistingVendor = true;
    this.isExistingClient = false;
    this.selectedClientId = null;
    this.selectedVendorId = labeled._id ? String(labeled._id) : null;
    this.supplierCompanyName = labeled.nameOfcompany || '';
    this.clearClientActiveBookings();
    phoneControl?.setValue(labeled.phone || '', { emitEvent: false });
    nameControl?.setValue(labeled.name || '', { emitEvent: false });
    addressControl?.setValue(labeled.address || '', { emitEvent: false });
    nameControl?.disable({ emitEvent: false });
    addressControl?.disable({ emitEvent: false });
    nameControl?.clearValidators();
    addressControl?.clearValidators();
    nameControl?.updateValueAndValidity({ emitEvent: false });
    addressControl?.updateValueAndValidity({ emitEvent: false });
  }

  private clearSelectedCashierVendor(clearFields: boolean): void {
    const nameControl = this.clientForm.get('name');
    const addressControl = this.clientForm.get('address');
    const phoneControl = this.clientForm.get('phone');
    this.selectedVendor = null;
    this.selectedVendorId = null;
    this.isExistingVendor = false;
    this.supplierCompanyName = '';
    this.lastNotifiedPartyId = null;
    nameControl?.enable({ emitEvent: false });
    addressControl?.enable({ emitEvent: false });
    if (clearFields) {
      phoneControl?.setValue('', { emitEvent: false });
      nameControl?.setValue('', { emitEvent: false });
      addressControl?.setValue('', { emitEvent: false });
      nameControl?.setValidators([Validators.required]);
      addressControl?.setValidators([Validators.required]);
      nameControl?.updateValueAndValidity({ emitEvent: false });
      addressControl?.updateValueAndValidity({ emitEvent: false });
    }
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
    this.selectedVendor = null;
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
    this.selectedVendor = null;
    this.vendorSearchItems = [];
    const phone = String(this.clientForm.get('phone')?.value || '').trim();
    const nameControl = this.clientForm.get('name');
    const addressControl = this.clientForm.get('address');
    this.clearPartyLookupState(nameControl, addressControl, !!phone);
    this.clearClientActiveBookings();
    if (type === 'supplier') {
      this.clientForm.patchValue({ phone: '', name: '', address: '' }, { emitEvent: false });
      this.clientForm.get('phone')?.enable({ emitEvent: false });
    } else if (phone) {
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
      this.sellerFieldTouched = false;
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
    this.selectedVendor = null;
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
    this.resetDeliveryAfterCheckout();
  }

  private resetDeliveryAfterCheckout(): void {
    this.isDeliveryOrder = false;
    this.selectedDeliveryPersonName = null;
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

  /** Branch / warehouse filters shared by grid pagination and barcode lookup. */
  private buildCashierProductListParams(
    extra: Record<string, string | number | boolean> = {}
  ): Record<string, string | number | boolean> {
    const params: Record<string, string | number | boolean> = {
      inStock: true,
      ...extra,
    };
    const selectedBranchId = canPickBranchRole(this.curentUser?.role)
      ? this.adminSelectedBranchId
      : this.globals.currentUser?.branch?._id;

    if (selectedBranchId) {
      params['branchId'] = selectedBranchId;
    } else {
      params['excludeWarehouse'] = true;
    }
    return params;
  }

  /**
   * Load cashier products in pages of 20.
   * `reset` (default): replace list from page 1 (branch change, checkout refresh).
   * `reset=false`: append next page (infinite scroll).
   */
  loadProducts(reset = true, options?: { refreshDrawer?: boolean }): void {
    if (!reset && (this.productsLoading || !this.productsHasMore)) {
      return;
    }

    if (reset) {
      this.productsPage = 1;
      this.productsHasMore = true;
      this.products = [];
      if (options?.refreshDrawer !== false) {
        this.loadDrawerOpeningBalance();
      }
    }

    const page = this.productsPage;
    const token = ++this.productsLoadToken;
    this.productsLoading = true;

    const params = this.buildCashierProductListParams({
      page,
      limit: this.productsPageSize,
    });

    this.productsSerivce.getProducts(params).subscribe({
      next: (res: any) => {
        if (token !== this.productsLoadToken) {
          return;
        }
        const list = Array.isArray(res?.products) ? res.products : [];
        this.products = reset ? list : [...this.products, ...list];
        const nextPage = res?.meta?.nextPage;
        this.productsHasMore = nextPage != null;
        if (this.productsHasMore) {
          this.productsPage = Number(nextPage);
        }
        this.productsLoading = false;
        this.cdr.markForCheck();
        // If the grid has no scrollbar yet, keep filling until it can scroll or pages end.
        setTimeout(() => this.fillProductsGridIfNeeded(), 0);
      },
      error: () => {
        if (token !== this.productsLoadToken) {
          return;
        }
        this.productsLoading = false;
        this.cdr.markForCheck();
      },
    });
  }

  /** When products don't overflow the grid, scroll never fires — load next page until they do. */
  private fillProductsGridIfNeeded(): void {
    if (this.productsLoading || !this.productsHasMore) {
      return;
    }
    const el = document.querySelector('.cashier .products-grid') as HTMLElement | null;
    if (!el) {
      return;
    }
    if (el.scrollHeight <= el.clientHeight + 4) {
      this.loadProducts(false);
    }
  }

  /** Near bottom of products grid → fetch next page (does not touch search / barcode / branch UI). */
  onProductsScroll(event: Event): void {
    const el = event.target as HTMLElement | null;
    if (!el || this.productsLoading || !this.productsHasMore) {
      return;
    }
    const threshold = 140;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - threshold) {
      this.loadProducts(false);
    }
  }

  filteredProducts() {
    if (!this.searchTerm) {
      return this.products;
    }
    return this.products.filter((p: Product) =>
      productMatchesSearchTerm(p, this.searchTerm)
    );
  }

  /** Resolve a scanned code from loaded pages, or fetch from API if not yet loaded. */
  private resolveProductByScannedCode(code: string): Observable<Product | undefined> {
    const raw = String(code || '').trim();
    const lookupCodes = this.weightSalesEnabled()
      ? scaleBarcodeLookupCodes(raw)
      : [raw].filter(Boolean);
    const allowName = this.inputLooksLikeName(raw);

    for (const lookup of lookupCodes) {
      const local = findProductByScannedCode(this.products, lookup);
      if (local) {
        return of(local);
      }
    }
    if (allowName) {
      const byName = findUniqueProductByName(this.products, raw);
      if (byName) {
        return of(byName);
      }
    }

    const search = allowName ? raw : lookupCodes[0] || raw;
    const params = this.buildCashierProductListParams({
      page: 1,
      limit: 50,
      search,
    });
    delete params.inStock;

    return this.productsSerivce.getProducts(params).pipe(
      map((res: any): Product | undefined => {
        const list = (res?.products || []) as Product[];
        for (const lookup of lookupCodes) {
          const hit = findProductByScannedCode(list, lookup);
          if (hit) return hit;
        }
        if (allowName) {
          return findUniqueProductByName(list, raw);
        }
        return undefined;
      }),
      catchError(() => of(undefined as Product | undefined))
    );
  }

  private inputLooksLikeName(raw: string): boolean {
    const s = String(raw || '').trim();
    if (!s || parseScaleBarcode(s)) return false;
    return /[^\d.\s-]/.test(s);
  }

  /** Confirmed active reservation count on this SKU (unconfirmed bookings do not reduce free sellable). */
  bookedQty(product: Product | any): number {
    const c = product?.confirmedBookedQuantity;
    if (c != null && Number.isFinite(Number(c))) {
      return Math.max(0, Math.floor(Number(c)));
    }
    return 0;
  }

  /** Any active booking on the SKU (confirmed or pending) — drives cashier red warning. */
  hasActiveBookingSignal(product: Product | any): boolean {
    const all = product?.bookedQuantity;
    if (all != null && Number.isFinite(Number(all)) && Number(all) > 0) {
      return true;
    }
    return this.bookedQty(product) > 0;
  }

  /** Units sellable without touching reserved quantity. */
  freeSellableQty(product: Product | any): number {
    const stock = this.displayStock(product);
    if (this.isWeightProduct(product)) {
      return Math.max(0, roundWeight(stock) - this.bookedQty(product));
    }
    return Math.max(0, Math.floor(stock) - this.bookedQty(product));
  }

  cutFromSourceEnabled(): boolean {
    return !!this.storeSettings.snapshot.cutFromSourceEnabled;
  }

  sourceStockProduct(product: Product | any): { stock?: number; name?: string } | null {
    if (!this.cutFromSourceEnabled()) return null;
    const populated = product?.sourceProduct;
    if (populated && typeof populated === 'object') return populated;
    const sid = product?.sourceProductId;
    if (sid && typeof sid === 'object') return sid;
    return null;
  }

  displayStock(product: Product | any): number {
    const src = this.sourceStockProduct(product);
    if (src && src.stock != null) {
      return Math.max(0, Number(src.stock) || 0);
    }
    if (this.isWeightProduct(product)) {
      return Math.max(0, roundWeight(Number(product?.stock ?? 0)));
    }
    return Math.max(0, Number(product?.stock ?? 0));
  }

  weightSalesEnabled(): boolean {
    return !!this.storeSettings.snapshot.weightSalesEnabled;
  }

  cashierPurchaseExchangeEnabled(): boolean {
    return this.storeSettings.snapshot.cashierPurchaseExchangeEnabled !== false;
  }

  isWeightProduct(product: any): boolean {
    return resolveSellByWeight({
      weightSalesEnabled: this.weightSalesEnabled(),
      category: product?.category,
      product,
    });
  }

  isWeightLine(item: any): boolean {
    if (isWeightSaleUnit(item?.saleUnit)) return true;
    return this.isWeightProduct(item);
  }

  resolveWeightUnit(product: any): 'kg' | 'g' {
    const cat = product?.category;
    if (product?.weightUnit === 'g' || product?.weightUnit === 'kg') {
      return product.weightUnit;
    }
    return cat?.weightUnit === 'g' ? 'g' : 'kg';
  }

  formatLineQuantity(item: any): string {
    if (!this.isWeightLine(item)) {
      return String(Math.max(1, Math.floor(Number(item?.quantity) || 0)));
    }
    return formatWeightQuantity(Number(item?.quantity) || 0, this.resolveWeightUnit(item));
  }

  /** Text draft while typing decimals — `type="number"` drops "." and turns 2.7 into 27. */
  getWeightQtyInput(item: any): string {
    if (item?._weightQtyDraft != null) {
      return item._weightQtyDraft;
    }
    const q = Number(item?.quantity);
    if (!Number.isFinite(q) || q <= 0) {
      return '';
    }
    return String(q);
  }

  onWeightQtyInput(item: any, raw: string): void {
    if (!item) return;
    let cleaned = String(raw ?? '').replace(/[^\d.]/g, '');
    const dotIdx = cleaned.indexOf('.');
    if (dotIdx >= 0) {
      cleaned =
        cleaned.slice(0, dotIdx + 1) + cleaned.slice(dotIdx + 1).replace(/\./g, '');
    }
    item._weightQtyDraft = cleaned;
    if (cleaned === '' || cleaned === '.') {
      item.quantity = 0;
      this.refreshExchangePaymentDefaults();
      this.notifyMatchedBookingDeposit();
      return;
    }
    const parsed = parseFloat(cleaned);
    if (Number.isFinite(parsed)) {
      item.quantity = parsed;
    }
    this.refreshExchangePaymentDefaults();
    this.notifyMatchedBookingDeposit();
  }

  commitWeightQty(i: number): void {
    const item = this.orderItems[i];
    if (!item || !this.isWeightLine(item)) return;
    const raw = item._weightQtyDraft ?? String(item.quantity ?? '');
    delete item._weightQtyDraft;
    const parsed = parseFloat(String(raw).replace(',', '.'));
    item.quantity = normalizeWeightQuantity(Number.isFinite(parsed) ? parsed : 0);
    item.saleUnit = 'weight';
    item.weightUnit = this.resolveWeightUnit(item);
    this.refreshExchangePaymentDefaults();
    this.notifyMatchedBookingDeposit();
  }

  brokenProductImageIds = new Set<string>();

  onProductImageError(productId: string): void {
    if (productId) {
      this.brokenProductImageIds.add(String(productId));
    }
  }

  productImageVisible(product: { _id?: string; imageUrl?: string } | null | undefined): boolean {
    return !!product?.imageUrl && !this.brokenProductImageIds.has(String(product?._id));
  }

  private validateOrderItemsForCheckout(): string | null {
    for (const item of this.orderItems) {
      if (this.isWeightLine(item)) {
        const w = normalizeWeightQuantity(item.quantity);
        if (w <= 0) {
          return 'tr_weight_required_for_line';
        }
        const maxStock = this.displayStock(item);
        if (w > maxStock + 0.0001) {
          return 'tr_not_enough_stock';
        }
      }
    }
    return null;
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

  private maybePushBookingWarning(product: Product | any, _newLineQuantity?: number): void {
    if (!this.hasActiveBookingSignal(product)) {
      return;
    }
    this.ensureProductReservationsLoaded(product, { toast: true });
  }

  private maybePushOnlineListingWarning(product: Product | any, lineQuantity: number): void {
    if (!product?.listedOnEcommerce) {
      return;
    }
    const id = String(product?._id || product?.productId || '');
    const stock = Math.max(0, Math.floor(Number(product?.stock ?? 0)));
    const qty = Math.max(1, Math.floor(Number(lineQuantity) || 1));
    const lastUnit = qty >= stock;
    const toastKey = lastUnit ? `${id}:last` : `${id}:listed`;
    if (this.listedOnlineToastShown.has(toastKey)) {
      return;
    }
    this.listedOnlineToastShown.add(toastKey);
    const msgKey = lastUnit
      ? 'tr_cashier_listed_online_last_unit'
      : 'tr_cashier_listed_online_warn';
    this.appNotificationService.push(
      this.translate.instant(msgKey, { name: product?.name || product?.code || '' }),
      lastUnit ? 'error' : 'warning'
    );
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

  addProduct(product: any, opts?: { quantity?: number }) {
    if (this.freeSellableQty(product) <= 0) return;

    if (this.isWeightProduct(product)) {
      const fromLabel = normalizeWeightQuantity(
        Number(opts?.quantity) || this.pendingScaleWeightKg || 0
      );
      this.pendingScaleWeightKg = null;
      const maxStock = this.displayStock(product);
      const quantity =
        fromLabel > 0 ? Math.min(fromLabel, maxStock > 0 ? maxStock : fromLabel) : 0;
      this.orderItems.push({
        ...product,
        quantity,
        productId: product._id,
        saleUnit: 'weight',
        weightUnit: this.resolveWeightUnit(product),
        isApplyDiscount: Number(product?.discount) > 0,
      });
      this.focusBarcodeInput();
      this.refreshExchangePaymentDefaults();
      return;
    }

    this.pendingScaleWeightKg = null;

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
      this.maybePushOnlineListingWarning(item, item.quantity);
      this.refreshExchangePaymentDefaults();
    } else {
      this.maybePushBookingWarning(product, 1);
      this.maybePushOnlineListingWarning(product, 1);
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
    this.notifyMatchedBookingDeposit();
  }

  /**
   * Auto-add when scanner/type finishes (no Enter needed).
   * Scanners dump chars quickly then pause; debounce waits for that pause.
   * Names are typed slowly — wait for Enter.
   */
  onBarcodeInput(): void {
    if (this.barcodeScanTimer != null) {
      clearTimeout(this.barcodeScanTimer);
    }
    const code = (this.barcode || '').trim();
    if (!code) return;
    if (this.inputLooksLikeName(code)) return;

    this.barcodeScanTimer = setTimeout(() => {
      this.barcodeScanTimer = null;
      this.resolveProductByScannedCode(code)
        .pipe(takeUntil(this.destroy$))
        .subscribe((product) => {
          if ((this.barcode || '').trim() !== code) {
            return;
          }
          this.finishScanLookup(code, product);
        });
    }, 180);
  }

  /** Weight from a scale label only; sale price always comes from Invex. */
  private scaleScanQuantity(scanned: string, product: Product | any): { quantity?: number } | undefined {
    if (!this.weightSalesEnabled() || !this.isWeightProduct(product)) return undefined;
    const parsed = parseScaleBarcode(scanned);
    if (!parsed || parsed.weightKg <= 0) return undefined;
    return { quantity: parsed.weightKg };
  }

  private finishScanLookup(scanned: string, product: Product | undefined): void {
    if (product) {
      this.addProduct(product, this.scaleScanQuantity(scanned, product));
      this.barcode = '';
      return;
    }

    const parsed = this.weightSalesEnabled() ? parseScaleBarcode(scanned) : null;
    if (parsed && parsed.weightKg > 0) {
      this.pendingScaleWeightKg = parsed.weightKg;
      this.barcode = '';
      this.appNotificationService.push(
        this.translate.instant('tr_cashier_scale_pick_by_name'),
        'warning'
      );
      this.focusBarcodeInput();
      return;
    }

    if (this.inputLooksLikeName(scanned)) {
      this.appNotificationService.push(
        this.translate.instant('tr_cashier_name_not_unique'),
        'warning'
      );
    }
  }

  scanProduct(code: string) {
    if (this.barcodeScanTimer != null) {
      clearTimeout(this.barcodeScanTimer);
      this.barcodeScanTimer = null;
    }
    const trimmed = String(code || '').trim();
    if (!trimmed) return;
    this.resolveProductByScannedCode(trimmed)
      .pipe(takeUntil(this.destroy$))
      .subscribe((product) => {
        this.finishScanLookup(trimmed, product);
      });
  }

  increaseQty(i: number) {
    const item = this.orderItems[i];
    if (this.isWeightLine(item)) return;
    const maxStock = Math.max(0, Math.floor(Number(item.stock ?? 0)));
    if (item.quantity >= maxStock) {
      this.focusBarcodeInput();
      return;
    }
    item.quantity++;
    this.maybePushBookingWarning(item, item.quantity);
    this.refreshExchangePaymentDefaults();
    this.notifyMatchedBookingDeposit();
    this.focusBarcodeInput();
  }
  decreaseQty(i: number) {
    if (this.isWeightLine(this.orderItems[i])) return;
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
    const removed = this.orderItems[i];
    const pid = this.orderLineProductId(removed);
    this.orderItems.splice(i, 1);
    if (pid && !this.orderItems.some((it) => this.orderLineProductId(it) === pid)) {
      this.foreignBookingToastShown.delete(pid);
    }
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

    if (this.sellerNameRequired && !this.selectedSellerName) {
      this.sellerFieldTouched = true;
      this.appNotificationService.push(
        this.translate.instant('tr_cashier_seller_required'),
        'error'
      );
      return;
    }

    if (this.hasExchangeTradeIn()) {
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

    if (this.isCheckoutFullyPrepaid()) {
      this.performCheckout(this.buildDefaultCashPayment());
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
    if (!this.isClientInfoOpen) {
      if (!this.isCheckoutFullyPrepaid()) {
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

    if (this.isCheckoutFullyPrepaid()) {
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
    const productName = this.exchangeTradeInLines()
      .map((l) => String(l?.productPayload?.name || '').trim())
      .filter(Boolean)
      .join(' · ');

    const ref = this.dialog.open(DeskPurchaseDeferredPaymentDialogComponent, {
      width: '520px',
      maxWidth: '95vw',
      panelClass: 'payment-splits-dialog-panel',
      data: {
        exchangeSettlementOnly: true,
        remaining: amount,
        productName,
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

  /** Minimal product payload for checkout API (avoids sending full catalog rows). */
  private toCheckoutProductLine(item: any): { selectedProduct: Record<string, unknown>; quantity: number } {
    return {
      selectedProduct: {
        _id: item._id ?? item.productId,
        name: item.name,
        code: item.code,
        price: item.price,
        netPrice: item.netPrice ?? item.cost,
        cost: item.cost ?? item.netPrice,
        discount: item.discount,
        isApplyDiscount: item.isApplyDiscount,
        sellByWeightOverride: item.sellByWeightOverride,
      },
      quantity: item.quantity,
    };
  }

  private performCheckout(payment: PaymentSplitsResult): void {
    if (this.checkoutInProgress) {
      return;
    }
    this.checkoutInProgress = true;
    const weightErrKey = this.validateOrderItemsForCheckout();
    if (weightErrKey) {
      this.translate.get(weightErrKey).subscribe((msg) =>
        this.appNotificationService.push(msg, 'error')
      );
      return;
    }

    for (const item of this.orderItems) {
      if (this.isWeightLine(item)) {
        item.quantity = normalizeWeightQuantity(item.quantity);
        item.saleUnit = 'weight';
        item.weightUnit = this.resolveWeightUnit(item);
      }
    }

    const selectedBranchId = canPickBranchRole(this.curentUser?.role)
      ? this.adminSelectedBranchId
      : this.globals.currentUser.branch._id;

    const clientDetails = this.resolveCheckoutClientDetails();

    const paymentSplits = payment.paymentSplits.map((s) => ({
      method: s.method,
      amount: round2(s.amount),
    }));

    const exchangeCredit = this.hasExchangeTradeIn() ? this.exchangeTradeInCredit() : 0;
    const exchangePurchaseId = this.exchangeTradeInPurchase?._id
      ? String(this.exchangeTradeInPurchase._id)
      : '';

    const orderData: Record<string, unknown> = {
      products: this.orderItems.map((i) => this.toCheckoutProductLine(i)),
      partyType: clientDetails.linkParty ? clientDetails.partyType : 'client',
      linkParty: clientDetails.linkParty,
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

    if (this.isDeliveryOrder) {
      orderData.isDelivery = true;
      if (this.selectedDeliveryPersonName) {
        orderData.deliveryPersonName = this.selectedDeliveryPersonName;
      }
    }

    if (clientDetails.clientId) {
      orderData.clientId = clientDetails.clientId;
    }

    if (clientDetails.linkParty && clientDetails.partyType === 'supplier' && this.selectedVendorId) {
      orderData.vendorId = this.selectedVendorId;
    }

    if (this.hasExchangeTradeIn() && exchangePurchaseId) {
      if (exchangeCredit > 0) {
        orderData.exchangeTradeInCreditAmount = exchangeCredit;
      }
      orderData.exchangeProductPurchaseRequestId = exchangePurchaseId;
      orderData.exchangeProductPurchaseRequestIds = [exchangePurchaseId];
    }

    const bookingAllocations = this.bookingDepositAllocations();
    const bookingCredit = round2(
      bookingAllocations.reduce((s, a) => s + a.creditApplied, 0)
    );
    if (bookingCredit > 0 && bookingAllocations.length) {
      orderData.bookingDepositCreditAmount = bookingCredit;
      orderData.bookingDepositAllocations = bookingAllocations;
    }

    if (payment.installmentPlanId) {
      orderData.installmentPlanId = payment.installmentPlanId;
      orderData.installmentStartDate = payment.installmentStartDate || undefined;
      if (payment.installmentMonthlyAmount && payment.installmentMonthlyAmount > 0) {
        orderData.installmentMonthlyAmount = payment.installmentMonthlyAmount;
      }
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
      this.checkoutInProgress = false;
      const pendingPurchaseReceipt = this.exchangeTradeInPurchase;
      this.exchangeTradeInPurchase = null;

      const base = res?.newOrder ?? {};
      const apiSub = Number(base?.subtotalPrice);
      const apiDisc = Number(base?.invoiceDiscountAmount);
      const apiTotal = Number(base?.totalPrice);
      // Prefer API totals so credit-sale markup on line prices is printed.
      this.createdOrder = {
        ...base,
        partyType: clientDetails.linkParty ? clientDetails.partyType : 'client',
        subtotalPrice: Number.isFinite(apiSub) ? apiSub : receiptSubtotal,
        invoiceDiscountAmount: Number.isFinite(apiDisc) ? apiDisc : receiptInvoiceDisc,
        totalPrice: Number.isFinite(apiTotal) ? apiTotal : receiptFinal,
        paymentMethod: base?.paymentMethod,
        amountPaid: Number(base?.amountPaid) || 0,
        paymentStatus: base?.paymentStatus,
        payments: Array.isArray(base?.payments) ? base.payments : [],
        bookingDepositCreditAmount:
          Number(base?.bookingDepositCreditAmount) > 0
            ? Number(base.bookingDepositCreditAmount)
            : bookingCredit,
      };

      if (
        String(base?.paymentMethod || '').toLowerCase() === 'installment' ||
        payment.installmentPlanId
      ) {
        this.collectionsService.notifyInstallmentSaleCreated();
      }

      this.pendingExchangePurchaseReceipt = pendingPurchaseReceipt;

      this.clearClientActiveBookings();
      this.printInvoice();

      setTimeout(() => this.loadProducts(true, { refreshDrawer: false }), 800);
      this.focusBarcodeInput();

    }, (error: any) => {
      this.checkoutInProgress = false;
      console.log('error', error);
      const apiCode = error?.error?.code;
      const msg =
        apiCode === 'PRODUCT_CODE_CATEGORY_MISMATCH'
          ? this.translate.instant('tr_product_code_category_mismatch')
          : apiCode === 'PRODUCT_SERIAL_ALREADY_EXISTS'
            ? this.translate.instant('tr_product_serial_already_exists')
            : apiCode === 'PRODUCT_CODE_ALREADY_EXISTS'
              ? this.translate.instant('tr_product_code_already_exists')
              : error?.error?.details ||
                error?.error?.error ||
                error?.error?.message ||
                this.translate.instant('tr_unexpected_error_message');
      this.appNotificationService.push(msg, 'error');
    });
  }

  printInvoice(): void {
    requestAnimationFrame(() => {
      this.cdr.detectChanges();
      requestAnimationFrame(() => {
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
          }, 400);
        }
      });
    });
  }

  /** Isolates cashier invoice from booking / order reprint hosts. */
  private runCashierPrint(): void {
    this.bookingReprint.clearPending();
    this.invoiceReprint.clearPending();
    this.disposeCashierPrint();
    if (typeof document === 'undefined' || typeof window === 'undefined') {
      window.print();
      return;
    }

    const id =
      this.printMode === 'deskPurchase' ? 'print-purchase-receipt' : 'print-container';
    const host = document.getElementById(id);
    if (!host || !host.innerHTML.trim()) {
      this.fallbackMainWindowPrint();
      return;
    }

    this.cashierPrintHandle = printIsolatedReceipt(host, {
      title: 'Cashier receipt',
      onFallback: () => this.fallbackMainWindowPrint(),
      onPrinted: () => {
        this.cashierPrintHandle = null;
      },
    });
  }

  private disposeCashierPrint(): void {
    if (this.cashierPrintClearTimer != null) {
      clearTimeout(this.cashierPrintClearTimer);
      this.cashierPrintClearTimer = null;
    }
    this.cashierPrintHandle?.dispose();
    this.cashierPrintHandle = null;
    if (typeof document !== 'undefined' && document.body.getAttribute('data-receipt-print') === 'cashier') {
      document.body.removeAttribute('data-receipt-print');
    }
  }

  private fallbackMainWindowPrint(): void {
    this.cashierPrintHandle?.dispose();
    this.cashierPrintHandle = null;
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
    this.cashierPrintClearTimer = setTimeout(clearFlag, 60000);
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

  receiptCreditFeeAmount(): number {
    const n = Number(this.createdOrder?.creditFeeAmount);
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
  }

  receiptCreditFeePercent(): number {
    const n = Number(this.createdOrder?.creditFeePercent);
    return Number.isFinite(n) && n > 0 ? n : 0;
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
