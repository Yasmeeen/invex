import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { RoleGuard } from '@core/guards/role.guard';
import { StoreSettingsComponent } from './store-settings/store-settings.component';
import { InstallmentPlansSettingsComponent } from './installment-plans-settings/installment-plans-settings.component';
import { PermissionsSettingsComponent } from './permissions-settings/permissions-settings.component';

const routes: Routes = [
  {
    path: '',
    component: StoreSettingsComponent,
  },
  {
    path: 'permissions',
    component: PermissionsSettingsComponent,
    canActivate: [RoleGuard],
    data: { allowedRoles: ['Super Admin'] },
  },
  {
    path: 'installment-plans',
    component: InstallmentPlansSettingsComponent,
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class SettingsRoutingModule {}
