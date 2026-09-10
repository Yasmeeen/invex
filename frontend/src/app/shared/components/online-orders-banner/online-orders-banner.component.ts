import { Component, Input, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Subscription, interval } from 'rxjs';
import { OnlineOrdersAlertService } from '@shared/services/online-orders-alert.service';

@Component({
  selector: 'app-online-orders-banner',
  templateUrl: './online-orders-banner.component.html',
  styleUrls: ['./online-orders-banner.component.scss'],
})
export class OnlineOrdersBannerComponent implements OnInit, OnDestroy {
  /** Extra class hook — e.g. cashier embeds it under the header. */
  @Input() variant: 'global' | 'cashier' = 'global';

  pendingCount = 0;
  overdue = false;
  private sub?: Subscription;
  private tickSub?: Subscription;

  constructor(
    private onlineOrdersAlert: OnlineOrdersAlertService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.syncFromAlert();
    this.sub = this.onlineOrdersAlert.state$.subscribe(() => this.syncFromAlert());
    // Re-evaluate overdue locally so the banner flips red without waiting for the next poll.
    this.tickSub = interval(15000).subscribe(() => this.syncOverdue());
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    this.tickSub?.unsubscribe();
  }

  get visible(): boolean {
    return this.onlineOrdersAlert.canSeeBanner && this.pendingCount > 0;
  }

  openOnlineOrders(): void {
    this.router.navigate(['/online-orders'], { queryParams: { status: 'pending' } });
  }

  private syncFromAlert(): void {
    this.pendingCount = this.onlineOrdersAlert.pendingCount;
    this.syncOverdue();
  }

  private syncOverdue(): void {
    this.overdue = this.onlineOrdersAlert.isOverdue();
  }
}
