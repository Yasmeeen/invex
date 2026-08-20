import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { CollectionsDashboardComponent } from './collections-dashboard/collections-dashboard.component';
import { CollectionsDashboardModule } from './collections-dashboard.module';

const routes: Routes = [
  {
    path: '',
    component: CollectionsDashboardComponent,
  },
];

@NgModule({
  imports: [CollectionsDashboardModule, RouterModule.forChild(routes)],
})
export class CollectionsModule {}
