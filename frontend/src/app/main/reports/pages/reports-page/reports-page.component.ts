import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import * as Highcharts from 'highcharts';
import { TranslateService } from '@ngx-translate/core';
import { Subscription } from 'rxjs';
import { ReportsService } from '@shared/services/reports.service';
import { ReportExportService } from '@shared/services/report-export.service';

type ReportCardVM = {
  titleKey: string;
  titleParams?: Record<string, unknown>;
  value: any;
  hintKey?: string;
  hintParams?: Record<string, unknown>;
};

@Component({
  selector: 'app-reports-page',
  templateUrl: './reports-page.component.html',
  styleUrls: ['./reports-page.component.scss'],
})
export class ReportsPageComponent implements OnInit, OnDestroy {
  reportType = 'sales';
  reportTitleKey = 'tr_report_title_sales';
  loading = false;
  filters: any = {};

  cards: ReportCardVM[] = [];
  tableColumns: { key: string; labelKey: string }[] = [];
  tableRows: any[] = [];
  /** Null until first successful load so the chart is not initialized with empty options. */
  chartOptions: Highcharts.Options | null = null;
  /** Bumped after each load so Highcharts is recreated (line ↔ pie updates are unreliable with chart.update). */
  chartRedrawKey = 0;

  private lastReportPayload: any = null;
  private langSub?: Subscription;

  private readonly reportTitleKeys: Record<string, string> = {
    sales: 'tr_report_title_sales',
    profit: 'tr_report_title_profit',
    products: 'tr_report_title_products',
    stock: 'tr_report_title_stock',
    customers: 'tr_report_title_customers',
    installments: 'tr_report_title_installments',
  };

  constructor(
    private route: ActivatedRoute,
    private reportsService: ReportsService,
    private exportService: ReportExportService,
    private translate: TranslateService
  ) {}

  ngOnInit(): void {
    this.langSub = this.translate.onLangChange.subscribe(() => {
      if (this.lastReportPayload) {
        this.bindReportData(this.lastReportPayload);
      }
    });

    this.route.data.subscribe((d) => {
      this.reportType = d.reportType || 'sales';
      this.reportTitleKey = this.reportTitleKeys[this.reportType] || this.reportTitleKeys.sales;
      this.loadReport(this.filters);
    });
  }

  ngOnDestroy(): void {
    this.langSub?.unsubscribe();
  }

  onApplyFilters(filters: any): void {
    this.filters = { ...filters };
    this.loadReport(this.filters);
  }

  private loadReport(filters: any): void {
    this.loading = true;
    const map: any = {
      sales: this.reportsService.getSalesReport.bind(this.reportsService),
      profit: this.reportsService.getProfitReport.bind(this.reportsService),
      products: this.reportsService.getProductsReport.bind(this.reportsService),
      stock: this.reportsService.getStockReport.bind(this.reportsService),
      customers: this.reportsService.getCustomersReport.bind(this.reportsService),
      installments: this.reportsService.getInstallmentsReport.bind(this.reportsService),
    };

    map[this.reportType](filters).subscribe(
      (res: any) => {
        this.loading = false;
        this.lastReportPayload = res || {};
        this.bindReportData(this.lastReportPayload);
      },
      () => {
        this.loading = false;
        this.lastReportPayload = null;
        this.cards = [];
        this.tableColumns = [];
        this.tableRows = [];
        this.chartOptions = null;
      }
    );
  }

