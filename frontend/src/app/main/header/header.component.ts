import { Component, ElementRef, EventEmitter, HostListener, OnInit, Output } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { LanguageSwitcherComponent } from '@shared/components/language-switcher/language-switcher.component';
import { Globals } from 'src/app/core/globals';
import { AuthenticationService } from 'src/app/core/services/authentication.service';
import { StoreSettingsService } from '@shared/services/store-settings.service';
import { NotificationsService, NotificationItem } from '@shared/services/notifications.service';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { RealtimeNotificationsService } from '@shared/services/realtime-notifications.service';
import { ProductsSerivce } from '@shared/services/products.service';
import { ViewProductBookingDialogComponent } from '../products/view-product-booking-dialog/view-product-booking-dialog.component';
import { Product } from '@core/models/products.model';

@Component({
  selector: 'app-header',
  templateUrl: './header.component.html',
  styleUrls: ['./header.component.scss']
})
export class HeaderComponent implements OnInit {
  /** Desktop: collapse rail; mobile: open drawer */
  @Output() toggleDesktopSidebar = new EventEmitter<void>();

  currentUser: any;
  user: any;
  selectedLanguage: any;
  avatarURL: any;
  userInfo: any;

  userMenuOpen = false;
  fontSizeChoice: 'small' | 'medium' | 'large' = 'medium';

  constructor(
    public globals: Globals,
    private translate: TranslateService,
    private authenticationService: AuthenticationService,
    private dialog: MatDialog,
    private hostEl: ElementRef<HTMLElement>,
    public storeSettings: StoreSettingsService,
    private notificationsApi: NotificationsService,
    private notify: AppNotificationService,
    private realtime: RealtimeNotificationsService,
    private productsService: ProductsSerivce
  ) { }

  get userDisplayName(): string {
    const u = this.currentUser;
    if (!u) {
      return '';
    }
    return (u.name || u.username || u.email || 'User').toString();
  }

