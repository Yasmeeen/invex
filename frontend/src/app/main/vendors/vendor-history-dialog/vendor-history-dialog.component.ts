import { Component, Inject, OnInit } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import {
  Vendor,
  VendorHistoryResponse,
  VendorPurchasingRequestRow,
  VendorSettlementPreview,
} from '@core/models/products.model';
import { AuthenticationService } from '@core/services/authentication.service';
import { TranslateService } from '@ngx-translate/core';
import { ConfirmationDialogComponent } from '@shared/components/confirmation-dialog/confirmation-dialog.component';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { VendorsSerivce } from '@shared/services/vendors.service';
import { VendorDepositDialogComponent } from '../vendor-deposit-dialog/vendor-deposit-dialog.component';

export type VendorHistoryDialogData = { vendor: Vendor };

@Component({
  selector: 'app-vendor-history-dialog',
  templateUrl: './vendor-history-dialog.component.html',
  styleUrls: ['./vendor-history-dialog.component.scss'],
})
export class VendorHistoryDialogComponent implements OnInit {
  loading = true;
  settling = false;
  recordingDeferredId: string | null = null;
  deferredPaymentDraft: Record<string, number> = {};
  history: VendorHistoryResponse | null = null;

  constructor(
    private vendors: VendorsSerivce,
    private auth: AuthenticationService,
    private translate: TranslateService,
    private notify: AppNotificationService,
    private dialog: MatDialog,
    private ref: MatDialogRef<VendorHistoryDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: VendorHistoryDialogData
  ) {}

  ngOnInit(): void {
    this.loadHistory();
  }

  get settlementPreview(): VendorSettlementPreview | null {
    return this.history?.settlementPreview || null;
  }

  loadHistory(): void {
    const id = this.data.vendor._id;
    if (!id) return;
    this.loading = true;
    this.vendors.getVendorHistory(String(id)).subscribe({
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
    if (!this.history?.canSettle || this.settling) return;
    const id = this.data.vendor._id;
    if (!id) return;

    this.settling = true;
    const u = this.auth.getUserFromLocalStorage();
    this.vendors
      .settleVendorBalances(String(id), { userId: u?._id })
      .subscribe({
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
          this.loadHistory();
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

  openDepositDialog(): void {
    this.dialog
      .open(VendorDepositDialogComponent, {
        width: '480px',
        maxWidth: '96vw',
        data: { vendor: this.data.vendor },
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
        return this.translate.instant('tr_vendor_ledger_deposit');
      case 'settlement':
        return this.translate.instant('tr_vendor_ledger_settlement');
      case 'order_payment':
        return this.translate.instant('tr_vendor_ledger_payment');
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

  recordDeferredPayment(pr: VendorPurchasingRequestRow): void {
    const id = this.data.vendor._id;
    const prId = pr._id;
    if (!id || !prId || this.recordingDeferredId) return;

    const amount = Number(this.deferredPaymentDraft[prId]);
    if (!Number.isFinite(amount) || amount <= 0) {
      this.notify.push(this.translate.instant('tr_vendor_deferred_amount_required'), 'error');
      return;
    }

    this.recordingDeferredId = prId;
    const u = this.auth.getUserFromLocalStorage();
    this.vendors
      .recordDeferredPurchasePayment(String(id), {
        purchasingRequestId: String(prId),
        amount,
        userId: u?._id,
      })
      .subscribe({
        next: () => {
          this.recordingDeferredId = null;
          delete this.deferredPaymentDraft[prId];
          this.notify.push(this.translate.instant('tr_vendor_deferred_payment_ok'), 'success');
          this.loadHistory();
        },
        error: (err) => {
          this.recordingDeferredId = null;
          const msg =
            err?.error?.message ||
            this.translate.instant('tr_unexpected_error_message');
          this.notify.push(msg, 'error');
        },
      });
  }

  close(): void {
    this.ref.close(false);
  }
}
