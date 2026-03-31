import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SharedModule } from '@shared/shared.module';
import { AuditsRoutingModule } from './audits-routing.module';
import { AuditsPageComponent } from './pages/audits-page/audits-page.component';
import { ReportTableModule } from '../reports/report-table.module';

@NgModule({
  declarations: [AuditsPageComponent],
  imports: [CommonModule, FormsModule, SharedModule, ReportTableModule, AuditsRoutingModule],
})
export class AuditsModule {}

