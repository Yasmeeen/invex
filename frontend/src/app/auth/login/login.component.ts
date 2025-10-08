import { AppNotificationService } from '@shared/services/app-notification.service';
import { IUserLogin, User, UserDetailsLogin } from '@core/models/users-interfaces.model';
import { Component, OnInit, NgZone, ElementRef, ViewChild } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { FormGroup, FormBuilder, FormControl, Validators, NgForm } from '@angular/forms';
import { TranslateService } from '@ngx-translate/core';
import { AuthenticationService } from 'src/app/core/services/authentication.service';
import { Globals } from 'src/app/core/globals';
import { Role } from '@core/base/enum';

@Component({
    selector: 'login-components',
    templateUrl: './login.component.html',
    styleUrls: ['./login.component.scss']
})
export class LoginComponent implements OnInit {
    triedToLogin: boolean = false;
    returnUrl: string;
    protected aFormGroup?: FormGroup;
    loginValidationForm?:  FormGroup;
    formSubmitted: boolean = false;
    user:IUserLogin = new UserDetailsLogin()
    isLoading: boolean = true;
    loginError:boolean = false;
    errorMessage?: string;
    show:boolean = false;
    roleEnum = Role;

    constructor(
        private router: Router,
        public globals: Globals,
        private authenticationService:AuthenticationService,
        private appNotificationService: AppNotificationService
    ) {
        document.querySelector('body')?.setAttribute('dir', 'ltr');
    }

    ngOnInit() {

    }

    onSubmit() {
        if (!this.user.password || !this.user.email || this.user.password == "" || this.user.email == "") {
            return;
        }
        const user:IUserLogin = {
          email: this.user.email ,
          password: this.user.password
        }
        this.authenticationService.login(user).subscribe(() => {
          if(this.globals.currentUser.role == 'Employee'){
            this.router.navigate(['orders']);
          }
          else {
            this.router.navigate(['home']);
          }
 
          });
    }




    getIsSuperInnovationAdmin(user:User){
      return user.name == "superInnovation"
    }

  //   register() {
  //     if (!this.user.password || !this.user.email || this.user.password == "" || this.user.email == "") {
  //         return;
  //     }
  //     const user:User = {
  //       name:"yasmin abdelhay",
  //       email: this.user.email ,
  //       role: this.roleEnum.SuperInnovationAdmin,
  //       local: 'en'

  //     }
  //     this.authenticationService.register(user).subscribe(() => {
  //         this.router.navigate(['home']);
  //       });
  // }
}
