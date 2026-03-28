import { Component, EventEmitter, OnInit, Output } from '@angular/core';
import { AuthenticationService } from '@core/services/authentication.service';
import { AdminSidebar, Cashier, CoAdminSidebar, Employee, OperationManager } from '@shared/resources';
import { Globals } from 'src/app/core/globals';
import { StoreSettingsService } from '@shared/services/store-settings.service';

@Component({
  selector: 'app-sidebar',
  templateUrl: './sidebar.component.html',
  styleUrls: ['./sidebar.component.scss']
})
export class SidebarComponent implements OnInit {
  appSidebar: SidebarItem [];
  actortypr: any;
  currentUserType:any;
  levelName = '';
  user: any = [{}];
  /** Desktop-only narrow sidebar */
  isCollapsed = false;
  @Output() collapsedChange = new EventEmitter<boolean>();

  private readonly collapseStorageKey = 'appSidebarCollapsed';
  constructor(
      public globals: Globals,
      public storeSettings: StoreSettingsService,
      private authenticationService: AuthenticationService
  ) {
    globals.currentUser = this.authenticationService.getUserFromLocalStorage();
    if(globals.currentUser.role == 'Employee'){
      this.appSidebar = Employee;
      
    }
    else if(globals.currentUser.role == 'Operation Manager'){ 
      this.appSidebar = OperationManager; 
    }
    else if(globals.currentUser.role == 'Cashier'){
      this.appSidebar = Cashier;
    }
    else if (globals.currentUser.role === 'Co Admin') {
      this.appSidebar = CoAdminSidebar;
    }
    else{
      this.appSidebar = AdminSidebar;
    }

  }

  ngOnInit() {
    const saved = localStorage.getItem(this.collapseStorageKey);
    if (saved === 'true') {
      this.isCollapsed = true;
      this.collapsedChange.emit(true);
    }
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


}
 interface SidebarItem {
  name: string;
  routerLink: string;
  icon: string;
  children?: SidebarItem[]; // optional nested items
}
