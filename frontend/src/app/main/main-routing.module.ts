import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { AuthenticationGuard } from '@core/guards';
import { MainComponent } from './main.component';
import { RoleGuard } from '@core/guards/role.guard';
import { LEGACY_OPERATION_MANAGER } from '@core/utils/role-utils';

/** DB may still store legacy "Operation Manager"; canonical name is Warehouse. */
const WAREHOUSE = ['Warehouse', LEGACY_OPERATION_MANAGER] as const;

const routes: Routes = [
  {
    path: '',
    component: MainComponent,
    canActivateChild: [AuthenticationGuard],
    children: [
      {
        path: 'faq',
        loadChildren: () => import('./faq/faq.module').then((m) => m.FaqModule),
        canActivate: [RoleGuard],
        data: {
          allowedRoles: [
            'Super Admin',
            'Co Admin',
            'Branch Manager',
            'Cashier',
            'Collector',
            'Moderator',
          ],
        },
      },
      {
        path: 'vixa',
        loadChildren: () => import('./vixa/vixa.module').then((m) => m.VixaModule),
        canActivate: [RoleGuard],
        data: {
          allowedRoles: [
            'Super Admin',
            'Co Admin',
            'Branch Manager',
            'Moderator',
          ],
        },
      },
      {
        path: 'users',
        loadChildren: () => import('./users/users.module').then(m => m.UsersModule),
        canActivate: [RoleGuard],
        data: { allowedRoles: ['Super Admin', 'Co Admin'] }
      },
      {
        path: 'products',
        loadChildren: () => import('./products/products.module').then(m => m.ProductsModule),
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
        path: 'branches',
        loadChildren: () => import('./branches/branches.module').then(m => m.BranchesModule),
        canActivate: [RoleGuard],
        data: { allowedRoles: ['Super Admin', 'Co Admin'] },
      },
      {
        path: 'categories',
        loadChildren: () => import('./categories/categories.module').then(m => m.CategoriesModule),
        canActivate: [RoleGuard],
        data: {
          allowedRoles: ['Super Admin', 'Co Admin', 'Admin', 'Branch Manager'],
        },
      },
      {
        path: 'settings',
        loadChildren: () => import('./settings/settings.module').then(m => m.SettingsModule),
        canActivate: [RoleGuard],
        data: { allowedRoles: ['Super Admin', 'Co Admin'] }
      },
      {
        path: 'reports',
        loadChildren: () => import('./reports/reports.module').then(m => m.ReportsModule),
        canActivate: [RoleGuard],
        data: {
          allowedRoles: ['Super Admin', 'Co Admin', 'Branch Manager'],
        },
      },
      {
        path: 'audits',
        loadChildren: () => import('./audits/audits.module').then((m) => m.AuditsModule),
        canActivate: [RoleGuard],
        data: { allowedRoles: ['Super Admin', 'Co Admin'] },
      },
      {
        path: 'orders',
        loadChildren: () => import('./orders/orders.module').then(m => m.OrdersModule),
        canActivate: [RoleGuard],
        data: {
          allowedRoles: [
            'Super Admin',
            'Co Admin',
            'Branch Manager',
            'Cashier',
            'Collector',
          ],
        },
      },
      {
        path: 'home',
        loadChildren: () => import('./home/home.module').then(m => m.HomeModule),
        canActivate: [RoleGuard],
        data: { allowedRoles: ['Super Admin'] }
      },
      {
        path: 'slaughter',
        loadChildren: () => import('./slaughter/slaughter.module').then(m => m.SlaughterModule),
        canActivate: [RoleGuard],
        data: {
          allowedRoles: [
            'Super Admin',
            'Co Admin',
            'Branch Manager',
            ...WAREHOUSE,
          ],
        },
      },
      {
        path: 'inventory',
        loadChildren:() => import('./Inventory/inventory.module').then(m => m.InventoryModule),
        canActivate: [RoleGuard],
        data: {
          allowedRoles: [
            'Super Admin',
            'Co Admin',
            'Branch Manager',
            ...WAREHOUSE,
          ],
        },
      },
      {
        path: 'clients',
        loadChildren:() => import('./clients/clients.module').then(m => m.ClientsModule),
        canActivate: [RoleGuard],
        data: { allowedRoles: ['Super Admin', 'Co Admin', 'Branch Manager', 'Collector'] }
      },
      {
        path: 'collections',
        loadChildren: () =>
          import('./collections/collections.module').then((m) => m.CollectionsModule),
        canActivate: [RoleGuard],
        data: {
          allowedRoles: ['Super Admin', 'Co Admin', 'Branch Manager', 'Collector'],
        },
      },
      {
        path: 'purchasing',
        loadChildren:() => import('./purchasing/purchasing.module').then(m => m.PurchasingModule),
        canActivate: [RoleGuard],
        data: { allowedRoles: ['Super Admin', 'Co Admin', 'Branch Manager'] }
      },
      {
        path: 'suppliers',
        loadChildren:() => import('./vendors/vendors.module').then(m => m.VendorsModule),
        canActivate: [RoleGuard],
        data: { allowedRoles: ['Super Admin', 'Co Admin', 'Branch Manager'] }
      },
      {
        path: 'cashier',
        loadChildren:() => import('./cashier/cashier.module').then(m => m.CashierModule),
        canActivate: [RoleGuard],
        data: { allowedRoles: ['Super Admin', 'Co Admin', 'Branch Manager', 'Cashier'] },
      },
      {
        path: 'expenses',
        loadChildren: () => import('./expenses/expenses.module').then((m) => m.ExpensesModule),
        canActivate: [RoleGuard],
        data: {
          allowedRoles: ['Super Admin', 'Co Admin', 'Branch Manager', 'Cashier'],
        },
      },
      {
        path: 'drawer-close',
        loadChildren: () => import('./drawer-close/drawer-close.module').then((m) => m.DrawerCloseModule),
        canActivate: [RoleGuard],
        data: {
          allowedRoles: ['Super Admin', 'Co Admin', 'Branch Manager', 'Cashier'],
        },
      },
      {
        path: 'treasury',
        loadChildren: () => import('./treasury/treasury.module').then((m) => m.TreasuryModule),
        canActivate: [RoleGuard],
        data: {
          allowedRoles: ['Super Admin', 'Co Admin', 'Branch Manager', 'Cashier'],
        },
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
