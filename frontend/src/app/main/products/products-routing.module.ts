import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { RoleGuard } from '@core/guards/role.guard';
import { LEGACY_OPERATION_MANAGER } from '@core/utils/role-utils';
import { ProductsListComponent } from './products-list/products-list.component';
import { PendingBranchTransfersComponent } from './pending-branch-transfers/pending-branch-transfers.component';
import { SerialTrackComponent } from './serial-track/serial-track.component';
import { PriceListComponent } from './price-list/price-list.component';

const WAREHOUSE = ['Warehouse', LEGACY_OPERATION_MANAGER] as const;

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
        ...WAREHOUSE,
        'Moderator',
      ],
    },
  },
  {
    path: 'branch-transfers',
    component: PendingBranchTransfersComponent,
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
        ...WAREHOUSE,
        'Cashier',
      ],
    },
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class ProductsRoutingModule { }
