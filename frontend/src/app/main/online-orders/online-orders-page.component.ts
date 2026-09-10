import { Component, OnInit } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ConfirmationDialogComponent } from '@shared/components/confirmation-dialog/confirmation-dialog.component';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { OnlineOrdersAlertService } from '@shared/services/online-orders-alert.service';
import {
  OnlineOrderChannel,
  OnlineOrderChannelCounts,
  OnlineOrdersService,
  OnlineOrderStatus,
} from '@shared/services/online-orders.service';
import {
  CompleteOnlineOrderDialogComponent,
  CompleteOnlineOrderDialogResult,
} from './complete-online-order-dialog/complete-online-order-dialog.component';

type DetailTab = 'details' | 'customer' | 'history';

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
  channel: OnlineOrderChannel | '' = '';
  search = '';
  showStatusFilter = false;
  detailTab: DetailTab = 'details';
  page = 1;
  perPage = 20;
  total = 0;
  totalPages = 1;
  channelCounts: OnlineOrderChannelCounts = { all: 0, crm: 0, website: 0 };
  selectedIds = new Set<string>();

  readonly channelTabs: Array<{ id: OnlineOrderChannel | ''; labelKey: string }> = [
    { id: '', labelKey: 'tr_online_orders_channel_all' },
    { id: 'crm', labelKey: 'tr_online_orders_channel_crm' },
    { id: 'website', labelKey: 'tr_online_orders_channel_website' },
  ];

  constructor(
    private onlineOrders: OnlineOrdersService,
    private onlineOrdersAlert: OnlineOrdersAlertService,
    private notifications: AppNotificationService,
    private router: Router,
    private route: ActivatedRoute,
    private dialog: MatDialog,
    private translate: TranslateService
  ) {}

  ngOnInit(): void {
    const statusFromQuery = String(this.route.snapshot.queryParamMap.get('status') || '').trim();
    if (statusFromQuery) {
      this.status = statusFromQuery;
    }
    const channelFromQuery = String(this.route.snapshot.queryParamMap.get('channel') || '').trim();
    if (channelFromQuery === 'crm' || channelFromQuery === 'website') {
      this.channel = channelFromQuery;
    }
    this.load();
  }

  load(): void {
    this.loading = true;
    this.onlineOrders
      .list({
        page: this.page,
        perPage: this.perPage,
        status: this.status,
        channel: this.channel,
        search: this.search.trim(),
      })
      .subscribe({
        next: (response) => {
          this.orders = response?.orders || [];
          this.total = response?.meta?.total || 0;
          this.totalPages = response?.meta?.totalPages || 1;
          this.channelCounts = {
            all: response?.channelCounts?.all ?? this.total,
            crm: response?.channelCounts?.crm ?? 0,
            website: response?.channelCounts?.website ?? 0,
          };
          this.loading = false;
          if (this.selectedOrder) {
            const updated = this.orders.find((item) => item._id === this.selectedOrder._id);
            if (updated) this.selectedOrder = { ...this.selectedOrder, ...updated };
          }
          this.onlineOrdersAlert.refresh();
        },
        error: (error) => {
          this.loading = false;
          this.notifications.push(error?.error?.error || 'Failed to load online orders', 'error');
        },
      });
  }

  channelCount(id: OnlineOrderChannel | ''): number {
    if (!id) return this.channelCounts.all;
    return this.channelCounts[id] || 0;
  }

  setChannel(id: OnlineOrderChannel | ''): void {
    if (this.channel === id) return;
    this.channel = id;
    this.page = 1;
    this.load();
  }

  onSearch(): void {
    this.page = 1;
    this.load();
  }

  toggleStatusFilter(): void {
    this.showStatusFilter = !this.showStatusFilter;
  }

  setStatus(status: string): void {
    this.status = status;
    this.page = 1;
    this.showStatusFilter = false;
    this.load();
  }

  select(order: any): void {
    this.detailTab = 'details';
    this.selectedOrder = order;
    this.onlineOrders.get(order._id).subscribe({
      next: (response) => (this.selectedOrder = response?.order || order),
    });
  }

  closeDetail(): void {
    this.selectedOrder = null;
  }

  toggleSelect(order: any, event: Event): void {
    event.stopPropagation();
    const id = String(order?._id || '');
    if (!id) return;
    if (this.selectedIds.has(id)) this.selectedIds.delete(id);
    else this.selectedIds.add(id);
  }

  isSelected(order: any): boolean {
    return this.selectedIds.has(String(order?._id || ''));
  }

  toggleSelectAll(event: Event): void {
    const checked = (event.target as HTMLInputElement)?.checked;
    if (checked) {
      this.orders.forEach((o) => this.selectedIds.add(String(o._id)));
    } else {
      this.orders.forEach((o) => this.selectedIds.delete(String(o._id)));
    }
  }

  allSelected(): boolean {
    return this.orders.length > 0 && this.orders.every((o) => this.selectedIds.has(String(o._id)));
  }

  age(createdAt: string): string {
    const minutes = Math.max(
      0,
      Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000)
    );
    if (minutes < 1) return this.translate.instant('tr_online_orders_just_now');
    if (minutes < 60) {
      return this.translate.instant('tr_online_orders_minutes_ago', { count: minutes });
    }
    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
      return this.translate.instant('tr_online_orders_hours_ago', { count: hours });
    }
    return this.translate.instant('tr_online_orders_days_ago', {
      count: Math.floor(hours / 24),
    });
  }

  formatTime(createdAt: string): string {
    if (!createdAt) return '';
    try {
      return new Date(createdAt).toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '';
    }
  }

  formatDateTime(createdAt: string): string {
    if (!createdAt) return '';
    try {
      return new Date(createdAt).toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '';
    }
  }

  orderChannel(order: any): OnlineOrderChannel {
    return order?.channel === 'website' ? 'website' : 'crm';
  }

  itemQtyLabel(item: any): string {
    const qty = Number(item?.quantity) || 0;
    if (item?.saleUnit === 'weight') {
      return `${qty}${item?.weightUnit || 'kg'}`;
    }
    if (item?.saleUnit === 'head') {
      return `${qty}`;
    }
    return `×${qty}`;
  }

  itemsCount(order: any): number {
    return (order?.items || []).length;
  }

  totalWeight(order: any): string {
    const items = order?.items || [];
    let kg = 0;
    let hasWeight = false;
    for (const item of items) {
      if (item?.saleUnit === 'weight') {
        hasWeight = true;
        const q = Number(item.quantity) || 0;
        kg += item.weightUnit === 'g' ? q / 1000 : q;
      }
    }
    if (!hasWeight) return '';
    return `${Math.round(kg * 1000) / 1000} kg`;
  }

  copyPhone(phone: string, event?: Event): void {
    event?.stopPropagation();
    const value = String(phone || '').trim();
    if (!value || !navigator?.clipboard) return;
    navigator.clipboard.writeText(value).then(
      () => this.notifications.push(this.translate.instant('tr_online_orders_copied'), 'success'),
      () => undefined
    );
  }

  nextStatus(order: any): OnlineOrderStatus | null {
    if (order?.status === 'pending') return 'preparing';
    if (order?.status === 'preparing') return 'ready';
    if (order?.status === 'ready') return 'completed';
    return null;
  }

  primaryActionLabel(order: any): string {
    if (order?.status === 'pending') return 'tr_online_order_confirm';
    if (order?.status === 'preparing') return 'tr_online_order_mark_ready';
    if (order?.status === 'ready') return 'tr_online_order_create_invoice';
    return '';
  }

  advance(order: any): void {
    const next = this.nextStatus(order);
    if (!next) return;
    if (next === 'completed') {
      this.dialog
        .open(CompleteOnlineOrderDialogComponent, {
          width: '460px',
          disableClose: true,
          data: { order },
        })
        .afterClosed()
        .subscribe((result: CompleteOnlineOrderDialogResult | undefined) => {
          if (result?.confirmed) {
            this.changeStatus(order, next, result.deliveryPersonName);
          }
        });
      return;
    }
    this.changeStatus(order, next);
  }

  cancel(order: any): void {
    this.dialog
      .open(ConfirmationDialogComponent, {
        width: '460px',
        disableClose: true,
        data: {
          title: this.translate.instant('tr_online_order_cancel_title'),
          message: this.translate.instant('tr_online_order_cancel_confirm'),
          buttons: [
            {
              label: this.translate.instant('tr_close'),
              actionCallback: 'dismiss',
              type: 'btn-secondary',
            },
            {
              label: this.translate.instant('tr_online_order_cancel_action'),
              actionCallback: 'confirm',
              type: 'btn-danger',
            },
          ],
        },
      })
      .afterClosed()
      .subscribe((result) => {
        if (result === 'confirm') this.changeStatus(order, 'cancelled');
      });
  }

  changeStatus(
    order: any,
    status: OnlineOrderStatus,
    deliveryPersonName?: string
  ): void {
    this.actionLoading = true;
    this.onlineOrders
      .updateStatus(order._id, status, order.paymentMethod, {
        deliveryPersonName,
      })
      .subscribe({
        next: (response) => {
          this.actionLoading = false;
          this.selectedOrder = response?.order || { ...order, status };
          this.notifications.push(
            this.translate.instant('tr_online_order_updated'),
            'success'
          );
          // Banner opens the page with ?status=pending — after confirm the order
          // would vanish from that filter. Clear it so the order stays visible.
          if (this.status && this.status !== status) {
            this.status = '';
            this.page = 1;
            this.router.navigate([], {
              relativeTo: this.route,
              queryParams: { status: null },
              queryParamsHandling: 'merge',
              replaceUrl: true,
            });
          }
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

  pageNumbers(): number[] {
    const max = Math.min(this.totalPages, 7);
    const pages: number[] = [];
    let start = Math.max(1, this.page - 3);
    let end = Math.min(this.totalPages, start + max - 1);
    start = Math.max(1, end - max + 1);
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  }

  rangeLabel(): string {
    if (!this.total) return '';
    const from = (this.page - 1) * this.perPage + 1;
    const to = Math.min(this.page * this.perPage, this.total);
    return this.translate.instant('tr_online_orders_range', {
      from,
      to,
      total: this.total,
    });
  }

  setPage(page: number): void {
    if (page < 1 || page > this.totalPages || page === this.page) return;
    this.page = page;
    this.load();
  }

  trackById(_: number, order: any): string {
    return String(order?._id || '');
  }
}
