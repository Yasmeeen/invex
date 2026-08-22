import { Component, OnDestroy, OnInit } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { ActivatedRoute, Router } from '@angular/router';
import { Branch, Order } from '@core/models/products.model';
import {
  isInstallmentSale,
  isPayLaterMethod,
  isPayLaterSettled,
  orderDisplayPaid,
  orderDisplayRemaining,
  orderInstallmentMonthlyAmount,
  orderInstallmentPlanName,
} from '@core/utils/order-display.util';
import {
  Client,
  ClientHistoryOrderRow,
  ClientHistoryPurchaseRow,
  ClientHistoryResponse,
  ClientLedgerEntry,
  ClientSettlementPreview,
  PaginationData,
} from '@core/models/users-interfaces.model';
import { AuthenticationService } from '@core/services/authentication.service';
import { resolveActorBranchContext } from '@core/utils/branch-utils';
import { TranslateService } from '@ngx-translate/core';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { AccountHistoryPdfService } from '@shared/services/account-history-pdf.service';
import { BranchesServce } from '@shared/services/branches.service';
import { UserSerivce } from '@shared/services/user.service';
import { OrdersSerivce } from '@shared/services/orders.service';
import { paymentMethodDisplayLabel } from '@shared/utils/cashier-payment-methods.util';
import { StoreSettingsService } from '@shared/services/store-settings.service';
import { PayOrderDialogComponent } from '../../orders/pay-order-dialog/pay-order-dialog.component';
import { DeskPurchaseDeferredPaymentDialogComponent } from '../../orders/desk-purchase-deferred-payment-dialog/desk-purchase-deferred-payment-dialog.component';
import { ConfirmationDialogComponent } from '@shared/components/confirmation-dialog/confirmation-dialog.component';
import { ClientDepositDialogComponent } from '../client-deposit-dialog/client-deposit-dialog.component';
import { ClientOpeningDebitDialogComponent } from '../client-opening-debit-dialog/client-opening-debit-dialog.component';
import { ClientPayClientDialogComponent } from '../client-pay-client-dialog/client-pay-client-dialog.component';
import { normalizeMongoId } from '@core/utils/mongo-id.util';
import {
  PromiseToPayDialogComponent,
  PromiseToPayDialogResult,
} from '@shared/components/promise-to-pay-dialog/promise-to-pay-dialog.component';
import { Subscription } from 'rxjs';

export type ClientHistoryTab = 'overview' | 'credit' | 'installments' | 'orders' | 'purchases' | 'ledger';

@Component({
  selector: 'app-client-history',
  templateUrl: './client-history.component.html',
  styleUrls: ['./client-history.component.scss'],
})
export class ClientHistoryComponent implements OnInit, OnDestroy {
  loading = true;
  settling = false;
  exportingPdf = false;
  history: ClientHistoryResponse | null = null;
  client: Client | null = null;
  clientId: string | null = null;

  activeTab: ClientHistoryTab = 'overview';
  perPage = 10;
  creditPage = 1;
  ordersPage = 1;
  purchasesPage = 1;
  ledgerPage = 1;

  /** Branch for cash-drawer attribution (deposits / credit invoice payments). */
  paymentBranchId: string | null = null;
  showBranchPicker = false;
  branches: Branch[] = [];

  private routeSub?: Subscription;

