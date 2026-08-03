import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { SharedModule } from '@shared/shared.module';
import { ReportTableComponent } from './components/report-table/report-table.component';

/** Table only — no reports feature routes. RouterModule is for optional cell links. */
@NgModule({
  declarations: [ReportTableComponent],
  imports: [CommonModule, SharedModule, RouterModule],
  exports: [ReportTableComponent],
})
export class ReportTableModule {}