  get userInitials(): string {
    const name = this.userDisplayName.trim();
    if (!name) {
      return '?';
    }
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase().slice(0, 2);
    }
    return name.slice(0, 2).toUpperCase();
  }

  ngOnInit(): void {
    this.currentUser = this.authenticationService.getUserFromLocalStorage();
    this.globals.currentUser = this.authenticationService.getUserFromLocalStorage();
    this.setUserLanguage();
    this.loadAndApplyFontSize();
    this.refreshNotifications();
    this.realtime.newNotification$.subscribe((n) => {
      // Prepend so it shows immediately (no refresh needed)
      this.notifications = [n, ...(this.notifications || [])].slice(0, 20);
    });
  }

  notificationsLoading = false;
  notifications: NotificationItem[] = [];

  private get userId(): string | null {
    const u: any = this.authenticationService.getUserFromLocalStorage();
    return u?._id ? String(u._id) : null;
  }

  refreshNotifications(): void {
    const uid = this.userId;
    if (!uid) return;
    this.notificationsLoading = true;
    this.notificationsApi.list(uid, 1, 20).subscribe({
      next: (res) => {
        this.notifications = res.notifications || [];
        this.notificationsLoading = false;
        this.notificationsApi.unreadCount(uid).subscribe({
          next: (r) => (this.globals.unseenNotificationsCount = Number(r?.unreadCount) || 0),
          error: () => {},
        });
      },
      error: () => {
        this.notificationsLoading = false;
      },
    });
  }

  isUnread(n: NotificationItem): boolean {
    const uid = this.userId;
    if (!uid) return false;
    return !(n.readBy || []).some((x: any) => String(x) === String(uid));
  }

  openNotification(n: NotificationItem): void {
    const uid = this.userId;
    if (!uid) return;
    const afterRead = () => this.navigateFromNotification(n);

    if (!this.isUnread(n)) {
      afterRead();
      return;
    }

    this.notificationsApi.markRead(n._id, uid).subscribe({
      next: () => {
        this.globals.unseenNotificationsCount = Math.max(
          0,
          (this.globals.unseenNotificationsCount || 0) - 1
        );
        // Update local item state quickly
        n.readBy = [...(n.readBy || []), uid];
        afterRead();
      },
      error: () => {
        afterRead();
      },
    });
  }

  notificationIconClass(n: NotificationItem): string {
    if (n?.type === 'booking_confirmed') {
      return 'fa-check-circle';
    }
    if (n?.type === 'booking_created') {
      return 'fa-bookmark';
    }
    return 'fa-bell';
  }

  private navigateFromNotification(n: NotificationItem): void {
    if (n.type !== 'booking_created' && n.type !== 'booking_confirmed') {
      return;
    }
    const productId = n?.data?.productId;
    if (!productId) {
      return;
    }
    this.productsService.getProduct(productId).subscribe({
      next: (p: any) => {
        const product = p as Product;
        this.dialog.open(ViewProductBookingDialogComponent, {
          width: '680px',
          data: { product, canAddBooking: true },
          disableClose: true,
        });
      },
      error: () => {},
    });
  }

  markAllNotificationsRead(): void {
    const uid = this.userId;
    if (!uid) return;
    this.notificationsApi.markAllRead(uid).subscribe({
      next: () => {
        this.globals.unseenNotificationsCount = 0;
        this.notify.push(this.translate.instant('tr_marked_all_read'), 'success');
        this.refreshNotifications();
      },
      error: () => {
        this.notify.push(this.translate.instant('tr_unexpected_error_message'), 'error');
      },
    });
  }

  setUserLanguage() {
    const userLocal =   this.currentUser.locale
    document.querySelector('body')?.setAttribute('dir', userLocal == 'ar' ? 'rtl' : 'ltr');
    this.translate.use(userLocal);
  }

  private fontSizeStorageKey(): string {
    const uid = this.userId;
    return uid ? `ui.fontSize.${uid}` : 'ui.fontSize.guest';
  }

  loadAndApplyFontSize(): void {
    const raw = localStorage.getItem(this.fontSizeStorageKey());
    const v = raw === 'small' || raw === 'medium' || raw === 'large' ? raw : 'medium';
    this.fontSizeChoice = v;
    this.applyFontSize(v);
  }

  setFontSize(choice: 'small' | 'medium' | 'large'): void {
    this.fontSizeChoice = choice;
    localStorage.setItem(this.fontSizeStorageKey(), choice);
    this.applyFontSize(choice);
  }

  private applyFontSize(choice: 'small' | 'medium' | 'large'): void {
    const px = choice === 'small' ? '14px' : choice === 'large' ? '18px' : '16px';
    document.documentElement.style.setProperty('--app-font-size', px);

    // Keep sidebar readable when font is larger.
    const sidebarPx =
      choice === 'small' ? '250px' : choice === 'large' ? '310px' : '280px';
    document.documentElement.style.setProperty('--app-sidebar-width', sidebarPx);
    document.documentElement.style.setProperty('--app-sidebar-collapsed-width', '86px');
  }

  logout() {
    this.authenticationService.logout();
  }

  openChangeLanguageDailog() {
    const dialogRef = this.dialog.open(LanguageSwitcherComponent, {
        width: '400px',
        data: this.currentUser.locale,
        disableClose: true,
    });
}

  openSidebar() {
    document.body.classList.add('sidebar-active');
  }

  onMenuClick(): void {
    if (typeof window !== 'undefined' && window.innerWidth <= 991) {
      this.openSidebar();
    } else {
      this.toggleDesktopSidebar.emit();
    }
  }

  toggleUserMenu(event: MouseEvent): void {
    event.stopPropagation();
    this.userMenuOpen = !this.userMenuOpen;
  }

  closeUserMenu(): void {
    this.userMenuOpen = false;
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.userMenuOpen) {
      return;
    }
    const t = event.target as Node;
    if (this.hostEl.nativeElement.contains(t)) {
      return;
    }
    this.userMenuOpen = false;
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.userMenuOpen = false;
  }
}