  private bindReportData(res: any): void {
    this.chartRedrawKey++;
    const t = (key: string, params?: object) => this.translate.instant(key, params);

    if (this.reportType === 'sales') {
      const s = res.summary || {};
      this.cards = [
        { titleKey: 'tr_report_card_total_sales', value: s.totalSales || 0 },
        { titleKey: 'tr_report_card_total_orders', value: s.totalOrders || 0 },
        { titleKey: 'tr_report_card_avg_order', value: s.averageOrderValue || 0 },
      ];
      this.tableColumns = [
        { key: 'period', labelKey: 'tr_report_col_period' },
        { key: 'totalSales', labelKey: 'tr_report_col_sales' },
        { key: 'totalOrders', labelKey: 'tr_report_col_orders' },
      ];
      this.tableRows = res.salesOverTime || [];
      this.chartOptions = this.lineChart(
        t('tr_report_chart_sales_over_time'),
        (res.salesOverTime || []).map((x: any) => x.period),
        [{ name: t('tr_report_series_sales'), data: (res.salesOverTime || []).map((x: any) => Number(x.totalSales || 0)) }]
      );
      return;
    }

    if (this.reportType === 'profit') {
      const s = res.summary || {};
      this.cards = [
        { titleKey: 'tr_report_card_revenue', value: s.totalRevenue || 0 },
        { titleKey: 'tr_report_card_cost', value: s.totalCost || 0 },
        { titleKey: 'tr_net_profit', value: s.netProfit || 0 },
        { titleKey: 'tr_report_card_margin', value: s.profitMargin || 0 },
      ];
      this.tableColumns = [
        { key: 'period', labelKey: 'tr_report_col_period' },
        { key: 'revenue', labelKey: 'tr_report_col_revenue' },
        { key: 'cost', labelKey: 'tr_report_col_cost' },
        { key: 'netProfit', labelKey: 'tr_report_col_net_profit' },
      ];
      this.tableRows = res.profitOverTime || [];
      this.chartOptions = this.lineChart(
        t('tr_report_chart_profit_over_time'),
        (res.profitOverTime || []).map((x: any) => x.period),
        [
          { name: t('tr_report_series_revenue'), data: (res.profitOverTime || []).map((x: any) => Number(x.revenue || 0)) },
          { name: t('tr_report_series_cost'), data: (res.profitOverTime || []).map((x: any) => Number(x.cost || 0)) },
          { name: t('tr_report_series_net'), data: (res.profitOverTime || []).map((x: any) => Number(x.netProfit || 0)) },
        ]
      );
      return;
    }

    if (this.reportType === 'products') {
      this.cards = [
        { titleKey: 'tr_report_card_warehouse_stock', value: res.summary?.stockInWarehouse || 0 },
        { titleKey: 'tr_report_card_warehouse_products', value: res.summary?.warehouseProductsCount || 0 },
        { titleKey: 'tr_report_card_low_stock_threshold', value: res.summary?.lowStockThreshold || 0 },
      ];
      this.tableColumns = [
        { key: 'productName', labelKey: 'tr_report_col_product' },
        { key: 'soldQty', labelKey: 'tr_report_col_sold_qty' },
        { key: 'soldAmount', labelKey: 'tr_report_col_sold_amount' },
      ];
      this.tableRows = res.topSellingProducts || [];
      const barTitle = t('tr_report_chart_top_products');
      this.chartOptions = this.barChart(
        barTitle,
        (res.topSellingProducts || []).map((x: any) => x.productName),
        (res.topSellingProducts || []).map((x: any) => Number(x.soldQty || 0))
      );
      return;
    }

    if (this.reportType === 'stock') {
      const summary = res.summaryByType || [];
      this.cards = summary.map((x: any) => ({
        titleKey: 'tr_report_movement_count',
        titleParams: { type: x.movementType },
        value: x.count,
        hintKey: 'tr_report_qty_hint',
        hintParams: { qty: x.totalQty },
      }));
      this.tableColumns = [
        { key: 'movementType', labelKey: 'tr_report_col_type' },
        { key: 'productName', labelKey: 'tr_report_col_product' },
        { key: 'quantity', labelKey: 'tr_report_col_qty' },
        { key: 'unitPrice', labelKey: 'tr_report_col_unit_price' },
        { key: 'totalValue', labelKey: 'tr_report_col_total_value' },
        { key: 'createdAt', labelKey: 'tr_report_col_date' },
      ];
      this.tableRows = (res.movements || []).map((x: any) => ({ ...x, createdAt: new Date(x.createdAt).toLocaleString() }));
      this.chartOptions = this.pieChart(
        t('tr_report_chart_movements_by_type'),
        summary.map((x: any) => ({ name: String(x.movementType), y: Number(x.count || 0) }))
      );
      return;
    }

    if (this.reportType === 'customers') {
      this.cards = [{ titleKey: 'tr_report_card_top_customers', value: (res.topCustomers || []).length }];
      this.tableColumns = [
        { key: 'customerName', labelKey: 'tr_report_col_customer' },
        { key: 'customerPhone', labelKey: 'tr_report_col_phone' },
        { key: 'totalOrders', labelKey: 'tr_report_col_orders' },
        { key: 'totalSpending', labelKey: 'tr_report_col_spending' },
      ];
      this.tableRows = res.customers || [];
      const barTitle = t('tr_report_chart_top_customers_spending');
      this.chartOptions = this.barChart(
        barTitle,
        (res.topCustomers || []).map((x: any) => x.customerName || x.customerPhone),
        (res.topCustomers || []).map((x: any) => Number(x.totalSpending || 0))
      );
      return;
    }

    if (this.reportType === 'installments') {
      const s = res.summary || {};
      this.cards = [
        { titleKey: 'tr_report_card_paid_count', value: s.paidCount || 0 },
        { titleKey: 'tr_report_card_unpaid_count', value: s.unpaidCount || 0 },
        { titleKey: 'tr_report_card_paid_amount', value: s.paidAmount || 0 },
        { titleKey: 'tr_report_card_unpaid_amount', value: s.unpaidAmount || 0 },
      ];
      this.tableColumns = [
        { key: 'dueDate', labelKey: 'tr_report_col_due_date' },
        { key: 'amount', labelKey: 'tr_amount' },
        { key: 'paid', labelKey: 'tr_paid' },
        { key: 'status', labelKey: 'tr_report_col_request_status' },
      ];
      this.tableRows = [...(res.upcomingInstallments || []), ...(res.overdueInstallments || [])].map((x: any) => ({
        ...x,
        dueDate: new Date(x.dueDate).toLocaleDateString(),
        paid: x.paid ? t('tr_yes') : t('tr_no'),
      }));
      this.chartOptions = this.pieChart(t('tr_report_chart_paid_vs_unpaid'), [
        { name: t('tr_paid'), y: Number(s.paidAmount || 0) },
        { name: t('tr_unpaid'), y: Number(s.unpaidAmount || 0) },
      ]);
    }
  }

