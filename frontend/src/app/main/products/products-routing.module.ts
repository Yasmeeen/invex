import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { ProductsListComponent } from './products-list/products-list.component';
import { PendingBranchTransfersComponent } from './pending-branch-transfers/pending-branch-transfers.component';
import { SerialTrackComponent } from './serial-track/serial-track.component';

const routes: Routes = [
  {
    path: '',
    component: ProductsListComponent,
  },
  {
    path: 'branch-transfers',
    component: PendingBranchTransfersComponent,
  },
  {
    path: 'serial-track',
    component: SerialTrackComponent,
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class ProductsRoutingModule { }
