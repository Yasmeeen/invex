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
  /** Rotates header icon (FA4 classes). */
  @Input() variantIndex = 0;
  /** Optional e.g. `2.31` or `2.31%` — shows trend pill when set. */
  @Input() trendLabel = '';
  /** Green/up when true (default); red/down when false. */
  @Input() trendPositive = true;

  get headerIconClass(): string {
    const icons = ['fa-users', 'fa-hand-pointer-o', 'fa-file-text-o', 'fa-bar-chart'];
    return icons[this.variantIndex % icons.length];
  }

  get showFooter(): boolean {
    return !!(String(this.trendLabel || '').trim() || this.hintKey);
  }
}
