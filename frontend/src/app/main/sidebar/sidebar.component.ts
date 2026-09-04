import { Component, EventEmitter, OnDestroy, OnInit, Output } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';
import { AuthenticationService } from '@core/services/authentication.service';
import {
  AdminSidebar,
  BranchManagerSidebar,
  Cashier,
  CoAdminSidebar,
  CollectorSidebar,
  ModeratorSidebar,
  Warehouse,
} from '@shared/resources';
import { canPickBranchRole, isBranchManager, isModerator, isWarehouse } from '@core/utils/role-utils';
import { Globals } from 'src/app/core/globals';
import { StoreSettingsService } from '@shared/services/store-settings.service';
import { ProductsSerivce } from '@shared/services/products.service';
import { RealtimeNotificationsService } from '@shared/services/realtime-notifications.service';
import { CollectionsService } from '@shared/services/collections.service';

@Component({
  selector: 'app-sidebar',
  templateUrl: './sidebar.component.html',
  styleUrls: ['./sidebar.component.scss']
})
export class SidebarComponent implements OnInit, OnDestroy {
  appSidebar: SidebarItem [];
  private baseSidebar: SidebarItem[] = [];
  actortypr: any;
  currentUserType:any;
  levelName = '';
  user: any = [{}];
  /** Desktop-only narrow sidebar */
  isCollapsed = false;
  @Output() collapsedChange = new EventEmitter<boolean>();

  private readonly collapseStorageKey = 'appSidebarCollapsed';
  private readonly pendingTransfersLink = '/products/branch-transfers';
  private readonly slaughterLink = '/slaughter';
  private readonly trimLink = '/trim';
  private readonly installmentOnlyLinks = new Set([
    '/collections',
    '/collections/due',
    '/reports/installments',
  ]);
  private subscriptions: Subscription[] = [];
  private hasSaleInstallments = false;

  constructor(
      public globals: Globals,
      public storeSettings: StoreSettingsService,
      private authenticationService: AuthenticationService,
      private productsService: ProductsSerivce,
      private realtime: RealtimeNotificationsService,
      private router: Router,
      private collectionsService: CollectionsService
  ) {
    globals.currentUser = this.authenticationService.getUserFromLocalStorage();
    const role = globals.currentUser?.role;
    if (isModerator(role)) {
      this.baseSidebar = ModeratorSidebar;
    } else if (isWarehouse(role)) {
      this.baseSidebar = Warehouse;
    } else if (globals.currentUser.role == 'Cashier'){
      this.baseSidebar = Cashier;
    } else if (globals.currentUser.role === 'Collector') {
      this.baseSidebar = CollectorSidebar;
    }
    else if (globals.currentUser.role === 'Co Admin') {
      this.baseSidebar = CoAdminSidebar;
    } else if (globals.currentUser.role === 'Branch Manager') {
      this.baseSidebar = BranchManagerSidebar;
    }
    else{
      this.baseSidebar = AdminSidebar;
    }
    this.appSidebar = this.filterSidebar(this.baseSidebar);

    this.subscriptions.push(
      this.storeSettings.settings$.subscribe(() => {
        this.appSidebar = this.filterSidebar(this.baseSidebar);
      })
    );

  }

