import { Injectable } from '@angular/core';
import { CanActivate, Router, UrlTree } from '@angular/router';
import { StoreSettingsService } from '@shared/services/store-settings.service';
import { Observable, of } from 'rxjs';
import { filter, map, take } from 'rxjs/operators';

/**
 * Online orders stay hidden until an admin enables CRM integration in store settings.
 */
@Injectable({ providedIn: 'root' })
export class CrmIntegrationGuard implements CanActivate {
  constructor(
    private storeSettings: StoreSettingsService,
    private router: Router
  ) {}

  canActivate(): Observable<boolean | UrlTree> {
    if (!this.storeSettings.hydrated) {
      this.storeSettings.load();
    }
    return this.storeSettings.settings$.pipe(
      filter(() => this.storeSettings.hydrated),
      take(1),
      map(() => this.allowOrRedirect())
    );
  }

  private allowOrRedirect(): boolean | UrlTree {
    if (this.storeSettings.crmIntegrationEnabled) {
      return true;
    }
    return this.router.createUrlTree(['/orders']);
  }
}
