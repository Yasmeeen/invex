import { TranslateService } from '@ngx-translate/core';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { IUserLogin, User, UserDetailsLogin } from '@core/models/users-interfaces.model';
import { Component, OnInit, NgZone, ElementRef, ViewChild } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { FormGroup, FormBuilder, FormControl, Validators, NgForm } from '@angular/forms';
import { AuthenticationService } from 'src/app/core/services/authentication.service';
import { Globals } from 'src/app/core/globals';
import { Role } from '@core/base/enum';

@Component({
    selector: 'update-password-components',
    templateUrl: './update-password.component.html',
    styleUrls: ['./update-password.component.scss']
})
export class UpdatePasswordComponent implements OnInit {
    triedToLogin: boolean = false;
    returnUrl: string;
    protected aFormGroup?: FormGroup;
    loginValidationForm?:  FormGroup;
    formSubmitted: boolean = false;
    user: IUserLogin  = new UserDetailsLogin();
    isLoading: boolean = true;
    loginError:boolean = false;
    errorMessage?: string;
    show:boolean = false;
    roleEnum = Role;

    constructor(
        private router: Router,
        public globals: Globals,
        private authenticationService:AuthenticationService,
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
          this.appNotificationService.push(this.translateService.instant('tr_password_updated_successfuly'),'success')
            this.router.navigate(['home']);
          });
    }
}
