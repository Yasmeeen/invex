import { Component, OnInit } from '@angular/core';
import { AdminSidebar } from '@shared/resources';
import { Globals } from 'src/app/core/globals';

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
  constructor(
      public globals: Globals
  ) {
      this.appSidebar = AdminSidebar;
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
