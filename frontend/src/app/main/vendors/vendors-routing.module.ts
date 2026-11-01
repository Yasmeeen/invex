import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { VendorsListComponent } from './vendors-list/vendors-list.component';
import { VendorHistoryComponent } from './vendor-history/vendor-history.component';
import { VendorGoodsReturnsListComponent } from './vendor-goods-returns-list/vendor-goods-returns-list.component';

const routes: Routes = [
  {
    path: '',
    component: VendorsListComponent,
  },
  {
    path: 'returns',
    component: VendorGoodsReturnsListComponent,
  },
  {
    path: ':id/history',
    component: VendorHistoryComponent,
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class VendorsRoutingModule { }
