import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { Subscription } from 'rxjs';
import { AuthenticationService } from '@core/services/authentication.service';
import {
  COST_PRICE_RESTRICTABLE_ROLES,
  CostPriceRestrictableRole,
  DEFAULT_ROLES_HIDDEN_FROM_COST_PRICE,
  normalizeRolesHiddenFromCostPrice,
} from '@core/utils/role-utils';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { StoreSettingsService } from '@shared/services/store-settings.service';

@Component({
  selector: 'app-permissions-settings',
  templateUrl: './permissions-settings.component.html',
  styleUrls: ['./permissions-settings.component.scss'],
})
export class PermissionsSettingsComponent implements OnInit, OnDestroy {
  readonly costPriceRoles = COST_PRICE_RESTRICTABLE_ROLES;
  hiddenFromCostPrice = new Set<string>(DEFAULT_ROLES_HIDDEN_FROM_COST_PRICE);
  saving = false;
  private sub?: Subscription;

  constructor(
    private storeSettings: StoreSettingsService,
    private notify: AppNotificationService,
    private translate: TranslateService,
    private auth: AuthenticationService,
    private router: Router
  ) {}

  ngOnInit(): void {
    const role = this.auth.currentUser?.role as unknown as string | undefined;
    if (role !== 'Super Admin') {
      this.router.navigate(['/settings']);
      return;
    }
    this.storeSettings.load();
    this.sub = this.storeSettings.settings$.subscribe((s) => {
      this.hiddenFromCostPrice = new Set(
        normalizeRolesHiddenFromCostPrice(s.rolesHiddenFromCostPrice)
      );
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  roleLabelKey(role: CostPriceRestrictableRole): string {
    const map: Record<CostPriceRestrictableRole, string> = {
      'Co Admin': 'tr_role_co_admin',
      'Branch Manager': 'tr_role_branch_manager',
      Cashier: 'tr_role_cashier',
      Collector: 'tr_role_collector',
      Warehouse: 'tr_role_warehouse',
      Moderator: 'tr_role_moderator',
    };
    return map[role];
  }

  isHidden(role: string): boolean {
    return this.hiddenFromCostPrice.has(role);
  }

  toggleRole(role: string, checked: boolean): void {
    if (checked) {
      this.hiddenFromCostPrice.add(role);
    } else {
      this.hiddenFromCostPrice.delete(role);
    }
  }

  save(): void {
    this.saving = true;
    const rolesHiddenFromCostPrice = COST_PRICE_RESTRICTABLE_ROLES.filter((r) =>
      this.hiddenFromCostPrice.has(r)
    );
    this.storeSettings.update({ rolesHiddenFromCostPrice }).subscribe({
      next: () => {
        this.saving = false;
        this.notify.push(this.translate.instant('tr_settings_saved'), 'success');
      },
      error: () => {
        this.saving = false;
        this.notify.push(this.translate.instant('tr_unexpected_error_message'), 'error');
      },
    });
  }
}
