import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-report-table',
  templateUrl: './report-table.component.html',
  styleUrls: ['./report-table.component.scss'],
})
export class ReportTableComponent {
  @Input() columns: { key: string; labelKey: string }[] = [];
  @Input() rows: any[] = [];
}

