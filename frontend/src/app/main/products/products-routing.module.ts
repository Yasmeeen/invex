import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { RoleGuard } from '@core/guards/role.guard';
import { ProductsListComponent } from './products-list/products-list.component';
import { PendingBranchTransfersComponent } from './pending-branch-transfers/pending-branch-transfers.component';
import { SerialTrackComponent } from './serial-track/serial-track.component';
import { PriceListComponent } from './price-list/price-list.component';
import { FarmAnimalsListComponent } from './farm-animals-list/farm-animals-list.component';

const routes: Routes = [
  {
    path: '',
    component: ProductsListComponent,
  },
  {
    path: 'price-list',
    component: PriceListComponent,
    canActivate: [RoleGuard],
    data: {
      allowedRoles: [
        'Super Admin',
        'Co Admin',
        'Branch Manager',
        'Moderator',
        'Cashier',
      ],
    },
  },
  {
    path: 'branch-transfers',
    component: PendingBranchTransfersComponent,
    canActivate: [RoleGuard],
    data: {
      allowedRoles: [
        'Super Admin',
        'Co Admin',
        'Branch Manager',
        'Warehouse',
        'Operation Manager',
      ],
    },
  },
  {
    path: 'farm-animals',
    component: FarmAnimalsListComponent,
    canActivate: [RoleGuard],
    data: {
      allowedRoles: ['Super Admin', 'Co Admin', 'Branch Manager', 'Warehouse', 'Cashier'],
    },
  },
  {
    path: 'serial-track',
    component: SerialTrackComponent,
    canActivate: [RoleGuard],
    data: {
      allowedRoles: [
        'Super Admin',
        'Co Admin',
        'Branch Manager',
      ],
    },
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class ProductsRoutingModule { }
