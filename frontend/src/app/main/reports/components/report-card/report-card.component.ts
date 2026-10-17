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
  /** Format value as EGP currency. */
  @Input() money = false;
  /** `loss` → red value / icon (negative profit period). */
  @Input() tone: '' | 'loss' = '';
  /** `stat` = compact profit hero card (icon + title + value + hint). */
  @Input() appearance: 'default' | 'stat' = 'default';
  /** Optional FA4 icon class override. */
  @Input() iconClass = '';
  /** Icon tint for `stat` cards. */
  @Input() iconTone: '' | 'green' | 'purple' | 'blue' | 'amber' | 'red' = '';

  get headerIconClass(): string {
    if (this.tone === 'loss') return 'fa-arrow-down';
    const custom = String(this.iconClass || '').trim();
    if (custom) {
      return custom.startsWith('fa-') ? custom : `fa-${custom}`;
    }
    const icons =
      this.appearance === 'stat'
        ? ['fa-line-chart', 'fa-credit-card', 'fa-calendar', 'fa-bar-chart']
        : ['fa-users', 'fa-hand-pointer-o', 'fa-file-text-o', 'fa-bar-chart'];
    return icons[this.variantIndex % icons.length];
  }

  get iconToneClass(): string {
    return this.iconTone ? `report-card__icon-box--${this.iconTone}` : '';
  }

  get showFooter(): boolean {
    return !!(String(this.trendLabel || '').trim() || this.hintKey);
  }
}
