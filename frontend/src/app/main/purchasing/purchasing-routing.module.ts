import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { PurchasingRequestsListComponent } from './purchasing-requests-list/purchasing-requests-list.component';

const routes: Routes = [
  {
    path: '', component: PurchasingRequestsListComponent
},
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class PurchasingRoutingModule { }
