import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { AuthenticationGuard } from '@core/guards';
import { MainComponent } from './main.component';
import { RoleGuard } from '@core/guards/role.guard';

const routes: Routes = [
  {
    path: '',
    component: MainComponent,
    canActivateChild: [AuthenticationGuard],
    children: [
      {
        path: 'users',
        loadChildren: () => import('./users/users.module').then(m => m.UsersModule),
        canActivate: [RoleGuard],
        data: { allowedRoles: ['Super Admin'] }
      },
      {
        path: 'products',
        loadChildren: () => import('./products/products.module').then(m => m.ProductsModule),
        canActivate: [RoleGuard],
        data: { allowedRoles: ['Super Admin'] }
      },
      {
        path: 'branches',
        loadChildren: () => import('./branches/branches.module').then(m => m.BranchesModule),
        canActivate: [RoleGuard],
        data: { allowedRoles: ['Super Admin'] }
      },
      {
        path: 'categories',
        loadChildren: () => import('./categories/categories.module').then(m => m.CategoriesModule),
        canActivate: [RoleGuard],
        data: { allowedRoles: ['Super Admin'] }
      },
      {
        path: 'orders',
        loadChildren: () => import('./orders/orders.module').then(m => m.OrdersModule),
        canActivate: [RoleGuard],
        data: { allowedRoles: ['Super Admin','Employee'] }
      },
      {
        path: 'home',
        loadChildren: () => import('./home/home.module').then(m => m.HomeModule),
        canActivate: [RoleGuard],
        data: { allowedRoles: ['Super Admin'] }
      },
      {
        path: 'inventory',
        loadChildren:() => import('./Inventory/inventory.module').then(m => m.InventoryModule),
        canActivate: [RoleGuard],
        data: { allowedRoles: ['Super Admin'] }
      },

      {
        path: '**',  loadChildren: () => import('./home/home.module').then(m => m.HomeModule),
        canActivate: [RoleGuard],
        data: { allowedRoles: ['Super Admin'] }
      },

    ]
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class MainRoutingModule { }
