import { Component, OnInit } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { Router } from '@angular/router';
import { ConfirmationDialogComponent } from '@shared/components/confirmation-dialog/confirmation-dialog.component';
import { AppNotificationService } from '@shared/services/app-notification.service';
import {
  OnlineOrdersService,
  OnlineOrderStatus,
} from '@shared/services/online-orders.service';

@Component({
  selector: 'app-online-orders-page',
  templateUrl: './online-orders-page.component.html',
  styleUrls: ['./online-orders-page.component.scss'],
})
export class OnlineOrdersPageComponent implements OnInit {
  orders: any[] = [];
  selectedOrder: any = null;
  loading = false;
  actionLoading = false;
  status = '';
  page = 1;
  totalPages = 1;

  constructor(
    private onlineOrders: OnlineOrdersService,
    private notifications: AppNotificationService,
    private router: Router,
    private dialog: MatDialog,
    private translate: TranslateService
  ) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.onlineOrders
      .list({ page: this.page, perPage: 30, status: this.status })
      .subscribe({
        next: (response) => {
          this.orders = response?.orders || [];
          this.totalPages = response?.meta?.totalPages || 1;
          this.loading = false;
          if (this.selectedOrder) {
            const updated = this.orders.find((item) => item._id === this.selectedOrder._id);
            if (updated) this.selectedOrder = updated;
          }
        },
        error: (error) => {
          this.loading = false;
          this.notifications.push(error?.error?.error || 'Failed to load online orders', 'error');
        },
      });
  }

  select(order: any): void {
    this.selectedOrder = order;
    this.onlineOrders.get(order._id).subscribe({
      next: (response) => (this.selectedOrder = response?.order || order),
    });
  }

  age(createdAt: string): string {
    const minutes = Math.max(
      0,
      Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000)
    );
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    return `${Math.floor(hours / 24)}d`;
  }

  nextStatus(order: any): OnlineOrderStatus | null {
    if (order?.status === 'pending') return 'preparing';
    if (order?.status === 'preparing') return 'ready';
    if (order?.status === 'ready') return 'completed';
    return null;
  }

  advance(order: any): void {
    const next = this.nextStatus(order);
    if (!next) return;
    if (next === 'completed') {
      this.dialog
        .open(ConfirmationDialogComponent, {
          width: '460px',
          disableClose: true,
          data: {
            title: this.translate.instant('tr_online_order_invoice_confirm_title'),
            message: this.translate.instant('tr_online_order_invoice_confirm_message'),
            buttons: [
              {
                label: this.translate.instant('tr_cancel'),
                actionCallback: 'cancel',
                type: 'btn-secondary',
              },
              {
                label: this.translate.instant('tr_online_order_create_invoice'),
                actionCallback: 'confirm',
                type: 'btn-primary',
              },
            ],
          },
        })
        .afterClosed()
        .subscribe((result) => {
          if (result === 'confirm') this.changeStatus(order, next);
        });
      return;
    }
    this.changeStatus(order, next);
  }

  cancel(order: any): void {
    if (!window.confirm('Cancel this online order and release its stock reservations?')) return;
    this.changeStatus(order, 'cancelled');
  }

  changeStatus(order: any, status: OnlineOrderStatus): void {
    this.actionLoading = true;
    this.onlineOrders.updateStatus(order._id, status, order.paymentMethod).subscribe({
      next: (response) => {
        this.actionLoading = false;
        this.selectedOrder = response?.order || null;
        this.notifications.push('Online order updated', 'success');
        this.load();
      },
      error: (error) => {
        this.actionLoading = false;
        this.notifications.push(error?.error?.error || 'Status update failed', 'error');
      },
    });
  }

  openInvoice(order: any): void {
    if (!order?.invexOrderId) return;
    this.router.navigate(['/orders'], {
      queryParams: { search: order.invexInvoiceNumber || order.crmOrderNumber },
    });
  }

  setPage(page: number): void {
    if (page < 1 || page > this.totalPages || page === this.page) return;
    this.page = page;
    this.load();
  }
}
