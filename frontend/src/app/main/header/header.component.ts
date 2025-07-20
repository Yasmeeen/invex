import { Component, OnInit } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { LanguageSwitcherComponent } from '@shared/components/language-switcher/language-switcher.component';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { Globals } from 'src/app/core/globals';
import { AuthenticationService } from 'src/app/core/services/authentication.service';
import { BASE_URL } from '@core/base/urls';
import { UserSerivce } from '@shared/services/user.service';

@Component({
  selector: 'app-header',
  templateUrl: './header.component.html',
  styleUrls: ['./header.component.scss']
})
export class HeaderComponent implements OnInit {
  currentUser: any;
  user: any;
  selectedLanguage: any;
  avatarURL: any;
  userInfo: any

  constructor(
    private globals: Globals,
    private userService: UserSerivce,
    private translate: TranslateService,
    private authenticationService: AuthenticationService,
    private appNotificationService: AppNotificationService,
    private dialog: MatDialog
  ) { }

  ngOnInit(): void {
    // this.avatarURL = BASE_URL + this.globals.currentSchool.avatar_url;
    // this.currentUser = this.authenticationService.getCurrentUser();
    this.setUserLanguage();
    // this.getUserInfo();
  }
  getUserInfo() {
 
  }

  setUserLanguage() {
    const userLocal = this.authenticationService.currentUser.local
    document.querySelector('body')?.setAttribute('dir', userLocal == 'ar' ? 'rtl' : 'ltr');
    // this.translate.use('en');
    // this.userService.getCurrentUser(this.currentUser.id).subscribe(Response => {
    //   this.user = Response;
    //   this.globals.currentUser.locale = this.user.locale;
    //   this.selectedLanguage = this.user.locale;
    //   localStorage.setItem('currentUser', JSON.stringify(this.globals.currentUser));
    //   this.translate.use(this.user.locale);
    //   document.querySelector('body')?.setAttribute('dir', this.user.locale !== 'ar' ? 'ltr' : 'rtl');
    // });
  }

  logout() {
    this.authenticationService.logout();
  }
  openChangeLanguageDailog() {
    const dialogRef = this.dialog.open(LanguageSwitcherComponent, {
        width: '400px',
        data: this.globals.currentUser.locale,
        disableClose: true,
    });
}
  openSidebar() {
    document.body.classList.add('sidebar-active');
  }
}
