import { Component, OnDestroy, OnInit } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { ActivatedRoute, Router } from '@angular/router';
import {
  Branch,
  Vendor,
  VendorHistoryResponse,
  VendorPurchasingRequestRow,
  VendorSettlementPreview,
  Order,
} from '@core/models/products.model';
import { PaginationData } from '@core/models/users-interfaces.model';
import { AuthenticationService } from '@core/services/authentication.service';
import { TranslateService } from '@ngx-translate/core';
import { ConfirmationDialogComponent } from '@shared/components/confirmation-dialog/confirmation-dialog.component';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { AccountHistoryPdfService } from '@shared/services/account-history-pdf.service';
import { BranchesServce } from '@shared/services/branches.service';
import { VendorsSerivce } from '@shared/services/vendors.service';
import { resolveActorBranchContext } from '@core/utils/branch-utils';
import { normalizeMongoId } from '@core/utils/mongo-id.util';
import { isPayLaterMethod, orderDisplayRemaining } from '@core/utils/order-display.util';
import { VendorDepositDialogComponent } from '../vendor-deposit-dialog/vendor-deposit-dialog.component';
import { VendorOpeningDebitDialogComponent } from '../vendor-opening-debit-dialog/vendor-opening-debit-dialog.component';
import { VendorPaySupplierDialogComponent } from '../vendor-pay-supplier-dialog/vendor-pay-supplier-dialog.component';
import { VendorDeferredPaymentDialogComponent } from '../vendor-deferred-payment-dialog/vendor-deferred-payment-dialog.component';
import { VendorInstallmentPaymentDialogComponent } from '../vendor-installment-payment-dialog/vendor-installment-payment-dialog.component';
import { PayOrderDialogComponent } from '../../orders/pay-order-dialog/pay-order-dialog.component';
import { Subscription } from 'rxjs';

export type VendorHistoryTab =
  | 'overview'
  | 'orders'
  | 'purchases'
  | 'purchasing'
  | 'ledger';

@Component({
  selector: 'app-vendor-history',
  templateUrl: './vendor-history.component.html',
  styleUrls: ['./vendor-history.component.scss'],
})
export class VendorHistoryComponent implements OnInit, OnDestroy {
  loading = true;
  settling = false;
  exportingPdf = false;
  history: VendorHistoryResponse | null = null;
  vendor: Vendor | null = null;
  vendorId: string | null = null;

  activeTab: VendorHistoryTab = 'overview';
  perPage = 10;
  ordersPage = 1;
  purchasesPage = 1;
  purchasingPage = 1;
  ledgerPage = 1;

  /** Branch for cash-drawer attribution (deposits / deferred payments). */
  paymentBranchId: string | null = null;
  showBranchPicker = false;
  branches: Branch[] = [];

  private routeSub?: Subscription;

  constructor(
    private vendors: VendorsSerivce,
    private branchesService: BranchesServce,
    private auth: AuthenticationService,
    private translate: TranslateService,
    private notify: AppNotificationService,
    private accountHistoryPdf: AccountHistoryPdfService,
    private dialog: MatDialog,
    private router: Router,
    private route: ActivatedRoute
  ) {
    const actor = this.auth.getUserFromLocalStorage();
    const ctx = resolveActorBranchContext(actor, null);
    this.paymentBranchId = ctx.branchId;
    this.showBranchPicker = ctx.showBranchPicker;
  }

  ngOnInit(): void {
    if (this.showBranchPicker) {
      this.branchesService.getBranchs({ page: 1, limit: 1000 }).subscribe({
        next: (res: any) => {
          this.branches = res?.branches || [];
          if (!this.paymentBranchId && this.branches[0]?._id) {
            this.paymentBranchId = String(this.branches[0]._id);
          }
        },
        error: () => {
          this.notify.push(this.translate.instant('tr_unexpected_error_message'), 'error');
        },
      });
    } else if (!this.paymentBranchId) {
      this.notify.push(this.translate.instant('tr_branch_required'), 'error');
    }

    this.routeSub = this.route.paramMap.subscribe((params) => {
      this.vendorId = params.get('id');
      this.resetTablePages();
      this.loadHistory();
    });
  }

