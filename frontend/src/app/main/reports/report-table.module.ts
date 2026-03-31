import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SharedModule } from '@shared/shared.module';
import { ReportTableComponent } from './components/report-table/report-table.component';

/** Table only — no routing. Use from Audits (or elsewhere) without pulling in Reports routes. */
@NgModule({
  declarations: [ReportTableComponent],
  imports: [CommonModule, SharedModule],
  exports: [ReportTableComponent],
})
export class ReportTableModule {}
