import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { FactoryPageComponent } from './factory-page.component';

const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'stock' },
  { path: 'stock', component: FactoryPageComponent, data: { tab: 'stock' } },
  { path: 'orders', component: FactoryPageComponent, data: { tab: 'orders' } },
  { path: 'recipes', component: FactoryPageComponent, data: { tab: 'recipes' } },
  { path: 'transfers', component: FactoryPageComponent, data: { tab: 'transfers' } },
  { path: 'sales', component: FactoryPageComponent, data: { tab: 'sales' } },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class FactoryRoutingModule {}
