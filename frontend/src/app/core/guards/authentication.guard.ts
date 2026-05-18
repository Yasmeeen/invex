import { Injectable } from '@angular/core';
import { Router, ActivatedRouteSnapshot, RouterStateSnapshot, UrlTree } from '@angular/router';

@Injectable()
export class AuthenticationGuard  {

    constructor(private router: Router) { }

    canActivate(route: ActivatedRouteSnapshot, state: RouterStateSnapshot): boolean | UrlTree {
        if (localStorage.getItem('currentUser')) {
            return true;
        }
        return this.router.createUrlTree(['login'], { relativeTo: this.router.routerState.root });
    }
    canActivateChild(route: ActivatedRouteSnapshot, state: RouterStateSnapshot): boolean | UrlTree {
        if (localStorage.getItem('currentUser')) {
            return true;
        }
        return this.router.createUrlTree(['login'], {
            relativeTo: this.router.routerState.root,
            queryParams: { returnUrl: state.url },
        });
    }

}
