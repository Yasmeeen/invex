import { ProductsSerivce } from './../../../shared/services/products.service';
import { Component, OnInit } from '@angular/core';
import * as Highcharts from 'highcharts';
import HC_treemap from 'highcharts/modules/treemap';
import HC_solidGauge from 'highcharts/modules/solid-gauge';
import { DashboardService } from '@shared/services/dashboard.service';
import { orderStatistics } from '@core/models/dashboard.model';
import { Branch } from '@core/models/products.model';
import { BranchesServce } from '@shared/services/branches.service';

HC_treemap(Highcharts);
HC_solidGauge(Highcharts);

/** Mint / forest palette aligned with dashboard reference UI */
const DASH_MINT = '#b8e88e';
const DASH_FOREST = '#1e4d2b';
const DASH_ACCENT = '#f5a623';
const DASH_MUTE = '#e8ede9';

/** Donut — stock (products) */
const DONUT_STOCK_IN = '#2d6a4f';
const DONUT_STOCK_OUT = '#d4a5a8';
/** Donut — orders */
const DONUT_ORDER_DONE = '#1b4332';
const DONUT_ORDER_RESTORED = '#74c69d';

@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss'],
})
export class HomeComponent implements OnInit {
  fromDate: Date = new Date();
  toDate: Date = new Date();
  selectedBranch: any;
  branches: Branch[] = [];
  isToday = true;

  totalInvoices = 280;
  totalCategories = 25;
  orderStatistics: orderStatistics;
  productsStats: any;
  installments: any[] = [];
  pastInstallments: any[] = [];

  installmentsTab: 'upcoming' | 'past' = 'upcoming';

  /** Total orders (sum of status segments) for dashboard badge */
  ordersTotal: number | null = null;

  constructor(
    private dashboardService: DashboardService,
    private productsSerivce: ProductsSerivce,
    private branchesServce: BranchesServce
  ) {}

  get averageOrderDisplay(): string | null {
    const inv = this.orderStatistics?.totalInvoices;
    const sales = this.orderStatistics?.totalSales;
    if (inv == null || inv === 0 || sales == null) {
      return null;
    }
    const n = Number(sales) / Number(inv);
    return Number.isFinite(n) ? n.toFixed(2) : null;
  }

  ngOnInit(): void {
    this.loadDashboardChartsAndStats();
    this.getBranches();
    this.loadUpcomingInstallments();
    this.loadPastUpcomingInstallments();
  }

  loadDashboardChartsAndStats(): void {
    this.getOrderStatistics();
    this.getProductsStats();
    this.ordersChart();
    this.invoicesChart();
    this.categoriesChart();
  }

  applyFilters(): void {
    this.loadDashboardChartsAndStats();
  }

  loadUpcomingInstallments(): void {
    this.dashboardService.getUpcomingUnpaidInstallments().subscribe({
      next: (res: any) => (this.installments = res),
      error: (err) => console.error(err),
    });
  }

  loadPastUpcomingInstallments(): void {
    this.dashboardService.getPastUnpaidInstallments().subscribe({
      next: (res: any) => (this.pastInstallments = res),
      error: (err) => console.error(err),
    });
  }

  markAsPaid(id: string, inst: any): void {
    this.dashboardService.markAsPaid(id).subscribe(() => {
      this.installments = this.installments.filter((i) => i._id !== id);
    });
  }

  getProductsStats(): void {
    this.productsSerivce.getProductsStats(this.selectedBranch).subscribe((res) => {
      this.productsStats = res;
      this.productsChart(this.productsStats);
    });
  }

  getBranches(): void {
    const params = { page: 1, limit: 1000 };
    this.branchesServce.getBranchs(params).subscribe((response: any) => {
      this.branches = response.branches;
    });
  }

  changeBranch(): void {
    this.loadDashboardChartsAndStats();
  }

  getOrderStatistics(): void {
    const today = new Date();
    this.isToday = [this.fromDate, this.toDate].every(
      (d) => new Date(d).toDateString() === today.toDateString()
    );

    const params = {
      from: this.fromDate.toLocaleDateString('en-CA'),
      to: this.toDate.toLocaleDateString('en-CA'),
      branch: this.selectedBranch,
    };

    this.dashboardService.getDashboardStats(params).subscribe((res) => {
      this.orderStatistics = res;
    });
  }

  private chartCommon(): Partial<Highcharts.ChartOptions> {
    return {
      backgroundColor: 'transparent',
      style: { fontFamily: 'inherit' },
      spacing: [12, 12, 12, 12],
    };
  }

