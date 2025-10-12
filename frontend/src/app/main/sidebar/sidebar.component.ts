import { Component, OnInit } from '@angular/core';
import { AuthenticationService } from '@core/services/authentication.service';
import { AdminSidebar,Employee } from '@shared/resources';
import { Globals } from 'src/app/core/globals';
import { environment } from 'src/environments/environment.prod';

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
  storeName = environment.storeName;
  constructor(
      public globals: Globals,
      private authenticationService: AuthenticationService
  ) {
    globals.currentUser = this.authenticationService.getUserFromLocalStorage();
    if(globals.currentUser.role == 'Employee'){
      this.appSidebar = Employee;
      
    }
    else{
      this.appSidebar = AdminSidebar;
    }

  }

  ngOnInit() {
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
