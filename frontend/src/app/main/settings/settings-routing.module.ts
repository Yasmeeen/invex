import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { StoreSettingsComponent } from './store-settings/store-settings.component';
import { InstallmentPlansSettingsComponent } from './installment-plans-settings/installment-plans-settings.component';

const routes: Routes = [
  {
    path: '',
    component: StoreSettingsComponent,
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
