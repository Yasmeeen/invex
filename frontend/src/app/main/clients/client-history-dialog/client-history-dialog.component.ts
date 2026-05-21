import { Component, Inject, OnInit } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
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
    if (String(method || '').toLowerCase() === 'credit') {
      return this.translate.instant('tr_pay_credit');
    }
    return method || '—';
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

  close(): void {
    this.ref.close(false);
  }
}
