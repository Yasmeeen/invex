import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import * as Highcharts from 'highcharts';
import { ReportsService } from '@shared/services/reports.service';
import { ReportExportService } from '@shared/services/report-export.service';

@Component({
  selector: 'app-reports-page',
  templateUrl: './reports-page.component.html',
  styleUrls: ['./reports-page.component.scss'],
})
export class ReportsPageComponent implements OnInit {
  reportType = 'sales';
  reportTitle = 'Sales Report';
  loading = false;
  filters: any = {};

  cards: { title: string; value: any; hint?: string }[] = [];
  tableColumns: { key: string; label: string }[] = [];
  tableRows: any[] = [];
  /** Null until first successful load so the chart is not initialized with empty options. */
  chartOptions: Highcharts.Options | null = null;
  /** Bumped after each load so Highcharts is recreated (line ↔ pie updates are unreliable with chart.update). */
  chartRedrawKey = 0;

  constructor(
    private route: ActivatedRoute,
    private reportsService: ReportsService,
    private exportService: ReportExportService
  ) {}

  ngOnInit(): void {
    this.route.data.subscribe((d) => {
      this.reportType = d.reportType || 'sales';
      this.reportTitle = `${this.reportType.charAt(0).toUpperCase()}${this.reportType.slice(1)} Report`;
      this.loadReport(this.filters);
    });
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
        this.bindReportData(res || {});
      },
      () => {
        this.loading = false;
        this.cards = [];
        this.tableColumns = [];
        this.tableRows = [];
        this.chartOptions = null;
      }
    );
  }

  private bindReportData(res: any): void {
    this.chartRedrawKey++;
    if (this.reportType === 'sales') {
      const s = res.summary || {};
      this.cards = [
        { title: 'Total Sales', value: s.totalSales || 0 },
        { title: 'Total Orders', value: s.totalOrders || 0 },
        { title: 'Avg Order', value: s.averageOrderValue || 0 },
      ];
      this.tableColumns = [
        { key: 'period', label: 'Period' },
        { key: 'totalSales', label: 'Sales' },
        { key: 'totalOrders', label: 'Orders' },
      ];
      this.tableRows = res.salesOverTime || [];
      this.chartOptions = this.lineChart(
        'Sales Over Time',
        (res.salesOverTime || []).map((x: any) => x.period),
        [{ name: 'Sales', data: (res.salesOverTime || []).map((x: any) => Number(x.totalSales || 0)) }]
      );
      return;
    }

    if (this.reportType === 'profit') {
      const s = res.summary || {};
      this.cards = [
        { title: 'Revenue', value: s.totalRevenue || 0 },
        { title: 'Cost', value: s.totalCost || 0 },
        { title: 'Net Profit', value: s.netProfit || 0 },
        { title: 'Margin %', value: s.profitMargin || 0 },
      ];
      this.tableColumns = [
        { key: 'period', label: 'Period' },
        { key: 'revenue', label: 'Revenue' },
        { key: 'cost', label: 'Cost' },
        { key: 'netProfit', label: 'Net Profit' },
      ];
      this.tableRows = res.profitOverTime || [];
      this.chartOptions = this.lineChart(
        'Profit Over Time',
        (res.profitOverTime || []).map((x: any) => x.period),
        [
          { name: 'Revenue', data: (res.profitOverTime || []).map((x: any) => Number(x.revenue || 0)) },
          { name: 'Cost', data: (res.profitOverTime || []).map((x: any) => Number(x.cost || 0)) },
          { name: 'Net', data: (res.profitOverTime || []).map((x: any) => Number(x.netProfit || 0)) },
        ]
      );
      return;
    }

    if (this.reportType === 'products') {
      this.cards = [
        { title: 'Warehouse Stock', value: res.summary?.stockInWarehouse || 0 },
        { title: 'Warehouse Products', value: res.summary?.warehouseProductsCount || 0 },
        { title: 'Low Stock Threshold', value: res.summary?.lowStockThreshold || 0 },
      ];
      this.tableColumns = [
        { key: 'productName', label: 'Product' },
        { key: 'soldQty', label: 'Sold Qty' },
        { key: 'soldAmount', label: 'Sold Amount' },
      ];
      this.tableRows = res.topSellingProducts || [];
      this.chartOptions = this.barChart(
        'Top Selling Products',
        (res.topSellingProducts || []).map((x: any) => x.productName),
        (res.topSellingProducts || []).map((x: any) => Number(x.soldQty || 0))
      );
      return;
    }

    if (this.reportType === 'stock') {
      const summary = res.summaryByType || [];
      this.cards = summary.map((x: any) => ({
        title: `${x.movementType} count`,
        value: x.count,
        hint: `Qty: ${x.totalQty}`,
      }));
      this.tableColumns = [
        { key: 'movementType', label: 'Type' },
        { key: 'productName', label: 'Product' },
        { key: 'quantity', label: 'Qty' },
        { key: 'unitPrice', label: 'Unit Price' },
        { key: 'totalValue', label: 'Total Value' },
        { key: 'createdAt', label: 'Date' },
      ];
      this.tableRows = (res.movements || []).map((x: any) => ({ ...x, createdAt: new Date(x.createdAt).toLocaleString() }));
      this.chartOptions = this.pieChart(
        'Movements By Type',
        summary.map((x: any) => ({ name: x.movementType, y: Number(x.count || 0) }))
      );
      return;
    }

    if (this.reportType === 'customers') {
      this.cards = [{ title: 'Top Customers', value: (res.topCustomers || []).length }];
      this.tableColumns = [
        { key: 'customerName', label: 'Customer' },
        { key: 'customerPhone', label: 'Phone' },
        { key: 'totalOrders', label: 'Orders' },
        { key: 'totalSpending', label: 'Spending' },
      ];
      this.tableRows = res.customers || [];
      this.chartOptions = this.barChart(
        'Top Customers Spending',
        (res.topCustomers || []).map((x: any) => x.customerName || x.customerPhone),
        (res.topCustomers || []).map((x: any) => Number(x.totalSpending || 0))
      );
      return;
    }

    if (this.reportType === 'installments') {
      const s = res.summary || {};
      this.cards = [
        { title: 'Paid Count', value: s.paidCount || 0 },
        { title: 'Unpaid Count', value: s.unpaidCount || 0 },
        { title: 'Paid Amount', value: s.paidAmount || 0 },
        { title: 'Unpaid Amount', value: s.unpaidAmount || 0 },
      ];
      this.tableColumns = [
        { key: 'dueDate', label: 'Due Date' },
        { key: 'amount', label: 'Amount' },
        { key: 'paid', label: 'Paid' },
        { key: 'status', label: 'Request Status' },
      ];
      this.tableRows = [...(res.upcomingInstallments || []), ...(res.overdueInstallments || [])].map((x: any) => ({
        ...x,
        dueDate: new Date(x.dueDate).toLocaleDateString(),
        paid: x.paid ? 'Yes' : 'No',
      }));
      this.chartOptions = this.pieChart('Paid vs Unpaid', [
        { name: 'Paid', y: Number(s.paidAmount || 0) },
        { name: 'Unpaid', y: Number(s.unpaidAmount || 0) },
      ]);
    }
  }

  exportExcel(): void {
    this.exportService.exportToExcel(this.reportTitle.replace(/\s+/g, '_').toLowerCase(), this.tableRows);
  }

  exportPdf(): void {
    this.exportService.exportToPdf(
      this.reportTitle,
      this.cards.map((c) => ({ label: c.title, value: c.value })),
      this.tableColumns.map((c) => c.label),
      this.tableRows.map((row) =>
        this.tableColumns.reduce((acc: any, col) => {
          acc[col.label] = row[col.key];
          return acc;
        }, {})
      )
    );
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

