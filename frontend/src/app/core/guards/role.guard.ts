import { Injectable } from '@angular/core';
import { Router, CanActivateChild, ActivatedRouteSnapshot, CanActivate } from '@angular/router';
import { Globals } from '@core/globals';
import { AuthenticationService } from '@core/services/authentication.service';

@Injectable()
export class RoleGuard implements CanActivate, CanActivateChild {
     user:any;
    constructor(
        private router: Router,
        private globals: Globals,
        private authenticationService: AuthenticationService
    ) {
         this.user =  this.authenticationService.getUserFromLocalStorage();
    }

    canActivate(next: ActivatedRouteSnapshot) {
        if (next.data.allowedRoles.includes(this.user.role)) {
            return true;
        }
        // this.router.navigate(['home']);

        return false;
    }
    canActivateChild(next: ActivatedRouteSnapshot) {
        
        if (next.data.allowedRoles.includes(this.user.role)) {
            return true;
        }
        // this.router.navigate(['home']);

        return false;
    }

}