  /**
   * Donut chart with center total, legend, and soft labels — shared look for Products & Orders.
   */
  private renderDonutChart(
    containerId: string,
    seriesName: string,
    points: { name: string; y: number; color: string }[]
  ): void {
    const data = points.map((p) => ({
      name: p.name,
      y: Math.max(0, Number(p.y) || 0),
      color: p.color,
    }));
    const total = data.reduce((s, d) => s + d.y, 0);

    Highcharts.chart(containerId, {
      chart: {
        ...this.chartCommon(),
        type: 'pie',
        height: 288,
        spacing: [10, 10, 6, 10],
        events: {
          render: function () {
            const chart = this as any;
            if (chart._donutCenter) {
              chart._donutCenter.destroy();
              chart._donutCenter = undefined;
            }
            const series = chart.series[0];
            if (!series || !series.center) {
              return;
            }
            const cx = chart.plotLeft + series.center[0];
            const cy = chart.plotTop + series.center[1];
            const label = chart.renderer
              .text(String(total), cx, cy)
              .css({
                fontSize: '26px',
                fontWeight: '700',
                color: DASH_FOREST,
              })
              .attr({ 'text-anchor': 'middle', zIndex: 5 })
              .add();
            const bbox = label.getBBox();
            label.attr({ x: cx, y: cy + bbox.height / 3 });
            chart._donutCenter = label;
          },
        },
      },
      title: { text: '' },
      credits: { enabled: false },
      tooltip: {
        backgroundColor: 'rgba(255,255,255,0.97)',
        borderColor: DASH_MUTE,
        borderRadius: 12,
        shadow: true,
        style: { fontSize: '12px' },
        pointFormat:
          '<span style="color:{point.color}">●</span> <b>{point.name}</b><br/>' +
          '{point.y} <span style="opacity:0.85">({point.percentage:.1f}%)</span>',
      },
      legend: {
        align: 'center',
        verticalAlign: 'bottom',
        layout: 'horizontal',
        symbolRadius: 8,
        symbolPadding: 8,
        itemMarginTop: 6,
        itemStyle: {
          fontWeight: '600',
          fontSize: '12px',
          color: '#374151',
        },
      },
      plotOptions: {
        pie: {
          innerSize: '58%',
          size: '82%',
          center: ['50%', '44%'],
          borderWidth: 2,
          borderColor: '#ffffff',
          dataLabels: {
            enabled: true,
            distance: 18,
            softConnector: true,
            connectorColor: '#cbd5e1',
            connectorWidth: 1,
            formatter: function () {
              const pt = this as any;
              if (pt.percentage < 5) {
                return null;
              }
              return (
                '<span style="font-weight:600;color:#374151">' +
                pt.point.name +
                '</span><br/>' +
                '<span style="font-size:11px;color:#6b7280">' +
                pt.y +
                ' · ' +
                Highcharts.numberFormat(pt.percentage, 0) +
                '%</span>'
              );
            },
            style: { fontSize: '11px', textOutline: 'none' },
          },
          showInLegend: true,
        },
      },
      series: [
        {
          name: seriesName,
          type: 'pie',
          data,
        },
      ],
    } as Highcharts.Options);
  }

  productsChart(productsStats: any): void {
    const inStock = Math.max(0, Number(productsStats?.inStock) || 0);
    const outOfStock = Math.max(0, Number(productsStats?.outOfStock) || 0);
    this.renderDonutChart('products-chart', 'Stock', [
      { name: 'In Stock', y: inStock, color: DONUT_STOCK_IN },
      { name: 'Out of Stock', y: outOfStock, color: DONUT_STOCK_OUT },
    ]);
  }

  ordersChart(): void {
    this.dashboardService.getOrdersStatusStats(this.selectedBranch).subscribe({
      next: (res: any) => {
        const raw = Array.isArray(res?.stats) ? res.stats : [];
        const completed = raw.find((p: any) => String(p?.name).toLowerCase() === 'completed');
        const restored = raw.find((p: any) => String(p?.name).toLowerCase() === 'restored');
        const yC = Math.max(0, Number(completed?.y) || 0);
        const yR = Math.max(0, Number(restored?.y) || 0);
        this.ordersTotal = yC + yR;
        this.renderDonutChart('orders-chart', 'Orders', [
          { name: 'Completed', y: yC, color: DONUT_ORDER_DONE },
          { name: 'Restored', y: yR, color: DONUT_ORDER_RESTORED },
        ]);
      },
      error: () => {
        this.ordersTotal = null;
      },
    });
  }

  invoicesChart(): void {
    this.dashboardService.getInvoicesPerMonth(this.selectedBranch).subscribe((res: any) => {
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const data: number[] = res.monthlyCounts || [];
      const max = data.length ? Math.max(...data) : 0;
      const maxIdx = max > 0 ? data.indexOf(max) : -1;
      const columnData = data.map((y, i) => ({
        y,
        color: i === maxIdx ? DASH_ACCENT : DASH_MINT,
      }));

      Highcharts.chart('invoices-chart', {
        chart: { ...this.chartCommon(), type: 'column' },
        title: { text: `Invoices in ${res.year}`, style: { color: DASH_FOREST, fontWeight: '600' } },
        credits: { enabled: false },
        xAxis: {
          categories: months,
          lineColor: DASH_MUTE,
          tickColor: DASH_MUTE,
          labels: { style: { color: '#6b7280' } },
        },
        yAxis: {
          title: { text: 'Number of Invoices', style: { color: '#6b7280' } },
          gridLineColor: DASH_MUTE,
        },
        plotOptions: {
          column: {
            borderRadius: 8,
            borderWidth: 0,
          },
        },
        series: [
          {
            name: 'Invoices',
            type: 'column',
            data: columnData,
          },
        ],
      } as Highcharts.Options);
    });
  }

  categoriesChart(): void {
    this.dashboardService.getCategoriesStats(this.selectedBranch).subscribe((res: any) => {
      const categories = res.stats.map((c: any) => c.categoryName);
      const totalItems = res.stats.map((c: any) => c.totalItems);

      Highcharts.chart('categories-chart', {
        chart: { ...this.chartCommon(), type: 'bar' },
        title: { text: 'Items per Category', style: { color: DASH_FOREST, fontWeight: '600' } },
        credits: { enabled: false },
        xAxis: {
          categories,
          lineColor: DASH_MUTE,
          labels: { style: { color: '#6b7280' } },
        },
        yAxis: {
          title: { text: 'Total Items', style: { color: '#6b7280' } },
          gridLineColor: DASH_MUTE,
        },
        plotOptions: {
          bar: {
            borderRadius: 8,
            borderWidth: 0,
            color: DASH_FOREST,
          },
        },
        series: [
          {
            name: 'Total Items',
            type: 'bar',
            data: totalItems,
          },
        ],
      } as Highcharts.Options);
    });
  }
}
