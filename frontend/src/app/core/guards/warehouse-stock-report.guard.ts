import { Injectable } from '@angular/core';
import { CanActivate, ActivatedRouteSnapshot, Router } from '@angular/router';
import { AuthenticationService } from '@core/services/authentication.service';
import { isWarehouse } from '@core/utils/role-utils';

/**
 * Warehouse may only open stock + products reports. Other report routes redirect to /reports/stock.
 */
@Injectable({ providedIn: 'root' })
export class WarehouseStockReportGuard implements CanActivate {
  constructor(
    private router: Router,
    private authenticationService: AuthenticationService
  ) {}

  canActivate(route: ActivatedRouteSnapshot): boolean {
    const reportType = route.data['reportType'] as string | undefined;
    if (reportType === 'stock' || reportType === 'products') {
      return true;
    }
    const user = this.authenticationService.getUserFromLocalStorage();
    if (isWarehouse(user?.role)) {
      this.router.navigate(['/reports/stock']);
      return false;
    }
    return true;
  }
}
