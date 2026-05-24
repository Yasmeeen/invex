import { Injectable } from '@angular/core';
import { CanActivateChild, ActivatedRouteSnapshot, CanActivate } from '@angular/router';
import { AuthenticationService } from '@core/services/authentication.service';

@Injectable()
export class RoleGuard implements CanActivate, CanActivateChild {
    constructor(
        private authenticationService: AuthenticationService
    ) {}

    private currentRole(): string | undefined {
        return this.authenticationService.currentUser?.role as string | undefined;
    }

    canActivate(next: ActivatedRouteSnapshot) {
        if (next.data.allowedRoles.includes(this.currentRole())) {
            return true;
        }
        return false;
    }

    canActivateChild(next: ActivatedRouteSnapshot) {
        if (next.data.allowedRoles.includes(this.currentRole())) {
            return true;
        }
        return false;
    }

}
