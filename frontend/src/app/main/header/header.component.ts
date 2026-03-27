import { Component, ElementRef, EventEmitter, HostListener, OnInit, Output } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { LanguageSwitcherComponent } from '@shared/components/language-switcher/language-switcher.component';
import { Globals } from 'src/app/core/globals';
import { AuthenticationService } from 'src/app/core/services/authentication.service';
import { StoreSettingsService } from '@shared/services/store-settings.service';

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

  constructor(
    private globals: Globals,
    private translate: TranslateService,
    private authenticationService: AuthenticationService,
    private dialog: MatDialog,
    private hostEl: ElementRef<HTMLElement>,
    public storeSettings: StoreSettingsService
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
  }

  setUserLanguage() {
    const userLocal =   this.currentUser.locale
    document.querySelector('body')?.setAttribute('dir', userLocal == 'ar' ? 'rtl' : 'ltr');
    this.translate.use(userLocal);
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
