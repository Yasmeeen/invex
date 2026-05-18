import { Component, OnInit } from '@angular/core';
import { NavigationEnd, Router, RouterEvent } from '@angular/router';
import { CurrentUser } from '@core/models/users-interfaces.model';
import { TranslateService } from '@ngx-translate/core';
import { UserSerivce } from '@shared/services/user.service';
import { Globals } from '../core/globals';
import { AuthenticationService } from '../core/services/authentication.service';
import { StoreSettingsService } from '@shared/services/store-settings.service';
import { isWarehouse } from '@core/utils/role-utils';

@Component({
    selector: 'app-main',
    templateUrl: './main.component.html',
    styleUrls: ['./main.component.scss'],
    standalone: false
})
export class MainComponent implements OnInit {

  currentUser:CurrentUser;
  arabicSelected: boolean = false;
  englishSelected: boolean = false;

  /** Narrow sidebar mode — synced from sidebar collapse control */
  sidebarCollapsed = false;
  /** Hide floating Vixa widget on /vixa page (page has its own full chat). */
  showFloatingVixa = true;
  /** Some roles should not see Vixa at all. */
  private hideVixaForRole = false;

  constructor(
      private router:Router,
      private translate: TranslateService,
      private storeSettingsService: StoreSettingsService
  ) {
      // this.currentUser = this.authenticationService.getCurrentUser();
      // globals.currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
      document.body.classList.add('admin_theme');


  }
  ngOnInit() {
      this.storeSettingsService.load();
    // Hide Vixa for warehouse (and legacy Operation Manager).
    try {
      const u: any = JSON.parse(localStorage.getItem('currentUser') || '{}');
      this.hideVixaForRole = isWarehouse(u?.role);
    } catch {
      this.hideVixaForRole = false;
    }
      this.router.events.subscribe((event: any) => {
          this.navigationInterceptor(event)
      })

  }



  // Shows and hides the loading spinner during RouterEvent changes
  navigationInterceptor(event: RouterEvent): void {
    if (event instanceof NavigationEnd) {
          this.showFloatingVixa =
            !this.hideVixaForRole &&
            !String(event.urlAfterRedirects || event.url || '').startsWith('/vixa');
          document.body.classList.remove('sidebar-active')
          let activeRouterMenus = document.querySelectorAll('.anchor-container');
          for (let i = 0; i < activeRouterMenus.length; i++) {
              activeRouterMenus[i].classList.remove('children-active');
          }
      }
  }

  onSidebarCollapsed(collapsed: boolean): void {
    this.sidebarCollapsed = collapsed;
  }
}
