import { Component, Inject, OnInit } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { Order, Branch } from '@core/models/products.model';
import {
  isPayLaterMethod,
  isPayLaterSettled,
  orderDisplayPaid,
  orderDisplayRemaining,
} from '@core/utils/order-display.util';
import {
  Client,
  ClientHistoryOrderRow,
  ClientHistoryPurchaseRow,
  ClientHistoryResponse,
  ClientSettlementPreview,
} from '@core/models/users-interfaces.model';
import { AuthenticationService } from '@core/services/authentication.service';
import { resolveActorBranchContext } from '@core/utils/branch-utils';
import { TranslateService } from '@ngx-translate/core';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { AccountHistoryPdfService } from '@shared/services/account-history-pdf.service';
import { BranchesServce } from '@shared/services/branches.service';
import { UserSerivce } from '@shared/services/user.service';
import { paymentMethodDisplayLabel } from '@shared/utils/cashier-payment-methods.util';
import { StoreSettingsService } from '@shared/services/store-settings.service';
import { PayOrderDialogComponent } from '../../orders/pay-order-dialog/pay-order-dialog.component';
import { DeskPurchaseDeferredPaymentDialogComponent } from '../../orders/desk-purchase-deferred-payment-dialog/desk-purchase-deferred-payment-dialog.component';
import { ConfirmationDialogComponent } from '@shared/components/confirmation-dialog/confirmation-dialog.component';
import { ClientDepositDialogComponent } from '../client-deposit-dialog/client-deposit-dialog.component';
import { ClientOpeningDebitDialogComponent } from '../client-opening-debit-dialog/client-opening-debit-dialog.component';
import { ClientPayClientDialogComponent } from '../client-pay-client-dialog/client-pay-client-dialog.component';
import { normalizeMongoId } from '@core/utils/mongo-id.util';

export type ClientHistoryDialogData = { client: Client; forcedBranchId?: string | null };

@Component({
  selector: 'app-client-history-dialog',
  templateUrl: './client-history-dialog.component.html',
  styleUrls: ['./client-history-dialog.component.scss'],
})
export class ClientHistoryDialogComponent implements OnInit {
  loading = true;
  settling = false;
  exportingPdf = false;
  history: ClientHistoryResponse | null = null;
  /** Branch for cash-drawer attribution (deposits / credit invoice payments). */
  paymentBranchId: string | null = null;
  showBranchPicker = false;
  branches: Branch[] = [];

  constructor(
    private userService: UserSerivce,
    private branchesService: BranchesServce,
    private auth: AuthenticationService,
    private translate: TranslateService,
    private notify: AppNotificationService,
    private accountHistoryPdf: AccountHistoryPdfService,
    private ref: MatDialogRef<ClientHistoryDialogComponent>,
    private storeSettings: StoreSettingsService,
    private dialog: MatDialog,
    private router: Router,
    @Inject(MAT_DIALOG_DATA) public data: ClientHistoryDialogData
  ) {
    const actor = this.auth.getUserFromLocalStorage();
    const ctx = resolveActorBranchContext(actor, data.forcedBranchId);
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
    this.loadHistory();
  }

  onPaymentBranchChange(branchId: string): void {
    this.paymentBranchId = String(branchId || '').trim() || null;
  }