  ngOnDestroy(): void {
    this.routeSub?.unsubscribe();
  }

  setTab(tab: VendorHistoryTab): void {
    if (this.activeTab === tab) return;
    this.activeTab = tab;
  }

  onPaymentBranchChange(branchId: string): void {
    this.paymentBranchId = String(branchId || '').trim() || null;
  }

  get settlementPreview(): VendorSettlementPreview | null {
    return this.history?.settlementPreview || null;
  }

  get ordersCount(): number {
    return this.history?.orders?.length || 0;
  }

  get purchasesCount(): number {
    return this.history?.purchases?.length || 0;
  }

  get purchasingCount(): number {
    return this.history?.purchasingRequests?.length || 0;
  }

  get ledgerCount(): number {
    return this.history?.ledgerEntries?.length || 0;
  }

  get pagedOrders() {
    return this.slicePage(this.history?.orders || [], this.ordersPage);
  }

  get pagedPurchases() {
    return this.slicePage(this.history?.purchases || [], this.purchasesPage);
  }

  get pagedPurchasingRequests() {
    return this.slicePage(this.history?.purchasingRequests || [], this.purchasingPage);
  }

  get pagedLedgerEntries() {
    return this.slicePage(this.history?.ledgerEntries || [], this.ledgerPage);
  }

  get ordersPagination(): PaginationData {
    return this.buildPagination(this.ordersCount, this.ordersPage);
  }

  get purchasesPagination(): PaginationData {
    return this.buildPagination(this.purchasesCount, this.purchasesPage);
  }

  get purchasingPagination(): PaginationData {
    return this.buildPagination(this.purchasingCount, this.purchasingPage);
  }

  get ledgerPagination(): PaginationData {
    return this.buildPagination(this.ledgerCount, this.ledgerPage);
  }

  onOrdersPageChange(page: number): void {
    this.ordersPage = page;
  }

  onPurchasesPageChange(page: number): void {
    this.purchasesPage = page;
  }

  onPurchasingPageChange(page: number): void {
    this.purchasingPage = page;
  }

  onLedgerPageChange(page: number): void {
    this.ledgerPage = page;
  }

  loadHistory(): void {
    if (!this.vendorId) return;
    this.loading = true;
    this.vendors.getVendorHistory(String(this.vendorId)).subscribe({
      next: (res) => {
        this.history = res;
        this.vendor = res?.vendor || null;
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.notify.push(this.translate.instant('tr_unexpected_error_message'), 'error');
      },
    });
  }

  goBack(): void {
    this.router.navigate(['/suppliers']);
  }

  netBalanceText(): string {
    const net = this.history?.netBalanceMessage;
    if (!net) return '';
    if (net.who === 'even') {
      return this.translate.instant('tr_vendor_balance_even');
    }
    if (net.who === 'supplier') {
      return this.translate.instant('tr_vendor_owes_us_net', { amount: net.amount });
    }
    return this.translate.instant('tr_we_owe_vendor_net', { amount: net.amount });
  }

  settlementNetAfterText(preview: VendorSettlementPreview): string {
    const net = preview.netAfter;
    if (!net) {
      return this.translate.instant('tr_vendor_settlement_net_cleared');
    }
    if (net.who === 'even') {
      return this.translate.instant('tr_vendor_balance_even');
    }
    if (net.who === 'supplier') {
      return this.translate.instant('tr_vendor_settlement_after_supplier_owes', { amount: net.amount });
    }
    return this.translate.instant('tr_vendor_settlement_after_we_owe', { amount: net.amount });
  }

