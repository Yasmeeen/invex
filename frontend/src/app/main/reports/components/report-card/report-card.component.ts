import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-report-card',
  templateUrl: './report-card.component.html',
  styleUrls: ['./report-card.component.scss'],
})
export class ReportCardComponent {
  @Input() titleKey = '';
  @Input() titleParams: Record<string, unknown> = {};
  @Input() value: any = '';
  @Input() hintKey = '';
  @Input() hintParams: Record<string, unknown> = {};
}

