import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { StoreSettingsComponent } from './store-settings/store-settings.component';

const routes: Routes = [
  {
    path: '',
    component: StoreSettingsComponent,
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class SettingsRoutingModule {}
