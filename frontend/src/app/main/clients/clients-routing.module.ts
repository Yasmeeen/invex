import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { ClientListComponent } from './client-list/client-list.component';
import { ClientHistoryComponent } from './client-history/client-history.component';

const routes: Routes = [
  {
    path: '',
    component: ClientListComponent,
  },
  {
    path: ':id/history',
    component: ClientHistoryComponent,
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class ClientsRoutingModule { }