  formatMoney(amount: number): string {
    return new Intl.NumberFormat('en-EG', {
      style: 'currency',
      currency: 'EGP',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(amount) || 0);
  }

  confirmSettle(): void {
    const preview = this.settlementPreview;
    if (!preview?.canSettle || this.settling) return;

    const details = [
      this.translate.instant('tr_vendor_settlement_line_debit', {
        amount: this.formatMoney(preview.debitTotal),
      }),
      this.translate.instant('tr_vendor_settlement_line_credit', {
        amount: this.formatMoney(preview.creditTotal),
      }),
      this.translate.instant('tr_vendor_settlement_line_offset', {
        amount: this.formatMoney(preview.settleAmount),
      }),
      this.translate.instant('tr_vendor_settlement_line_after_debit', {
        amount: this.formatMoney(preview.afterDebit),
      }),
      this.translate.instant('tr_vendor_settlement_line_after_credit', {
        amount: this.formatMoney(preview.afterCredit),
      }),
      this.settlementNetAfterText(preview),
    ];

    this.dialog
      .open(ConfirmationDialogComponent, {
        width: '520px',
        data: {
          title: this.translate.instant('tr_vendor_settlement_confirm_title'),
          message: this.translate.instant('tr_vendor_settlement_confirm_message'),
          details,
          buttons: [
            {
              label: this.translate.instant('tr_action.cancel'),
              actionCallback: 'cancel',
              type: 'btn-secondary',
            },
            {
              label: this.translate.instant('tr_vendor_settle_balances'),
              actionCallback: 'confirm',
              type: 'btn-primary',
            },
          ],
        },
        disableClose: true,
      })
      .afterClosed()
      .subscribe((result) => {
        if (result === 'confirm') {
          this.settle();
        }
      });
  }

  settle(): void {
    if (!this.history?.canSettle || this.settling || !this.vendorId) return;

    this.settling = true;
    const u = this.auth.getUserFromLocalStorage();
    this.vendors.settleVendorBalances(String(this.vendorId), { userId: u?._id }).subscribe({
      next: (res) => {
        this.settling = false;
        this.notify.push(this.translate.instant('tr_vendor_settlement_ok'), 'success');
        if (res?.netBalanceMessage) {
          this.history!.netBalanceMessage = res.netBalanceMessage;
        }
        if (res?.settlementPreview) {
          this.history!.settlementPreview = res.settlementPreview;
          this.history!.canSettle = res.settlementPreview.canSettle;
        }
        this.afterBalanceChange();
      },
      error: (err) => {
        this.settling = false;
        const msg =
          err?.error?.message ||
          err?.error?.error ||
          this.translate.instant('tr_unexpected_error_message');
        this.notify.push(msg, 'error');
      },
    });
  }

  private afterBalanceChange(): void {
    this.resetTablePages();
    this.loadHistory();
  }

  canSetOpeningDebit(): boolean {
    const hasOpeningLedger = (this.history?.ledgerEntries || []).some(
      (e) => e.type === 'opening_debit'
    );
    return !hasOpeningLedger && (this.history?.owesFromOpeningBalance || 0) <= 0.005;
  }

  openOpeningDebitDialog(): void {
    if (!this.vendor) return;
    const ref = this.dialog.open(VendorOpeningDebitDialogComponent, {
      width: '480px',
      maxWidth: '96vw',
      data: {
        vendor: this.vendor,
        mode: 'set',
      },
      disableClose: true,
    });
    ref.afterClosed().subscribe((saved) => {
      if (saved) this.afterBalanceChange();
    });
  }

  openDepositDialog(): void {
    if (!this.vendor) return;
    if (!this.paymentBranchId) {
      this.notify.push(this.translate.instant('tr_branch_required'), 'error');
      return;
    }
    this.dialog
      .open(VendorDepositDialogComponent, {
        width: '520px',
        maxWidth: '96vw',
        data: {
          vendor: this.vendor,
          forcedBranchId: this.paymentBranchId,
          mode: 'credit',
        },
        disableClose: true,
      })
      .afterClosed()
      .subscribe((saved) => {
        if (saved) {
          this.afterBalanceChange();
        }
      });
  }

  ledgerTypeLabel(type: string): string {
    switch (type) {
      case 'deposit':
        return this.translate.instant('tr_vendor_ledger_deposit');
      case 'received_deposit':
        return this.translate.instant('tr_vendor_ledger_received_deposit');
      case 'settlement':
        return this.translate.instant('tr_vendor_ledger_settlement');
      case 'order_payment':
        return this.translate.instant('tr_vendor_ledger_payment');
      case 'opening_debit':
        return this.translate.instant('tr_vendor_ledger_opening_debit');
      case 'opening_debit_payment':
        return this.translate.instant('tr_vendor_ledger_opening_debit_payment');
      case 'purchase':
        return this.translate.instant('tr_vendor_ledger_purchase');
      case 'purchase_installment_paid':
        return this.translate.instant('tr_vendor_ledger_installment_paid');
      case 'purchase_deferred':
        return this.translate.instant('tr_vendor_ledger_deferred');
      case 'purchase_deferred_paid':
        return this.translate.instant('tr_vendor_ledger_deferred_paid');
      default:
        return type;
    }
  }

  paymentStatusLabel(status?: string): string {
    switch (status) {
      case 'Installments':
        return this.translate.instant('tr_payment_installments');
      case 'Deferred':
        return this.translate.instant('tr_payment_deferred');
      default:
        return status || '—';
    }
  }

  purchaseRef(row: { _id?: string } | null | undefined): string {
    const id = normalizeMongoId(row?._id);
    if (!id) return '—';
    const s = String(id);
    return s.length > 10 ? s.slice(-10).toUpperCase() : s.toUpperCase();
  }

  purchaseStatusLabel(status?: string): string {
    switch (String(status || '').toLowerCase()) {
      case 'approved':
        return this.translate.instant('tr_purchase_status_approved');
      case 'rejected':
        return this.translate.instant('tr_purchase_status_rejected');
      case 'pending':
        return this.translate.instant('tr_pending');
      default:
        return status || '—';
    }
  }

  goToSalesInvoice(orderNumber?: number | string | null): void {
    if (orderNumber == null || orderNumber === '') return;
    this.router.navigate(['/orders'], {
      queryParams: { section: 'sales', search: String(orderNumber) },
    });
  }

  goToPurchaseInvoice(purchaseId?: string | null): void {
    const id = normalizeMongoId(purchaseId);
    if (!id) return;
    this.router.navigate(['/orders'], {
      queryParams: { section: 'purchases', search: id },
    });
  }

  canPaySalesOrder(o: {
    _id?: string;
    paymentMethod?: string;
    status?: string;
    remaining?: number;
  }): boolean {
    if (!o?._id || o.status === 'restored') return false;
    if (!isPayLaterMethod(o.paymentMethod)) return false;
    const rem = Number(o.remaining);
    if (Number.isFinite(rem)) return rem > 0.005;
    return orderDisplayRemaining(o as Order) > 0.005;
  }

  openPaySalesOrderDialog(o: { _id?: string } & Partial<Order>): void {
    if (!this.paymentBranchId) {
      this.notify.push(this.translate.instant('tr_branch_required'), 'error');
      return;
    }
    const ref = this.dialog.open(PayOrderDialogComponent, {
      width: '520px',
      maxWidth: '96vw',
      panelClass: 'pay-order-dialog-panel',
      backdropClass: 'pay-order-dialog-backdrop',
      data: { order: o as Order, forcedBranchId: this.paymentBranchId },
      disableClose: true,
    });
    ref.afterClosed().subscribe((ok) => {
      if (ok) this.afterBalanceChange();
    });
  }

  maxPaySupplierAmount(): number {
    const prepaid = Number(this.history?.prepaidBalance) || 0;
    const payable = Number(this.history?.purchasePayable) || 0;
    return Math.round((prepaid + payable) * 100) / 100;
  }

  canPaySupplier(): boolean {
    return this.maxPaySupplierAmount() > 0.005;
  }

  openPaySupplierDialog(): void {
    if (!this.vendor) return;
    if (!this.paymentBranchId) {
      this.notify.push(this.translate.instant('tr_branch_required'), 'error');
      return;
    }
    const ref = this.dialog.open(VendorPaySupplierDialogComponent, {
      width: '520px',
      maxWidth: '96vw',
      panelClass: 'vendor-pay-supplier-dialog-panel',
      backdropClass: 'vendor-pay-supplier-dialog-backdrop',
      data: {
        vendor: this.vendor,
        forcedBranchId: this.paymentBranchId,
        maxAmount: this.maxPaySupplierAmount(),
      },
      disableClose: true,
    });
    ref.afterClosed().subscribe((ok) => {
      if (ok) this.afterBalanceChange();
    });
  }

  hasUnpaidInstallments(pr: VendorPurchasingRequestRow): boolean {
    return (pr.installments || []).some(
      (i) => !i.paid && (Number(i.amount) || 0) > 0.005
    );
  }

  openInstallmentPaymentDialog(pr: VendorPurchasingRequestRow): void {
    if (!this.vendor) return;
    const ref = this.dialog.open(VendorInstallmentPaymentDialogComponent, {
      width: '520px',
      maxWidth: '96vw',
      panelClass: 'vendor-installment-payment-dialog-panel',
      backdropClass: 'vendor-installment-payment-dialog-backdrop',
      data: {
        vendor: this.vendor,
        purchasingRequest: pr,
        forcedBranchId: this.paymentBranchId,
      },
      disableClose: true,
    });

    ref.afterClosed().subscribe((ok) => {
      if (ok) {
        this.afterBalanceChange();
      }
    });
  }

  openDeferredPaymentDialog(pr: VendorPurchasingRequestRow): void {
    if (!this.vendor) return;
    const ref = this.dialog.open(VendorDeferredPaymentDialogComponent, {
      width: '520px',
      maxWidth: '96vw',
      panelClass: 'vendor-deferred-payment-dialog-panel',
      backdropClass: 'vendor-deferred-payment-dialog-backdrop',
      data: {
        vendor: this.vendor,
        purchasingRequest: pr,
        forcedBranchId: this.paymentBranchId,
      },
      disableClose: true,
    });

    ref.afterClosed().subscribe((ok) => {
      if (ok) {
        this.afterBalanceChange();
      }
    });
  }

  async exportPdf(): Promise<void> {
    if (!this.history || !this.vendor || this.exportingPdf) return;
    this.exportingPdf = true;
    try {
      await this.accountHistoryPdf.exportVendorHistory(this.vendor, this.history, this.translate, {
        netBalanceText: () => this.netBalanceText(),
        settlementNetAfterText: (p) => this.settlementNetAfterText(p),
        ledgerTypeLabel: (type) => this.ledgerTypeLabel(type),
        paymentStatusLabel: (status) => this.paymentStatusLabel(status),
        formatMoney: (amount) => this.formatMoney(amount),
      });
    } catch {
      this.notify.push(this.translate.instant('tr_unexpected_error_message'), 'error');
    } finally {
      this.exportingPdf = false;
    }
  }

  private resetTablePages(): void {
    this.ordersPage = 1;
    this.purchasesPage = 1;
    this.purchasingPage = 1;
    this.ledgerPage = 1;
  }

  private slicePage<T>(items: T[], page: number): T[] {
    const start = (page - 1) * this.perPage;
    return items.slice(start, start + this.perPage);
  }

  private buildPagination(totalCount: number, currentPage: number): PaginationData {
    const totalPages = Math.max(1, Math.ceil(totalCount / this.perPage) || 1);
    const page = Math.min(Math.max(1, currentPage), totalPages);
    return {
      currentPage: page,
      nextPage: Math.min(page + 1, totalPages),
      prevPage: Math.max(page - 1, 1),
      totalCount,
      totalPages,
    };
  }
}