  exportExcel(): void {
    const filename = this.translate
      .instant(this.reportTitleKey)
      .replace(/\s+/g, '_')
      .toLowerCase();
    this.exportService.exportToExcel(filename, this.tableRows);
  }

  exportPdf(): void {
    const title = this.translate.instant(this.reportTitleKey);
    const summaryRows = this.cards.map((c) => ({
      label: this.translate.instant(c.titleKey, c.titleParams || {}),
      value: c.value,
    }));
    const colLabels = this.tableColumns.map((c) => this.translate.instant(c.labelKey));
    const pdfRows = this.tableRows.map((row) =>
      this.tableColumns.reduce((acc: Record<string, unknown>, col) => {
        acc[this.translate.instant(col.labelKey)] = row[col.key];
        return acc;
      }, {})
    );
    this.exportService.exportToPdf(title, summaryRows, colLabels, pdfRows);
  }

  printReport(): void {
    window.print();
  }

  private lineChart(title: string, categories: string[], series: any[]): Highcharts.Options {
    const typedSeries = (series || []).map((s) => ({ ...s, type: 'line' as const }));
    return {
      chart: { type: 'line', backgroundColor: 'transparent' },
      title: { text: title },
      credits: { enabled: false },
      xAxis: { categories },
      yAxis: { title: { text: '' } },
      series: typedSeries as any,
    };
  }

  private barChart(title: string, categories: string[], data: number[]): Highcharts.Options {
    return {
      chart: { type: 'column', backgroundColor: 'transparent' },
      title: { text: title },
      credits: { enabled: false },
      xAxis: { categories },
      yAxis: { title: { text: '' } },
      series: [{ type: 'column' as const, name: title, data }] as any,
    };
  }

  private pieChart(title: string, data: { name: string; y: number }[]): Highcharts.Options {
    return {
      chart: { type: 'pie', backgroundColor: 'transparent' },
      title: { text: title },
      credits: { enabled: false },
      plotOptions: {
        pie: {
          allowPointSelect: true,
          cursor: 'pointer',
          dataLabels: { enabled: true, format: '<b>{point.name}</b>: {point.percentage:.1f}%' },
        },
      },
      series: [{ type: 'pie' as const, name: title, data }] as any,
    };
  }
}
