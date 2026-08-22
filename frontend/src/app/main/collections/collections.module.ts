import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { CollectionsDashboardComponent } from './collections-dashboard/collections-dashboard.component';
import { CollectionsDashboardModule } from './collections-dashboard.module';
import { DueInstallmentsComponent } from './due-installments/due-installments.component';
import { DueInstallmentsModule } from './due-installments.module';

const routes: Routes = [
  {
    path: '',
    component: CollectionsDashboardComponent,
  },
  {
    path: 'due',
    component: DueInstallmentsComponent,
  },
];

@NgModule({
  imports: [
    CollectionsDashboardModule,
    DueInstallmentsModule,
    RouterModule.forChild(routes),
  ],
})
export class CollectionsModule {}
