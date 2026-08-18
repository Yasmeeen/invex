import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { ProfitReportGuard } from '@core/guards/profit-report.guard';
import { ReportsPageComponent } from './pages/reports-page/reports-page.component';

const routes: Routes = [
  { path: '', redirectTo: 'sales', pathMatch: 'full' },
  { path: 'sales', component: ReportsPageComponent, data: { reportType: 'sales' } },
  {
    path: 'profit',
    component: ReportsPageComponent,
    data: { reportType: 'profit' },
    canActivate: [ProfitReportGuard],
  },
  { path: 'products', component: ReportsPageComponent, data: { reportType: 'products' } },
  { path: 'stock', component: ReportsPageComponent, data: { reportType: 'stock' } },
  { path: 'customers', component: ReportsPageComponent, data: { reportType: 'customers' } },
  { path: 'installments', component: ReportsPageComponent, data: { reportType: 'installments' } },
  { path: 'bookings', component: ReportsPageComponent, data: { reportType: 'bookings' } },
  { path: 'desk-purchases', component: ReportsPageComponent, data: { reportType: 'deskPurchases' } },
  { path: 'treasury', component: ReportsPageComponent, data: { reportType: 'treasury' } },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class ReportsRoutingModule {}

