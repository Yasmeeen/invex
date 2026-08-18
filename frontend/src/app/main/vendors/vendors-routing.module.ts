import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { VendorsListComponent } from './vendors-list/vendors-list.component';
import { VendorHistoryComponent } from './vendor-history/vendor-history.component';

const routes: Routes = [
  {
    path: '',
    component: VendorsListComponent,
  },
  {
    path: ':id/history',
    component: VendorHistoryComponent,
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class VendorsRoutingModule { }
