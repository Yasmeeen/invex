import { TranslateService } from '@ngx-translate/core';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { IUserLogin, UserDetailsLogin } from '@core/models/users-interfaces.model';
import { Component, OnInit } from '@angular/core';
import { AuthenticationService } from 'src/app/core/services/authentication.service';

@Component({
    selector: 'update-password-components',
    templateUrl: './update-password.component.html',
    styleUrls: ['./update-password.component.scss']
})
export class UpdatePasswordComponent implements OnInit {
    triedToLogin: boolean = false;
    returnUrl: string;
    formSubmitted: boolean = false;
    user: IUserLogin  = new UserDetailsLogin();
    isLoading: boolean = true;
    loginError:boolean = false;
    errorMessage?: string;
    show:boolean = false;
    constructor(
        private authenticationService: AuthenticationService,
        private appNotificationService: AppNotificationService,
        private translateService: TranslateService
    ) {
        document.querySelector('body')?.setAttribute('dir', 'ltr');
    }

    ngOnInit() {

    }

    vaildWeekPassword() {
      return new RegExp("^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#\$%\^&\*])(?=.{8,})")
    }

    onSubmit() {
        if (!this.user.password || !this.user.confirmPassword || this.user.password == "" || this.user.confirmPassword == "") {
            return;
        }


      if (this.user.password != this.user.confirmPassword) {
          this.appNotificationService.push('Password Does Not Match!', 'error');
          return;
      }
      if (!this.vaildWeekPassword().test(this.user.password)) {
          this.appNotificationService.push(this.translateService.instant('Your password  must be 8 characters at least and include at least one upper , lower , number and a symbol characte'), 'error')
          return;
      }

        const user:IUserLogin = {
          id: this.authenticationService.currentUser?._id,
          email: this.authenticationService.currentUser?.email,
          password: this.user.password,
          confirmPassword: this.user.confirmPassword,

        }
        this.authenticationService.updatePassword(user).subscribe(() => {
          this.appNotificationService.push(
            this.translateService.instant('tr_password_updated_successfuly'),
            'success'
          );
          this.authenticationService.logout();
        });
    }
}
