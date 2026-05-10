import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { DrawerCloseHistoryComponent } from './drawer-close-history/drawer-close-history.component';

const routes: Routes = [
  {
    path: '',
    component: DrawerCloseHistoryComponent,
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class DrawerCloseRoutingModule {}