  get settlementPreview(): ClientSettlementPreview | null {
    return this.history?.settlementPreview || null;
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
    if (!this.history?.canSettle || this.settling) return;
    const id = this.data.client._id;
    if (!id) return;

    this.settling = true;
    const u = this.auth.getUserFromLocalStorage();
    this.userService.settleClientBalances(String(id), { userId: u?._id }).subscribe({
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
        this.loadHistory();
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

  canSetOpeningDebit(): boolean {
    const hasOpeningLedger = (this.history?.ledgerEntries || []).some(
      (e) => e.type === 'opening_debit'
    );
    return !hasOpeningLedger && (this.history?.owesFromOpeningBalance || 0) <= 0.005;
  }

  openOpeningDebitDialog(): void {
    const ref = this.dialog.open(ClientOpeningDebitDialogComponent, {
      width: '480px',
      maxWidth: '96vw',
      data: { client: this.data.client },
      disableClose: true,
    });
    ref.afterClosed().subscribe((saved) => {
      if (saved) this.loadHistory();
    });
  }

  loadHistory(): void {
    const id = this.data.client._id;
    if (!id) return;
    this.loading = true;
    this.userService.getClientHistory(String(id)).subscribe({
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

  orderPaid(order: ClientHistoryOrderRow): number {
    return orderDisplayPaid(order as any);
  }

  orderRemaining(order: ClientHistoryOrderRow): number {
    return order.remaining ?? orderDisplayRemaining(order as any);
  }

  isCreditFullySettled(order: ClientHistoryOrderRow): boolean {
    return isPayLaterSettled(order as any);
  }

  paymentStatusLabel(status?: string, order?: ClientHistoryOrderRow): string {
    if (order && this.isCreditFullySettled(order) && order.status !== 'restored') {
      return this.translate.instant('tr_credit_fully_settled');
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

  goToSalesInvoice(orderNumber?: number | string | null): void {
    if (orderNumber == null || orderNumber === '') return;
    this.ref.close(false);
    this.router.navigate(['/orders'], {
      queryParams: { section: 'sales', search: String(orderNumber) },
    });
  }

  goToPurchaseInvoice(purchaseId?: string | null): void {
    const id = normalizeMongoId(purchaseId);
    if (!id) return;
    this.ref.close(false);
    this.router.navigate(['/orders'], {
      queryParams: { section: 'purchases', search: id },
    });
  }

  canPayOrder(order: ClientHistoryOrderRow): boolean {
    if (!order?._id || order.status === 'restored') return false;
    if (!isPayLaterMethod(order.paymentMethod) && !order.isPayLater) return false;
    return this.orderRemaining(order) > 0.005;
  }

  openPayOrderDialog(order: ClientHistoryOrderRow): void {
    if (!this.paymentBranchId) {
      this.notify.push(this.translate.instant('tr_branch_required'), 'error');
      return;
    }
    const ref = this.dialog.open(PayOrderDialogComponent, {
      width: '520px',
      maxWidth: '96vw',
      panelClass: 'pay-order-dialog-panel',
      backdropClass: 'pay-order-dialog-backdrop',
      data: { order: order as Order, forcedBranchId: this.paymentBranchId },
      disableClose: true,
    });
    ref.afterClosed().subscribe((ok) => {
      if (ok) this.loadHistory();
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
        partyName: String(this.data.client?.name || '').trim(),
        productName: row.productName || '',
        requestDate: row.createdAt,
        forcedBranchId: this.paymentBranchId,
      },
      disableClose: true,
    });
    ref.afterClosed().subscribe((ok) => {
      if (ok) this.loadHistory();
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
        client: this.data.client,
        forcedBranchId: this.paymentBranchId,
        maxAmount: this.maxPayClientAmount(),
      },
      disableClose: true,
    });
    ref.afterClosed().subscribe((ok) => {
      if (ok) this.loadHistory();
    });
  }

  openDepositDialog(): void {
    if (!this.paymentBranchId) {
      this.notify.push(this.translate.instant('tr_branch_required'), 'error');
      return;
    }
    this.dialog
      .open(ClientDepositDialogComponent, {
        width: '520px',
        maxWidth: '96vw',
        data: { client: this.data.client, forcedBranchId: this.paymentBranchId },
        disableClose: true,
      })
      .afterClosed()
      .subscribe((saved) => {
        if (saved) {
          this.loadHistory();
        }
      });
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

  async exportPdf(): Promise<void> {
    if (!this.history || this.exportingPdf) return;
    this.exportingPdf = true;
    try {
      await this.accountHistoryPdf.exportClientHistory(
        this.data.client,
        this.history,
        this.translate,
        {
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
        }
      );
    } catch {
      this.notify.push(this.translate.instant('tr_unexpected_error_message'), 'error');
    } finally {
      this.exportingPdf = false;
    }
  }

  close(): void {
    this.ref.close(false);
  }
}