  ngOnInit() {
    const saved = localStorage.getItem(this.collapseStorageKey);
    if (saved === 'true') {
      this.isCollapsed = true;
      this.collapsedChange.emit(true);
    }

    this.refreshPendingTransferCount();

    this.subscriptions.push(
      this.collectionsService.hasInstallments().subscribe({
        next: (has) => {
          this.hasSaleInstallments = has;
          this.appSidebar = this.filterSidebar(this.baseSidebar);
        },
        error: () => {
          this.hasSaleInstallments = false;
          this.appSidebar = this.filterSidebar(this.baseSidebar);
        },
      })
    );

    this.subscriptions.push(
      this.realtime.newNotification$.subscribe((n) => {
        if (String(n?.type || '').startsWith('branch_transfer')) {
          this.refreshPendingTransferCount();
        }
      })
    );

    this.subscriptions.push(
      this.router.events
        .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
        .subscribe((e) => {
          if (String(e.urlAfterRedirects || e.url || '').includes(this.pendingTransfersLink)) {
            this.refreshPendingTransferCount();
          }
        })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach((s) => s.unsubscribe());
  }

  get showsPendingTransfersBadge(): boolean {
    const role = this.globals.currentUser?.role as string | undefined;
    return canPickBranchRole(role) || isBranchManager(role) || isWarehouse(role);
  }

  isPendingTransfersLink(link: SidebarItem): boolean {
    return link?.routerLink === this.pendingTransfersLink;
  }

  /** Parent accordion shows badge when a child is the pending-transfers route. */
  hasPendingTransfersIn(link: SidebarItem): boolean {
    if (this.isPendingTransfersLink(link)) {
      return true;
    }
    return !!link?.children?.some((c) => this.isPendingTransfersLink(c));
  }

  refreshPendingTransferCount(): void {
    if (!this.showsPendingTransfersBadge) {
      this.globals.pendingBranchTransferCount = 0;
      return;
    }
    const uid = this.globals.currentUser?._id;
    if (!uid) {
      this.globals.pendingBranchTransferCount = 0;
      return;
    }
    this.productsService.getPendingBranchTransferCount(String(uid)).subscribe({
      next: (r) => {
        this.globals.pendingBranchTransferCount = Number(r?.count) || 0;
      },
      error: () => {},
    });
  }

  get userDisplayName(): string {
    const u = this.globals?.currentUser as unknown as Record<string, string> | undefined;
    if (!u) return '';
    return (u['name'] || u['username'] || u['email'] || 'User').toString();
  }

  get userInitials(): string {
    const name = this.userDisplayName.trim();
    if (!name) return '?';
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase().slice(0, 2);
    }
    return name.slice(0, 2).toUpperCase();
  }

  get userRoleLabel(): string {
    const r = this.globals?.currentUser?.role as string | undefined;
    return r ? String(r) : '';
  }

  toggleCollapse(): void {
    if (typeof window !== 'undefined' && window.innerWidth <= 991) {
      return;
    }
    this.isCollapsed = !this.isCollapsed;
    localStorage.setItem(this.collapseStorageKey, String(this.isCollapsed));
    this.collapsedChange.emit(this.isCollapsed);
  }
  toggleChildren(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    const t = event.target as HTMLElement | null;
    const row = t?.closest('.anchor-container');
    row?.classList.toggle('children-active');
  }

  /** Expand/collapse section when clicking parent row (no route). */
  toggleParentSection(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    const host = (event.currentTarget as HTMLElement) || (event.target as HTMLElement)?.closest('.link-content--nonav');
    const row = host?.closest('.anchor-container');
    row?.classList.toggle('children-active');
  }
  closeSidebar() {
    document.body.classList.remove('sidebar-active');
  }

  private filterSidebar(items: SidebarItem[]): SidebarItem[] {
    const butcherOn = this.storeSettings.butcherFeaturesEnabled;
    let filtered = items;
    if (this.hasSaleInstallments) {
      filtered = items;
    } else {
      filtered = items
        .map((item) => {
          if (!item.children?.length) {
            return item;
          }
          return {
            ...item,
            children: this.filterSidebar(item.children),
          };
        })
        .filter((item) => {
          if (this.installmentOnlyLinks.has(String(item.routerLink || ''))) {
            return false;
          }
          if (item.routerLink === 'null' && item.children && !item.children.length) {
            return false;
          }
          return true;
        });
    }
    if (!butcherOn) {
      filtered = filtered
        .map((item) => {
          if (!item.children?.length) {
            return item;
          }
          return {
            ...item,
            children: item.children.filter(
              (c) => c.routerLink !== this.slaughterLink && c.routerLink !== this.trimLink
            ),
          };
        })
        .filter(
          (item) => item.routerLink !== this.slaughterLink && item.routerLink !== this.trimLink
        );
    }
    return filtered;
  }


}
 interface SidebarItem {
  name: string;
  routerLink: string;
  icon: string;
  children?: SidebarItem[]; // optional nested items
}
