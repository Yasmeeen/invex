import { Injectable } from '@angular/core';
import { CanActivate, ActivatedRouteSnapshot, Router } from '@angular/router';
import { AuthenticationService } from '@core/services/authentication.service';

/**
 * Co Admin / Branch Manager must not open the profit report. Other reports stay allowed.
 */
@Injectable({ providedIn: 'root' })
export class ProfitReportGuard implements CanActivate {
  constructor(
    private router: Router,
    private authenticationService: AuthenticationService
  ) {}

  canActivate(route: ActivatedRouteSnapshot): boolean {
    const reportType = route.data['reportType'] as string | undefined;
    if (reportType !== 'profit') {
      return true;
    }
    const user = this.authenticationService.getUserFromLocalStorage();
    if (user?.role === 'Co Admin' || user?.role === 'Branch Manager') {
      this.router.navigate(['/reports/sales']);
      return false;
    }
    return true;
  }
}
