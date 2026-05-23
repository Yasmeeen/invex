import { Component, Inject, OnInit } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { Order } from '@core/models/products.model';
import { isPayLaterMethod } from '@core/utils/order-display.util';
import {
  Client,
  ClientHistoryOrderRow,
  ClientHistoryPurchaseRow,
  ClientHistoryResponse,
} from '@core/models/users-interfaces.model';
import { TranslateService } from '@ngx-translate/core';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { UserSerivce } from '@shared/services/user.service';
import { orderDisplayPaid, orderDisplayRemaining } from '@core/utils/order-display.util';
import { paymentMethodDisplayLabel } from '@shared/utils/cashier-payment-methods.util';
import { StoreSettingsService } from '@shared/services/store-settings.service';
import { PayOrderDialogComponent } from '../../orders/pay-order-dialog/pay-order-dialog.component';
import { DeskPurchaseDeferredPaymentDialogComponent } from '../../orders/desk-purchase-deferred-payment-dialog/desk-purchase-deferred-payment-dialog.component';
import { normalizeMongoId } from '@core/utils/mongo-id.util';

export type ClientHistoryDialogData = { client: Client };

@Component({
  selector: 'app-client-history-dialog',
  templateUrl: './client-history-dialog.component.html',
  styleUrls: ['./client-history-dialog.component.scss'],
})
export class ClientHistoryDialogComponent implements OnInit {
  loading = true;
  history: ClientHistoryResponse | null = null;

  constructor(
    private userService: UserSerivce,
    private translate: TranslateService,
    private notify: AppNotificationService,
    private ref: MatDialogRef<ClientHistoryDialogComponent>,
    private storeSettings: StoreSettingsService,
    private dialog: MatDialog,
    @Inject(MAT_DIALOG_DATA) public data: ClientHistoryDialogData
  ) {}

  ngOnInit(): void {
    this.loadHistory();
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

  paymentStatusLabel(status?: string): string {
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

  canPayOrder(order: ClientHistoryOrderRow): boolean {
    if (!order?._id || order.status === 'restored') return false;
    if (!isPayLaterMethod(order.paymentMethod) && !order.isPayLater) return false;
    return this.orderRemaining(order) > 0.005;
  }

  openPayOrderDialog(order: ClientHistoryOrderRow): void {
    const ref = this.dialog.open(PayOrderDialogComponent, {
      width: '520px',
      maxWidth: '96vw',
      panelClass: 'pay-order-dialog-panel',
      backdropClass: 'pay-order-dialog-backdrop',
      data: { order: order as Order },
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
        forcedBranchId: row.branch?._id,
      },
      disableClose: true,
    });
    ref.afterClosed().subscribe((ok) => {
      if (ok) this.loadHistory();
    });
  }

  close(): void {
    this.ref.close(false);
  }
}
