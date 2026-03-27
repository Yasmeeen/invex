import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HighchartsChartModule } from 'highcharts-angular';
import { FormsModule } from '@angular/forms';
import { SharedModule } from '@shared/shared.module';
import { ReportsRoutingModule } from './reports-routing.module';
import { ReportsPageComponent } from './pages/reports-page/reports-page.component';
import { ReportFiltersComponent } from './components/report-filters/report-filters.component';
import { ReportCardComponent } from './components/report-card/report-card.component';
import { ReportTableComponent } from './components/report-table/report-table.component';
import { ChartWrapperComponent } from './components/chart-wrapper/chart-wrapper.component';

@NgModule({
  declarations: [
    ReportsPageComponent,
    ReportFiltersComponent,
    ReportCardComponent,
    ReportTableComponent,
    ChartWrapperComponent,
  ],
  imports: [CommonModule, FormsModule, SharedModule, HighchartsChartModule, ReportsRoutingModule],
})
export class ReportsModule {}

