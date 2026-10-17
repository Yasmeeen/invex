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
  /** Hides banner until pending count rises again (new order). */
  private dismissedAtCount: number | null = null;
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
    if (!this.onlineOrdersAlert.canSeeBanner || this.pendingCount <= 0) {
      return false;
    }
    if (this.dismissedAtCount !== null && this.pendingCount <= this.dismissedAtCount) {
      return false;
    }
    return true;
  }

  openOnlineOrders(): void {
    this.router.navigate(['/online-orders'], { queryParams: { status: 'pending' } });
  }

  dismiss(event?: Event): void {
    event?.stopPropagation();
    this.dismissedAtCount = this.pendingCount;
  }

  private syncFromAlert(): void {
    const next = this.onlineOrdersAlert.pendingCount;
    if (this.dismissedAtCount !== null && next > this.dismissedAtCount) {
      this.dismissedAtCount = null;
    }
    if (next <= 0) {
      this.dismissedAtCount = null;
    }
    this.pendingCount = next;
    this.syncOverdue();
  }

  private syncOverdue(): void {
    this.overdue = this.onlineOrdersAlert.isOverdue();
  }
}
