import { Component, Input } from '@angular/core';
import * as Highcharts from 'highcharts';

@Component({
  selector: 'app-chart-wrapper',
  templateUrl: './chart-wrapper.component.html',
  styleUrls: ['./chart-wrapper.component.scss'],
})
export class ChartWrapperComponent {
  @Input() title = '';
  @Input() options: Highcharts.Options = {};
  /** Changing this destroys and recreates the chart (needed when chart type / options shape changes). */
  @Input() renderKey = 0;
  highcharts: typeof Highcharts = Highcharts;

  /** Highcharts often measures a 0-width host on first paint; reflow after layout. */
  onChartInstance(chart: Highcharts.Chart): void {
    setTimeout(() => chart.reflow(), 0);
    requestAnimationFrame(() => chart.reflow());
  }
}

