import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { StockCountListComponent } from './stock-count-list/stock-count-list.component';
import { StockCountSessionComponent } from './stock-count-session/stock-count-session.component';

const routes: Routes = [
  { path: '', component: StockCountListComponent },
  { path: ':id', component: StockCountSessionComponent },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class StockCountRoutingModule {}
