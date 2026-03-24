import { Component, EventEmitter, OnInit, Output } from '@angular/core';
import { AuthenticationService } from '@core/services/authentication.service';
import { AdminSidebar,Cashier,Employee, OperationManager } from '@shared/resources';
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

  toggleCollapse(): void {
    if (typeof window !== 'undefined' && window.innerWidth <= 991) {
      return;
    }
    this.isCollapsed = !this.isCollapsed;
    localStorage.setItem(this.collapseStorageKey, String(this.isCollapsed));
    this.collapsedChange.emit(this.isCollapsed);
  }
  toggleChildren(event:any) {
    event.preventDefault();
    event.stopPropagation();
    event.target.parentElement.classList.toggle('children-active');
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
