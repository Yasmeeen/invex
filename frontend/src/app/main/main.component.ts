import { Component, OnInit } from '@angular/core';
import { NavigationEnd, Router, RouterEvent } from '@angular/router';
import { CurrentUser } from '@core/models/users-interfaces.model';
import { TranslateService } from '@ngx-translate/core';
import { UserSerivce } from '@shared/services/user.service';
import { Globals } from '../core/globals';
import { AuthenticationService } from '../core/services/authentication.service';

@Component({
  selector: 'app-main',
  templateUrl: './main.component.html',
  styleUrls: ['./main.component.scss']
})
export class MainComponent implements OnInit {

  currentUser:CurrentUser;
  arabicSelected: boolean = false;
  englishSelected: boolean = false;
  constructor(
      private router:Router,
      private translate: TranslateService
  ) {
      // this.currentUser = this.authenticationService.getCurrentUser();
      // globals.currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
      document.body.classList.add('admin_theme');


  }
  ngOnInit() {
      this.router.events.subscribe((event: any) => {
          this.navigationInterceptor(event)
      })

  }



  // Shows and hides the loading spinner during RouterEvent changes
  navigationInterceptor(event: RouterEvent): void {
      if (event instanceof NavigationEnd) {
          document.body.classList.remove('sidebar-active')
          let activeRouterMenus = document.querySelectorAll('.anchor-container');
          for (let i = 0; i < activeRouterMenus.length; i++) {
              activeRouterMenus[i].classList.remove('children-active');
          }
      }
  }
}