  constructor(
    private userService: UserSerivce,
    private orders: OrdersSerivce,
    private branchesService: BranchesServce,
    private auth: AuthenticationService,
    private translate: TranslateService,
    private notify: AppNotificationService,
    private accountHistoryPdf: AccountHistoryPdfService,
    private storeSettings: StoreSettingsService,
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
      this.clientId = params.get('id');
      this.resetTablePages();
      this.loadClient();
      this.loadHistory();
    });
  }

  ngOnDestroy(): void {
    this.routeSub?.unsubscribe();
  }

  setTab(tab: ClientHistoryTab): void {
    if (this.activeTab === tab) return;
    this.activeTab = tab;
  }

  onPaymentBranchChange(branchId: string): void {
    this.paymentBranchId = String(branchId || '').trim() || null;
  }

  goBack(): void {
    this.router.navigate(['/clients']);
  }

  get clientTitle(): string {
    const c = this.client || (this.history?.client as Client | undefined);
    return String(c?.name || c?.phoneNumber || '').trim();
  }

  get settlementPreview(): ClientSettlementPreview | null {
    return this.history?.settlementPreview || null;
  }

  get creditOrdersRows(): ClientHistoryOrderRow[] {
    return this.history?.creditOrders || [];
  }

  get installmentOrdersRows(): ClientHistoryOrderRow[] {
    return this.history?.installmentOrders || [];
  }

  get ordersRows(): ClientHistoryOrderRow[] {
    return this.history?.orders || [];
  }

  get purchasesRows(): ClientHistoryPurchaseRow[] {
    return this.history?.purchases || [];
  }

  get ledgerRows(): ClientLedgerEntry[] {
    return this.history?.ledgerEntries || [];
  }

  get creditCount(): number {
    return this.creditOrdersRows.length;
  }

  get installmentCount(): number {
    return this.installmentOrdersRows.length;
  }

  get ordersCount(): number {
    return this.ordersRows.length;
  }

  get purchasesCount(): number {
    return this.purchasesRows.length;
  }

  get ledgerCount(): number {
    return this.ledgerRows.length;
  }

  get pagedCreditOrders(): ClientHistoryOrderRow[] {
    return this.slicePage(this.creditOrdersRows, this.creditPage);
  }

  get pagedOrders(): ClientHistoryOrderRow[] {
    return this.slicePage(this.ordersRows, this.ordersPage);
  }

  get pagedPurchases(): ClientHistoryPurchaseRow[] {
    return this.slicePage(this.purchasesRows, this.purchasesPage);
  }

  get pagedLedgerEntries(): ClientLedgerEntry[] {
    return this.slicePage(this.ledgerRows, this.ledgerPage);
  }

  get creditPagination(): PaginationData {
    return this.buildPagination(this.creditCount, this.creditPage);
  }

  get ordersPagination(): PaginationData {
    return this.buildPagination(this.ordersCount, this.ordersPage);
  }

  get purchasesPagination(): PaginationData {
    return this.buildPagination(this.purchasesCount, this.purchasesPage);
  }

  get ledgerPagination(): PaginationData {
    return this.buildPagination(this.ledgerCount, this.ledgerPage);
  }

  onCreditPageChange(page: number): void {
    this.creditPage = page;
  }

  onOrdersPageChange(page: number): void {
    this.ordersPage = page;
  }

  onPurchasesPageChange(page: number): void {
    this.purchasesPage = page;
  }

  onLedgerPageChange(page: number): void {
    this.ledgerPage = page;
  }

  loadClient(): void {
    if (!this.clientId) return;
    this.userService.getClient(String(this.clientId)).subscribe({
      next: (res: any) => {
        this.client = res?.client || res || null;
      },
      error: () => {
        this.client = null;
      },
    });
  }

  loadHistory(): void {
    if (!this.clientId) return;
    this.loading = true;
    this.userService.getClientHistory(String(this.clientId)).subscribe({
      next: (res) => {
        this.history = res;
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.notify.push(this.translate.instant('tr_unexpected_error_message'), 'error');
      },
    });
  }

  /** Client object required by the action dialogs. */
  private get actionClient(): Client | null {
    return this.client || ((this.history?.client as Client) ?? null);
  }

  netBalanceText(): string {
    const net = this.history?.netBalanceMessage;
    if (!net) return '';
    if (net.who === 'even') {
      return this.translate.instant('tr_client_balance_even');
    }
    if (net.who === 'client') {
      return this.translate.instant('tr_client_owes_us_net', { amount: net.amount });
    }
    return this.translate.instant('tr_we_owe_client_net', { amount: net.amount });
  }

  settlementNetAfterText(preview: ClientSettlementPreview): string {
    const net = preview.netAfter;
    if (!net) {
      return this.translate.instant('tr_client_settlement_net_cleared');
    }
    if (net.who === 'even') {
      return this.translate.instant('tr_client_balance_even');
    }
    if (net.who === 'client') {
      return this.translate.instant('tr_client_settlement_after_client_owes', { amount: net.amount });
    }
    return this.translate.instant('tr_client_settlement_after_we_owe', { amount: net.amount });
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
      this.translate.instant('tr_client_settlement_line_debit', {
        amount: this.formatMoney(preview.debitTotal),
      }),
      this.translate.instant('tr_client_settlement_line_credit', {
        amount: this.formatMoney(preview.creditTotal),
      }),
      this.translate.instant('tr_client_settlement_line_offset', {
        amount: this.formatMoney(preview.settleAmount),
      }),
      this.translate.instant('tr_client_settlement_line_after_debit', {
        amount: this.formatMoney(preview.afterDebit),
      }),
      this.translate.instant('tr_client_settlement_line_after_credit', {
        amount: this.formatMoney(preview.afterCredit),
      }),
      this.settlementNetAfterText(preview),
    ];

    this.dialog
      .open(ConfirmationDialogComponent, {
        width: '520px',
        data: {
          title: this.translate.instant('tr_client_settlement_confirm_title'),
          message: this.translate.instant('tr_client_settlement_confirm_message'),
          details,
          buttons: [
            {
              label: this.translate.instant('tr_action.cancel'),
              actionCallback: 'cancel',
              type: 'btn-secondary',
            },
            {
              label: this.translate.instant('tr_client_settle_balances'),
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
    if (!this.history?.canSettle || this.settling || !this.clientId) return;

    this.settling = true;
    const u = this.auth.getUserFromLocalStorage();
    this.userService.settleClientBalances(String(this.clientId), { userId: u?._id }).subscribe({
      next: (res) => {
        this.settling = false;
        this.notify.push(this.translate.instant('tr_client_settlement_ok'), 'success');
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
          err?.error?.error ||
          err?.error?.message ||
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
    const client = this.actionClient;
    if (!client) return;
    const ref = this.dialog.open(ClientOpeningDebitDialogComponent, {
      width: '480px',
      maxWidth: '96vw',
      data: { client },
      disableClose: true,
    });
    ref.afterClosed().subscribe((saved) => {
      if (saved) this.afterBalanceChange();
    });
  }

  openDepositDialog(): void {
    const client = this.actionClient;
    if (!client) return;
    if (!this.paymentBranchId) {
      this.notify.push(this.translate.instant('tr_branch_required'), 'error');
      return;
    }
    this.dialog
      .open(ClientDepositDialogComponent, {
        width: '520px',
        maxWidth: '96vw',
        data: { client, forcedBranchId: this.paymentBranchId },
        disableClose: true,
      })
      .afterClosed()
      .subscribe((saved) => {
        if (saved) {
          this.afterBalanceChange();
        }
      });
  }

  maxPayClientAmount(): number {
    const weOwe = Number(this.history?.weOweClient);
    if (Number.isFinite(weOwe) && weOwe > 0) {
      return Math.round(weOwe * 100) / 100;
    }
    const prepaid = Number(this.history?.prepaidBalance) || 0;
    const deferred = Number(this.history?.clientPayableDeferred) || 0;
    return Math.round((prepaid + deferred) * 100) / 100;
  }

  canPayClient(): boolean {
    return this.maxPayClientAmount() > 0.005;
  }

  openPayClientDialog(): void {
    const client = this.actionClient;
    if (!client) return;
    if (!this.paymentBranchId) {
      this.notify.push(this.translate.instant('tr_branch_required'), 'error');
      return;
    }
    const ref = this.dialog.open(ClientPayClientDialogComponent, {
      width: '520px',
      maxWidth: '96vw',
      panelClass: 'client-pay-client-dialog-panel',
      backdropClass: 'client-pay-client-dialog-backdrop',
      data: {
        client,
        forcedBranchId: this.paymentBranchId,
        maxAmount: this.maxPayClientAmount(),
      },
      disableClose: true,
    });
    ref.afterClosed().subscribe((ok) => {
      if (ok) this.afterBalanceChange();
    });
  }

  orderPaid(order: ClientHistoryOrderRow): number {
    return orderDisplayPaid(order as any);
  }

  orderRemaining(order: ClientHistoryOrderRow): number {
    return order.remaining ?? orderDisplayRemaining(order as any);
  }

  isCreditFullySettled(order: ClientHistoryOrderRow): boolean {
    return isPayLaterSettled(order as any);
  }

  payLaterSettledLabelKey(order: ClientHistoryOrderRow): string {
    return isInstallmentSale(order as any)
      ? 'tr_installments_fully_settled'
      : 'tr_credit_fully_settled';
  }

  installmentPlanName(order: ClientHistoryOrderRow): string {
    return orderInstallmentPlanName(order as any);
  }

  installmentMonthlyAmount(order: ClientHistoryOrderRow): number {
    return orderInstallmentMonthlyAmount(order as any);
  }

  paymentStatusLabel(status?: string, order?: ClientHistoryOrderRow): string {
    if (order && this.isCreditFullySettled(order) && order.status !== 'restored') {
      return this.translate.instant(this.payLaterSettledLabelKey(order));
    }
    switch (status) {
      case 'paid':
        return this.translate.instant('tr_paid');
      case 'partial':
        return this.translate.instant('tr_partial');
      case 'unpaid':
        return this.translate.instant('tr_unpaid');
      default:
        return status || '—';
    }
  }

  paymentMethodLabel(method?: string): string {
    if (!method) {
      return '—';
    }
    return paymentMethodDisplayLabel(
      method,
      this.storeSettings.snapshot.paymentAppFeePercents,
      this.translate
    );
  }

  purchaseStatusLabel(status?: string): string {
    switch (status) {
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

  purchaseTreasuryLabel(row: ClientHistoryPurchaseRow): string {
    return String(row.purchaseTreasuryLabel || row.purchaseTreasuryKey || '').trim() || '—';
  }

  purchaseRef(row: { _id?: string } | null | undefined): string {
    const id = normalizeMongoId(row?._id);
    if (!id) return '—';
    const s = String(id);
    return s.length > 10 ? s.slice(-10).toUpperCase() : s.toUpperCase();
  }

  ledgerTypeLabel(type: string): string {
    switch (type) {
      case 'deposit':
        return this.translate.instant('tr_client_ledger_deposit');
      case 'opening_debit':
        return this.translate.instant('tr_client_ledger_opening_debit');
      case 'settlement':
        return this.translate.instant('tr_client_ledger_settlement');
      case 'payout':
        return this.translate.instant('tr_client_ledger_payout');
      default:
        return type || '—';
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

  canPayOrder(order: ClientHistoryOrderRow): boolean {
    if (!order?._id || order.status === 'restored') return false;
    if (!isPayLaterMethod(order.paymentMethod) && !order.isPayLater) return false;
    return this.orderRemaining(order) > 0.005;
  }

  openPayOrderDialog(order: ClientHistoryOrderRow, installmentId?: string | null): void {
    if (!this.paymentBranchId) {
      this.notify.push(this.translate.instant('tr_branch_required'), 'error');
      return;
    }
    const ref = this.dialog.open(PayOrderDialogComponent, {
      width: '520px',
      maxWidth: '96vw',
      panelClass: 'pay-order-dialog-panel',
      backdropClass: 'pay-order-dialog-backdrop',
      data: {
        order: order as Order,
        forcedBranchId: this.paymentBranchId,
        installmentId: installmentId || null,
      },
      disableClose: true,
    });
    ref.afterClosed().subscribe((ok) => {
      if (ok) this.afterBalanceChange();
    });
  }

  installmentRowRemaining(row: {
    paid?: boolean;
    amount?: number;
    paidAmount?: number;
  }): number {
    if (row?.paid) return 0;
    return Math.max(
      0,
      Math.round(((Number(row?.amount) || 0) - (Number(row?.paidAmount) || 0)) * 100) / 100
    );
  }

  /** paid = settled, overdue = unpaid past due, upcoming = unpaid not yet due. */
  installmentRowStatus(row: {
    paid?: boolean;
    amount?: number;
    paidAmount?: number;
    dueDate?: string | Date;
  }): 'paid' | 'overdue' | 'upcoming' {
    if (this.installmentRowRemaining(row) <= 0.005) return 'paid';
    const due = row?.dueDate ? new Date(row.dueDate) : null;
    if (!due || Number.isNaN(due.getTime())) return 'upcoming';
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dueDay = new Date(due);
    dueDay.setHours(0, 0, 0, 0);
    return dueDay.getTime() < today.getTime() ? 'overdue' : 'upcoming';
  }

  canPayInstallmentRow(
    order: ClientHistoryOrderRow,
    row: { _id?: string; paid?: boolean; amount?: number; paidAmount?: number }
  ): boolean {
    return this.canPayOrder(order) && this.installmentRowRemaining(row) > 0.005;
  }

  setInstallmentPromise(
    order: ClientHistoryOrderRow,
    row: {
      _id?: string;
      promiseToPayAt?: string;
      sequence?: number;
      promiseToPayHistoryPast?: Array<{
        promiseToPayAt?: string;
        recordedAt?: string;
        paidOnPromisedDay?: boolean | null;
      }>;
      promiseToPayHistory?: Array<{
        promiseToPayAt?: string;
        recordedAt?: string;
        paidOnPromisedDay?: boolean | null;
      }>;
    }
  ): void {
    const orderId = normalizeMongoId(order._id);
    const installmentId = normalizeMongoId(row._id);
    if (!orderId || !installmentId) return;

    const ref = this.dialog.open(PromiseToPayDialogComponent, {
      width: '440px',
      maxWidth: '95vw',
      panelClass: 'promise-to-pay-dialog-panel',
      backdropClass: 'promise-to-pay-dialog-backdrop',
      data: {
        promiseToPayAt: row.promiseToPayAt || null,
        orderNumber: order.orderNumber,
        installmentSequence: row.sequence,
        promiseToPayHistory: row.promiseToPayHistoryPast || row.promiseToPayHistory || [],
      },
      disableClose: true,
    });

    ref.afterClosed().subscribe((result: PromiseToPayDialogResult | undefined) => {
      if (result === false || result === undefined) return;
      this.orders.setInstallmentPromise(orderId, installmentId, { promiseToPayAt: result }).subscribe({
        next: () => {
          this.notify.push(this.translate.instant('tr_promise_to_pay_ok'), 'success');
          this.afterBalanceChange();
        },
        error: (err) => {
          const msg =
            err?.error?.error || err?.error?.message || this.translate.instant('tr_unexpected_error_message');
          this.notify.push(msg, 'error');
        },
      });
    });
  }

  canPayDeferredPurchase(row: ClientHistoryPurchaseRow): boolean {
    return (
      row?.status === 'approved' &&
      !!row.isDeferredPurchase &&
      (Number(row.remaining) || 0) > 0.005
    );
  }

  openPayDeferredPurchase(row: ClientHistoryPurchaseRow): void {
    const id = normalizeMongoId(row._id);
    if (!id) return;
    const ref = this.dialog.open(DeskPurchaseDeferredPaymentDialogComponent, {
      width: '520px',
      maxWidth: '96vw',
      panelClass: 'vendor-deferred-payment-dialog-panel',
      backdropClass: 'vendor-deferred-payment-dialog-backdrop',
      data: {
        purchaseId: id,
        remaining: Number(row.remaining) || 0,
        partyTypeLabel: this.translate.instant('tr_party_client'),
        partyName: this.clientTitle,
        productName: row.productName || '',
        requestDate: row.createdAt,
        forcedBranchId: this.paymentBranchId,
      },
      disableClose: true,
    });
    ref.afterClosed().subscribe((ok) => {
      if (ok) this.afterBalanceChange();
    });
  }

  async exportPdf(): Promise<void> {
    const client = this.actionClient;
    if (!this.history || !client || this.exportingPdf) return;
    this.exportingPdf = true;
    try {
      await this.accountHistoryPdf.exportClientHistory(client, this.history, this.translate, {
        netBalanceText: () => this.netBalanceText(),
        settlementNetAfterText: (p) => this.settlementNetAfterText(p),
        ledgerTypeLabel: (type) => this.ledgerTypeLabel(type),
        paymentStatusLabel: (status) => this.paymentStatusLabel(status),
        paymentMethodLabel: (method) => this.paymentMethodLabel(method),
        purchaseStatusLabel: (status) => this.purchaseStatusLabel(status),
        purchaseTreasuryLabel: (row) => this.purchaseTreasuryLabel(row),
        orderPaid: (order) => this.orderPaid(order),
        orderRemaining: (order) => this.orderRemaining(order),
        formatMoney: (amount) => this.formatMoney(amount),
      });
    } catch {
      this.notify.push(this.translate.instant('tr_unexpected_error_message'), 'error');
    } finally {
      this.exportingPdf = false;
    }
  }

  private resetTablePages(): void {
    this.creditPage = 1;
    this.ordersPage = 1;
    this.purchasesPage = 1;
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
