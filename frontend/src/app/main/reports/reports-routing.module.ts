import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { ProfitReportGuard } from '@core/guards/profit-report.guard';
import { WarehouseStockReportGuard } from '@core/guards/warehouse-stock-report.guard';
import { ReportsPageComponent } from './pages/reports-page/reports-page.component';

const warehouseStockOnly = [WarehouseStockReportGuard];

const routes: Routes = [
  { path: '', redirectTo: 'sales', pathMatch: 'full' },
  {
    path: 'sales',
    component: ReportsPageComponent,
    data: { reportType: 'sales' },
    canActivate: warehouseStockOnly,
  },
  {
    path: 'profit',
    component: ReportsPageComponent,
    data: { reportType: 'profit' },
    canActivate: [ProfitReportGuard, WarehouseStockReportGuard],
  },
  {
    path: 'products',
    component: ReportsPageComponent,
    data: { reportType: 'products' },
    canActivate: warehouseStockOnly,
  },
  { path: 'stock', component: ReportsPageComponent, data: { reportType: 'stock' } },
  {
    path: 'customers',
    component: ReportsPageComponent,
    data: { reportType: 'customers' },
    canActivate: warehouseStockOnly,
  },
  {
    path: 'installments',
    component: ReportsPageComponent,
    data: { reportType: 'installments' },
    canActivate: warehouseStockOnly,
  },
  {
    path: 'bookings',
    component: ReportsPageComponent,
    data: { reportType: 'bookings' },
    canActivate: warehouseStockOnly,
  },
  {
    path: 'desk-purchases',
    component: ReportsPageComponent,
    data: { reportType: 'deskPurchases' },
    canActivate: warehouseStockOnly,
  },
  {
    path: 'treasury',
    component: ReportsPageComponent,
    data: { reportType: 'treasury' },
    canActivate: warehouseStockOnly,
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class ReportsRoutingModule {}

