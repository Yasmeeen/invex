import { Injectable } from '@angular/core';
import { CanActivate, Router } from '@angular/router';
import { AuthenticationService } from '@core/services/authentication.service';

/**
 * Vixa is available to authenticated users, but answers are still permissioned server-side.
 * This guard prevents opening Vixa when not logged in.
 */
@Injectable({ providedIn: 'root' })
export class VixaGuard implements CanActivate {
  constructor(
    private router: Router,
    private authenticationService: AuthenticationService
  ) {}

  canActivate(): boolean {
    const u: any = this.authenticationService.getUserFromLocalStorage();
    if (!u?._id) {
      this.router.navigate(['/login']);
      return false;
    }
    return true;
  }
}

