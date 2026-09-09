import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { OnlineOrdersPageComponent } from './online-orders-page.component';

const routes: Routes = [{ path: '', component: OnlineOrdersPageComponent }];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class OnlineOrdersRoutingModule {}
