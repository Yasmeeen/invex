import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import * as Highcharts from 'highcharts';
import { TranslateService } from '@ngx-translate/core';
import { Subscription } from 'rxjs';
import { AuthenticationService } from '@core/services/authentication.service';
import { isBranchManager } from '@core/utils/role-utils';
import { ReportsService } from '@shared/services/reports.service';
import { ReportExportService } from '@shared/services/report-export.service';
import { formatEgpMoney } from '@shared/utils/money.util';
import {
  BookingsReportResponse,
  ProductBookingsService,
} from '@shared/services/product-bookings.service';

type ReportCardVM = {
  titleKey: string;
  titleParams?: Record<string, unknown>;
  value: any;
  hintKey?: string;
  hintParams?: Record<string, unknown>;
  /** Optional trend pill text, e.g. `2.31%` (arrow added by card). */
  trendLabel?: string;
  /** false → red/down pill; true/omit → green/up. */
  trendPositive?: boolean;
  /** Format value as EGP currency (thousands separators + pound symbol). */
  money?: boolean;
  /** Red styling + loss messaging when period is at a loss. */
  tone?: 'loss';
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
  tableColumns: { key: string; labelKey: string; format?: 'money' }[] = [];
  tableRows: any[] = [];
  /** Null until first successful load so the chart is not initialized with empty options. */
  chartOptions: Highcharts.Options | null = null;
  /** Bumped after each load so Highcharts is recreated (line ↔ pie updates are unreliable with chart.update). */
  chartRedrawKey = 0;
  chartBranchRedrawKey = 0;
  /** Bookings report: branch distribution pie. */
  secondaryChartOptions: Highcharts.Options | null = null;

  bookingsPage = 1;
  bookingsLimit = 100;
  bookingsMeta: { totalCount: number; page: number; limit: number } | null = null;
  topProductsColumns: { key: string; labelKey: string; format?: 'money' }[] = [];
  topProductsRows: any[] = [];
  upcomingColumns: { key: string; labelKey: string; format?: 'money' }[] = [];
  upcomingRows: any[] = [];

  /** Desk purchases: detail lines below treasury summary. */
  deskPurchasesDetailColumns: { key: string; labelKey: string; format?: 'money' }[] = [];
  deskPurchasesDetailRows: any[] = [];

  /** Sales report: breakdown by cash / card / application payment types. */
  salesPaymentColumns: { key: string; labelKey: string; format?: 'money' }[] = [];
  salesPaymentRows: any[] = [];

  /** Products report: inventory capital per branch. */
  branchCapitalColumns: { key: string; labelKey: string; format?: 'money' }[] = [];
  branchCapitalRows: any[] = [];

  private lastReportPayload: any = null;
  private langSub?: Subscription;

  private readonly reportTitleKeys: Record<string, string> = {
    sales: 'tr_report_title_sales',
    profit: 'tr_report_title_profit',
    products: 'tr_report_title_products',
    stock: 'tr_report_title_stock',
    customers: 'tr_report_title_customers',
    installments: 'tr_report_title_installments',
    bookings: 'tr_report_title_bookings',
    deskPurchases: 'tr_report_title_desk_purchases',
  };

  constructor(
    private route: ActivatedRoute,
    private reportsService: ReportsService,
    private exportService: ReportExportService,
    private translate: TranslateService,
    private authenticationService: AuthenticationService,
    private productBookingsService: ProductBookingsService
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
      this.bookingsPage = 1;
      this.secondaryChartOptions = null;
      // First paint: wait for report-filters to emit defaults (from/to/branch). Later navigations reuse `filters`.
      if (Object.keys(this.filters || {}).length > 0) {
        this.loadReport(this.filters);
      }
    });
  }

  ngOnDestroy(): void {
    this.langSub?.unsubscribe();
  }

  onApplyFilters(filters: any): void {
    this.filters = this.mergeBranchScope({ ...filters });
    if (this.reportType === 'bookings') {
      this.bookingsPage = 1;
    }
    this.loadReport(this.filters);
  }

  /** Ensure Branch Manager cannot query other branches via API. */
  private mergeBranchScope(payload: Record<string, unknown>): Record<string, unknown> {
    const u = this.authenticationService.getUserFromLocalStorage();
    if (isBranchManager(u?.role) && u?.branch?._id) {
      return { ...payload, branch_id: String(u.branch._id) };
    }
    return payload;
  }

  setBookingsPage(page: number): void {
    this.bookingsPage = Math.max(1, page);
    if (Object.keys(this.filters || {}).length > 0) {
      this.loadReport(this.filters);
    }
  }

  get bookingsTotalPages(): number {
    const m = this.bookingsMeta;
    if (!m || !m.limit) return 1;
    return Math.max(1, Math.ceil((m.totalCount || 0) / m.limit));
  }

  private loadReport(filters: any): void {
    if (this.reportType === 'bookings') {
      const scoped = this.mergeBranchScope({
        ...filters,
        page: this.bookingsPage,
        limit: this.bookingsLimit,
      });
      this.loading = true;
      this.productBookingsService.getReport(scoped).subscribe(
        (res: BookingsReportResponse) => {
          this.loading = false;
          this.lastReportPayload = res;
          this.bindReportData(res);
        },
        () => {
          this.loading = false;
          this.lastReportPayload = null;
          this.cards = [];
          this.tableColumns = [];
          this.tableRows = [];
          this.chartOptions = null;
          this.secondaryChartOptions = null;
          this.bookingsMeta = null;
          this.topProductsRows = [];
          this.upcomingRows = [];
          this.salesPaymentColumns = [];
          this.salesPaymentRows = [];
          this.deskPurchasesDetailColumns = [];
          this.deskPurchasesDetailRows = [];
        }
      );
      return;
    }

    const scoped = this.mergeBranchScope({ ...filters });
    this.loading = true;
    const map: any = {
      sales: this.reportsService.getSalesReport.bind(this.reportsService),
      profit: this.reportsService.getProfitReport.bind(this.reportsService),
      products: this.reportsService.getProductsReport.bind(this.reportsService),
      stock: this.reportsService.getStockReport.bind(this.reportsService),
      customers: this.reportsService.getCustomersReport.bind(this.reportsService),
      installments: this.reportsService.getInstallmentsReport.bind(this.reportsService),
      deskPurchases: this.reportsService.getDeskPurchasesTreasuryReport.bind(this.reportsService),
    };

    map[this.reportType](scoped).subscribe(
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
        this.secondaryChartOptions = null;
        this.salesPaymentColumns = [];
        this.salesPaymentRows = [];
        this.deskPurchasesDetailColumns = [];
        this.deskPurchasesDetailRows = [];
        this.branchCapitalColumns = [];
        this.branchCapitalRows = [];
      }
    );
  }

  private bindReportData(res: any): void {
    this.chartRedrawKey++;
    this.chartBranchRedrawKey++;
    this.secondaryChartOptions = null;
    this.salesPaymentColumns = [];
    this.salesPaymentRows = [];
    this.deskPurchasesDetailColumns = [];
    this.deskPurchasesDetailRows = [];
    this.branchCapitalColumns = [];
    this.branchCapitalRows = [];
    const t = (key: string, params?: object) => this.translate.instant(key, params);

    if (this.reportType === 'bookings') {
      this.bindBookingsReportData(res as BookingsReportResponse, t);
      return;
    }

    if (this.reportType === 'sales') {
      const s = res.summary || {};
      this.cards = [
        { titleKey: 'tr_report_card_total_sales', value: s.totalSales || 0, money: true },
        { titleKey: 'tr_report_card_total_orders', value: s.totalOrders || 0 },
        { titleKey: 'tr_report_card_avg_order', value: s.averageOrderValue || 0, money: true },
      ];
      this.tableColumns = [
        { key: 'period', labelKey: 'tr_report_col_period' },
        { key: 'totalSales', labelKey: 'tr_report_col_sales', format: 'money' },
        { key: 'totalOrders', labelKey: 'tr_report_col_orders' },
      ];
      this.tableRows = res.salesOverTime || [];
      this.chartOptions = this.lineChart(
        t('tr_report_chart_sales_over_time'),
        (res.salesOverTime || []).map((x: any) => x.period),
        [{ name: t('tr_report_series_sales'), data: (res.salesOverTime || []).map((x: any) => Number(x.totalSales || 0)) }]
      );

      const paymentCats = res.salesByPaymentCategory || [];
      const categoryOrder = ['cash', 'card', 'application'];
      const catLabelKey: Record<string, string> = {
        cash: 'tr_report_payment_category_cash',
        card: 'tr_report_payment_category_card',
        application: 'tr_report_payment_category_application',
      };
      const sortedPayment = [...paymentCats].sort(
        (a: any, b: any) => categoryOrder.indexOf(a.category) - categoryOrder.indexOf(b.category)
      );
      this.salesPaymentColumns = [
        { key: 'paymentType', labelKey: 'tr_report_col_payment_type' },
        { key: 'totalSales', labelKey: 'tr_report_col_sales', format: 'money' },
        { key: 'totalOrders', labelKey: 'tr_report_col_orders' },
      ];
      this.salesPaymentRows = sortedPayment.map((x: any) => ({
        paymentType: t(catLabelKey[x.category] || x.category),
        totalSales: x.totalSales,
        totalOrders: x.totalOrders,
      }));
      const piePay = sortedPayment
        .filter((x: any) => Number(x.totalSales || 0) > 0)
        .map((x: any) => ({
          name: t(catLabelKey[x.category] || x.category),
          y: Number(x.totalSales || 0),
        }));
      this.secondaryChartOptions =
        piePay.length > 0 ? this.pieChart(t('tr_report_chart_sales_by_payment'), piePay) : null;
      return;
    }

    if (this.reportType === 'profit') {
      const s = res.summary || {};
      const bo = s.branchOverhead;
      const tradingProfit = Number(s.tradingProfit) || 0;
      const netProfit = Number(s.netProfit) || 0;
      const profitMargin = s.profitMargin != null ? Number(s.profitMargin) : 0;
      const tradingIsLoss = tradingProfit < 0;
      const netIsLoss = netProfit < 0;
      const marginIsLoss = profitMargin < 0;
      const lossBadge = t('tr_report_loss_badge');
      this.cards = [
        { titleKey: 'tr_report_card_revenue', value: s.totalRevenue ?? 0, money: true },
        { titleKey: 'tr_report_card_cost', value: s.totalCost ?? 0, money: true },
        {
          titleKey: tradingIsLoss
            ? 'tr_report_card_trading_loss'
            : 'tr_report_card_trading_profit',
          value: tradingIsLoss ? Math.abs(tradingProfit) : tradingProfit,
          money: true,
          tone: tradingIsLoss ? 'loss' : undefined,
          trendLabel: tradingIsLoss ? lossBadge : undefined,
          trendPositive: tradingIsLoss ? false : undefined,
          hintKey: tradingIsLoss ? 'tr_report_trading_loss_hint' : undefined,
        },
        {
          titleKey: 'tr_report_card_branch_overhead',
          value: s.branchOperatingCost ?? 0,
          money: true,
          hintKey: bo ? 'tr_report_branch_overhead_hint' : undefined,
          hintParams: bo
            ? {
                monthly: formatEgpMoney(bo.monthlyFixedTotal),
                daily: formatEgpMoney(bo.dailyRate),
                days: bo.daysInPeriod,
                divisor: bo.divisorDays,
              }
            : undefined,
        },
        {
          titleKey: 'tr_report_card_daily_expenses',
          value: s.dailyExpensesTotal ?? 0,
          money: true,
          hintKey: 'tr_report_daily_expenses_hint',
          hintParams: { count: s.dailyExpensesCount ?? 0 },
        },
        {
          titleKey: netIsLoss ? 'tr_net_loss' : 'tr_net_profit',
          value: netIsLoss ? Math.abs(netProfit) : netProfit,
          money: true,
          tone: netIsLoss ? 'loss' : undefined,
          trendLabel: netIsLoss ? lossBadge : undefined,
          trendPositive: netIsLoss ? false : undefined,
          hintKey: netIsLoss ? 'tr_report_net_loss_hint' : undefined,
        },
        {
          titleKey: marginIsLoss ? 'tr_report_card_loss_margin' : 'tr_report_card_margin',
          value: `${Math.abs(profitMargin).toFixed(2)}%`,
          tone: marginIsLoss ? 'loss' : undefined,
          trendLabel: marginIsLoss ? lossBadge : undefined,
          trendPositive: marginIsLoss ? false : undefined,
          hintKey: marginIsLoss ? 'tr_report_loss_margin_hint' : undefined,
        },
      ];
      this.tableColumns = [
        { key: 'period', labelKey: 'tr_report_col_period' },
        { key: 'revenue', labelKey: 'tr_report_col_revenue', format: 'money' },
        { key: 'cost', labelKey: 'tr_report_col_cost', format: 'money' },
        { key: 'tradingProfit', labelKey: 'tr_report_col_trading_profit', format: 'money' },
        { key: 'branchOverheadAllocated', labelKey: 'tr_report_col_branch_overhead', format: 'money' },
        { key: 'dailyExpenses', labelKey: 'tr_report_col_daily_expenses', format: 'money' },
        { key: 'netProfit', labelKey: 'tr_report_col_net_profit_after_branch', format: 'money' },
      ];
      this.tableRows = res.profitOverTime || [];
      this.chartOptions = this.lineChart(
        t('tr_report_chart_profit_over_time'),
        (res.profitOverTime || []).map((x: any) => x.period),
        [
          { name: t('tr_report_series_revenue'), data: (res.profitOverTime || []).map((x: any) => Number(x.revenue || 0)) },
          { name: t('tr_report_series_cost'), data: (res.profitOverTime || []).map((x: any) => Number(x.cost || 0)) },
          { name: t('tr_report_series_net_after_branch'), data: (res.profitOverTime || []).map((x: any) => Number(x.netProfit || 0)) },
        ]
      );
      return;
    }

    if (this.reportType === 'products') {
      const s = res.summary || {};
      this.cards = [
        {
          titleKey: 'tr_report_card_inventory_capital',
          value: s.inventoryCapital ?? 0,
          hintKey: 'tr_report_inventory_capital_hint',
          money: true,
        },
        {
          titleKey: 'tr_report_card_branches_inventory_capital',
          value: s.branchesInventoryCapital ?? 0,
          money: true,
        },
        {
          titleKey: 'tr_report_card_warehouse_inventory_capital',
          value: s.warehouseInventoryCapital ?? 0,
          money: true,
        },
        { titleKey: 'tr_report_card_total_stock', value: s.totalStock || 0 },
        { titleKey: 'tr_report_card_branches_stock', value: s.branchesStock || 0 },
        { titleKey: 'tr_report_card_warehouse_stock', value: s.stockInWarehouse || 0 },
      ];

      const perBranch = res.stockPerBranch || [];
      this.branchCapitalColumns = [
        { key: 'branchName', labelKey: 'tr_branch' },
        { key: 'productsCount', labelKey: 'tr_report_col_products_count' },
        { key: 'totalStock', labelKey: 'tr_report_col_stock' },
        { key: 'inventoryCapital', labelKey: 'tr_report_col_inventory_capital', format: 'money' },
      ];
      this.branchCapitalRows = perBranch.map((x: any) => ({
        branchName: x.branchName || '—',
        productsCount: x.productsCount || 0,
        totalStock: x.totalStock || 0,
        inventoryCapital: x.inventoryCapital ?? 0,
      }));

      this.tableColumns = [
        { key: 'productName', labelKey: 'tr_report_col_product' },
        { key: 'soldQty', labelKey: 'tr_report_col_sold_qty' },
        { key: 'soldAmount', labelKey: 'tr_report_col_sold_amount', format: 'money' },
      ];
      this.tableRows = res.topSellingProducts || [];

      if (perBranch.length > 0) {
        this.chartOptions = this.barChart(
          t('tr_report_chart_capital_by_branch'),
          perBranch.map((x: any) => x.branchName || '—'),
          perBranch.map((x: any) => Number(x.inventoryCapital || 0))
        );
      } else {
        this.chartOptions = this.barChart(
          t('tr_report_chart_top_products'),
          (res.topSellingProducts || []).map((x: any) => x.productName),
          (res.topSellingProducts || []).map((x: any) => Number(x.soldQty || 0))
        );
      }
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
        { key: 'unitPrice', labelKey: 'tr_report_col_unit_price', format: 'money' },
        { key: 'totalValue', labelKey: 'tr_report_col_total_value', format: 'money' },
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
        { key: 'totalSpending', labelKey: 'tr_report_col_spending', format: 'money' },
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

    if (this.reportType === 'deskPurchases') {
      const s = res.summary || {};
      this.cards = [
        { titleKey: 'tr_report_desk_purchases_total_cost', value: s.totalAmount ?? 0, money: true },
        { titleKey: 'tr_report_desk_purchases_intakes', value: s.totalIntakes ?? 0 },
      ];
      this.tableColumns = [
        { key: 'treasuryLabel', labelKey: 'tr_report_col_purchase_treasury' },
        { key: 'totalAmount', labelKey: 'tr_report_col_amount', format: 'money' },
        { key: 'intakeCount', labelKey: 'tr_report_desk_purchases_col_intakes' },
      ];
      const bt = s.byTreasury || [];
      this.tableRows = bt.map((x: any) => ({
        treasuryLabel: x.treasuryLabel ? `${x.treasuryLabel} (${x.treasuryKey})` : x.treasuryKey,
        totalAmount: x.totalAmount,
        intakeCount: x.intakeCount,
      }));
      const piePay = bt
        .filter((x: any) => Number(x.totalAmount || 0) > 0)
        .map((x: any) => ({
          name: String(x.treasuryLabel || x.treasuryKey || ''),
          y: Number(x.totalAmount || 0),
        }));
      this.secondaryChartOptions =
        piePay.length > 0 ? this.pieChart(t('tr_report_desk_purchases_by_treasury'), piePay) : null;
      this.chartOptions = null;

      this.deskPurchasesDetailColumns = [
        { key: 'createdAt', labelKey: 'tr_daily_expenses_recorded_at' },
        { key: 'branchName', labelKey: 'tr_branch' },
        { key: 'treasuryLabel', labelKey: 'tr_report_col_purchase_treasury' },
        { key: 'productName', labelKey: 'tr_report_col_product' },
        { key: 'productCode', labelKey: 'tr_code' },
        { key: 'quantity', labelKey: 'tr_report_col_qty' },
        { key: 'unitCost', labelKey: 'tr_purchase_price', format: 'money' },
        { key: 'lineTotal', labelKey: 'tr_report_col_amount', format: 'money' },
      ];
      this.deskPurchasesDetailRows = (res.lines || []).map((x: any) => ({
        createdAt: x.createdAt ? new Date(x.createdAt).toLocaleString() : '',
        branchName: x.branchName || '',
        treasuryLabel: x.treasuryLabel || x.treasuryKey || '',
        productName: x.productName || '',
        productCode: x.productCode || '',
        quantity: x.quantity,
        unitCost: x.unitCost,
        lineTotal: x.lineTotal,
      }));
      return;
    }

    if (this.reportType === 'installments') {
      const s = res.summary || {};
      this.cards = [
        { titleKey: 'tr_report_card_paid_count', value: s.paidCount || 0 },
        { titleKey: 'tr_report_card_unpaid_count', value: s.unpaidCount || 0 },
        { titleKey: 'tr_report_card_paid_amount', value: s.paidAmount || 0, money: true },
        { titleKey: 'tr_report_card_unpaid_amount', value: s.unpaidAmount || 0, money: true },
      ];
      this.tableColumns = [
        { key: 'dueDate', labelKey: 'tr_report_col_due_date' },
        { key: 'amount', labelKey: 'tr_amount', format: 'money' },
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
      return;
    }
  }

  private bindBookingsReportData(res: BookingsReportResponse, t: (key: string, params?: object) => string): void {
    const s = res.summary || ({} as BookingsReportResponse['summary']);
    this.bookingsMeta = res.meta || null;
    this.cards = [
      { titleKey: 'tr_bookings_report_card_total', value: s.totalBookings || 0 },
      { titleKey: 'tr_bookings_report_card_units', value: s.totalUnits || 0 },
      { titleKey: 'tr_bookings_report_card_deposits', value: s.totalDeposits || 0, money: true },
      { titleKey: 'tr_bookings_report_card_active', value: s.activeCount || 0 },
      { titleKey: 'tr_bookings_report_card_cancelled', value: s.cancelledCount || 0 },
      { titleKey: 'tr_bookings_report_card_confirmed', value: s.confirmedActive || 0 },
      { titleKey: 'tr_bookings_report_card_pending_confirm', value: s.pendingConfirmation || 0 },
    ];
    this.tableColumns = [
      { key: 'bookingDate', labelKey: 'tr_booking_date' },
      { key: 'productName', labelKey: 'tr_report_col_product' },
      { key: 'productCode', labelKey: 'tr_bookings_report_col_code' },
      { key: 'quantity', labelKey: 'tr_report_col_qty' },
      { key: 'location', labelKey: 'tr_bookings_report_col_location' },
      { key: 'customerName', labelKey: 'tr_booking_customer_name' },
      { key: 'customerPhone', labelKey: 'tr_booking_customer_phone' },
      { key: 'transferReferencePhone', labelKey: 'tr_booking_transfer_reference_phone' },
      { key: 'pickup', labelKey: 'tr_booking_pickup_type' },
      { key: 'depositAmount', labelKey: 'tr_booking_deposit', format: 'money' },
      { key: 'depositProof', labelKey: 'tr_booking_deposit_proof' },
      { key: 'createdBy', labelKey: 'tr_requested_by' },
      { key: 'status', labelKey: 'tr_report_col_request_status' },
      { key: 'confirmed', labelKey: 'tr_bookings_report_col_confirmed' },
      { key: 'confirmedBy', labelKey: 'tr_bookings_report_col_confirmed_by' },
    ];
    const rows = (res.bookings || []) as any[];
    this.tableRows = rows.map((b) => ({
      bookingDate: b.bookingDate ? new Date(b.bookingDate).toLocaleDateString() : '',
      productName: b.product?.name ?? '',
      productCode: b.product?.code ?? '',
      quantity: b.quantity ?? 1,
      location:
        b.product?.inWarehouse || b.productInWarehouse
          ? t('tr_bookings_report_warehouse')
          : b.branch?.name || '—',
      customerName: b.customerName ?? '',
      customerPhone: b.customerPhone ?? '',
      transferReferencePhone: b.transferReferencePhone ?? '—',
      pickup:
        b.pickupType === 'online_shipping'
          ? t('tr_booking_online_shipping')
          : t('tr_booking_branch_pickup'),
      depositAmount: b.depositAmount ?? 0,
      depositProof: (() => {
        const urls = Array.isArray(b.depositTransferImageUrls) ? b.depositTransferImageUrls : [];
        const first = b.depositTransferImageUrl && String(b.depositTransferImageUrl).trim();
        const list =
          urls.length > 0
            ? urls.map((u: string) => String(u || '').trim()).filter(Boolean)
            : first
              ? [first]
              : [];
        return list.length ? list.join('\n') : '—';
      })(),
      createdBy:
        (typeof b.createdBy === 'object' && b.createdBy?.name ? b.createdBy.name : b.createdBy) || '',
      status: b.status ?? '',
      confirmed: b.confirmed ? t('tr_yes') : t('tr_no'),
      confirmedBy:
        (typeof b.confirmedBy === 'object' && b.confirmedBy?.name ? b.confirmedBy.name : b.confirmedBy) || '—',
    }));

    this.topProductsColumns = [
      { key: 'productName', labelKey: 'tr_report_col_product' },
      { key: 'productCode', labelKey: 'tr_bookings_report_col_code' },
      { key: 'bookingCount', labelKey: 'tr_bookings_report_col_booking_count' },
      { key: 'totalQty', labelKey: 'tr_bookings_report_col_qty_sum' },
    ];
    this.topProductsRows = (res.topProducts || []).map((x) => ({
      productName: x.productName ?? '',
      productCode: x.productCode ?? '',
      bookingCount: x.bookingCount,
      totalQty: x.totalQty,
    }));

    this.upcomingColumns = [
      { key: 'bookingDate', labelKey: 'tr_booking_date' },
      { key: 'productName', labelKey: 'tr_report_col_product' },
      { key: 'quantity', labelKey: 'tr_report_col_qty' },
      { key: 'customerName', labelKey: 'tr_booking_customer_name' },
      { key: 'phone', labelKey: 'tr_booking_customer_phone' },
    ];
    this.upcomingRows = ((res.upcoming || []) as any[]).map((u) => ({
      bookingDate: u.bookingDate ? new Date(u.bookingDate).toLocaleDateString() : '',
      productName: u.product?.name ?? '',
      quantity: u.quantity ?? 1,
      customerName: u.customerName ?? '',
      phone: u.customerPhone ?? '',
    }));

    const over = res.bookingsOverTime || [];
    this.chartOptions = this.lineChart(
      t('tr_bookings_chart_over_time'),
      over.map((x) => x.period),
      [{ name: t('tr_bookings_series_count'), data: over.map((x) => Number(x.count || 0)) }]
    );

    const byBr = res.byBranch || [];
    this.secondaryChartOptions =
      byBr.length > 0
        ? this.bookingsBranchDonutChart(
            t('tr_bookings_chart_by_branch'),
            byBr.map((x) => ({ name: String(x.branchName), y: Number(x.totalBookings || 0) }))
          )
        : null;
  }

  exportExcel(): void {
    const filename = this.translate
      .instant(this.reportTitleKey)
      .replace(/\s+/g, '_')
      .toLowerCase();

    if (this.reportType === 'products') {
      const t = (key: string) => this.translate.instant(key);
      const summaryRows = this.cards.map((c) => ({
        [t('tr_report_col_label')]: this.translate.instant(c.titleKey, c.titleParams || {}),
        [t('tr_report_col_value')]: this.formatCardExportValue(c),
      }));
      const capitalRows = this.mapRowsForExport(this.branchCapitalColumns, this.branchCapitalRows);
      const topRows = this.mapRowsForExport(this.tableColumns, this.tableRows);
      const sheets: { name: string; rows: Record<string, unknown>[] }[] = [
        { name: t('tr_report_sheet_summary'), rows: summaryRows },
      ];
      if (capitalRows.length > 0) {
        sheets.push({ name: t('tr_report_capital_by_branch'), rows: capitalRows });
      }
      if (topRows.length > 0) {
        sheets.push({ name: t('tr_report_chart_top_products'), rows: topRows });
      }
      this.exportService.exportToExcelMultiSheet(filename, sheets);
      return;
    }

    this.exportService.exportToExcel(
      filename,
      this.mapRowsForExport(this.tableColumns, this.tableRows)
    );
  }

  async exportPdf(): Promise<void> {
    const title = this.translate.instant(this.reportTitleKey);
    const summaryRows = this.cards.map((c) => ({
      label: this.translate.instant(c.titleKey, c.titleParams || {}),
      value: this.formatCardExportValue(c),
    }));

    if (this.reportType === 'products') {
      const sections = [];
      if (this.branchCapitalRows.length > 0) {
        sections.push({
          title: this.translate.instant('tr_report_capital_by_branch'),
          columns: this.branchCapitalColumns.map((c) => this.translate.instant(c.labelKey)),
          rows: this.mapRowsForExport(this.branchCapitalColumns, this.branchCapitalRows),
        });
      }
      if (this.tableRows.length > 0) {
        sections.push({
          title: this.translate.instant('tr_report_chart_top_products'),
          columns: this.tableColumns.map((c) => this.translate.instant(c.labelKey)),
          rows: this.mapRowsForExport(this.tableColumns, this.tableRows),
        });
      }
      if (sections.length === 0) {
        sections.push({
          title: this.translate.instant('tr_report_sheet_summary'),
          columns: [
            this.translate.instant('tr_report_col_label'),
            this.translate.instant('tr_report_col_value'),
          ],
          rows: summaryRows.map((r) => ({
            [this.translate.instant('tr_report_col_label')]: r.label,
            [this.translate.instant('tr_report_col_value')]: r.value,
          })),
        });
      }
      await this.exportService.exportMultiSectionPdf(title, summaryRows, sections);
      return;
    }

    const colLabels = this.tableColumns.map((c) => this.translate.instant(c.labelKey));
    const pdfRows = this.mapRowsForExport(this.tableColumns, this.tableRows);
    await this.exportService.exportToPdf(title, summaryRows, colLabels, pdfRows);
  }

  private formatCardExportValue(c: ReportCardVM): string | number {
    const raw = c.money ? formatEgpMoney(c.value) : c.value;
    if (c.tone === 'loss') {
      return `${this.translate.instant('tr_report_loss_badge')}: ${raw}`;
    }
    return raw;
  }

  private mapRowsForExport(
    columns: { key: string; labelKey: string; format?: 'money' }[],
    rows: any[]
  ): Record<string, unknown>[] {
    return (rows || []).map((row) =>
      columns.reduce((acc: Record<string, unknown>, col) => {
        const raw = row[col.key];
        acc[this.translate.instant(col.labelKey)] =
          col.format === 'money' ? formatEgpMoney(raw) : raw;
        return acc;
      }, {})
    );
  }

  printReport(): void {
    window.print();
  }

  /** Purple theme (matches report cards / admin primary). */
  private readonly chartColors = [
    '#4c1d95',
    '#5b21b6',
    '#6d28d9',
    '#7c3aed',
    '#8b5cf6',
    '#a78bfa',
    '#c026d3',
  ];

  /** Multi-series lines (profit): revenue (violet), cost (slate), net (teal — distinct from revenue). */
  private readonly chartLineContrast = ['#5b21b6', '#64748b', '#0d9488'];

  /** Light / dark mauve alternation for bookings-by-branch donut (readable contrast). */
  private readonly bookingsDonutColors = [
    '#e9d5ff',
    '#5b21b6',
    '#ddd6fe',
    '#6d28d9',
    '#f3e8ff',
    '#4c1d95',
    '#c4b5fd',
    '#7e22ce',
  ];

  private chartTitleStyle(text: string): Highcharts.TitleOptions {
    return {
      text,
      style: { color: '#5b21b6', fontSize: '16px', fontWeight: '600', fontFamily: 'inherit' },
    };
  }

  private lineSeriesColor(index: number, total: number): string {
    if (total > 1 && index < this.chartLineContrast.length) {
      return this.chartLineContrast[index];
    }
    return this.chartColors[index % this.chartColors.length];
  }

  private lineChart(title: string, categories: string[], series: any[]): Highcharts.Options {
    const list = series || [];
    const n = list.length;
    const themedSeries = list.map((s, i) => {
      const c = this.lineSeriesColor(i, n);
      return {
        ...s,
        type: 'line' as const,
        color: c,
        marker: {
          enabled: true,
          fillColor: '#ffffff',
          lineWidth: 2,
          lineColor: c,
        },
      };
    });
    return {
      chart: { type: 'line', backgroundColor: 'transparent' },
      colors: this.chartColors,
      title: this.chartTitleStyle(title),
      credits: { enabled: false },
      legend: {
        itemStyle: { color: '#475569', fontWeight: '500', fontFamily: 'inherit' },
        itemHoverStyle: { color: '#6d28d9' },
      },
      xAxis: {
        categories,
        lineColor: '#e2e8f0',
        tickColor: '#e2e8f0',
        labels: { style: { color: '#64748b', fontFamily: 'inherit' } },
        gridLineColor: '#f1f5f9',
      },
      yAxis: {
        title: { text: '', style: { color: '#64748b' } },
        gridLineColor: '#eef2f6',
        labels: { style: { color: '#64748b', fontFamily: 'inherit' } },
      },
      series: themedSeries as any,
    };
  }

  private barChart(title: string, categories: string[], data: number[]): Highcharts.Options {
    return {
      chart: { type: 'column', backgroundColor: 'transparent' },
      colors: this.chartColors,
      title: this.chartTitleStyle(title),
      credits: { enabled: false },
      legend: {
        itemStyle: { color: '#475569', fontWeight: '500', fontFamily: 'inherit' },
        itemHoverStyle: { color: '#6d28d9' },
      },
      xAxis: {
        categories,
        lineColor: '#e2e8f0',
        tickColor: '#e2e8f0',
        labels: { style: { color: '#64748b', fontFamily: 'inherit' } },
        gridLineColor: '#f1f5f9',
      },
      yAxis: {
        title: { text: '', style: { color: '#64748b' } },
        gridLineColor: '#eef2f6',
        labels: { style: { color: '#64748b', fontFamily: 'inherit' } },
      },
      plotOptions: {
        column: {
          borderRadius: 4,
          borderWidth: 0,
          colorByPoint: true,
        },
      },
      series: [{ type: 'column' as const, name: title, data }] as any,
    };
  }

  /** Donut (pie with inner hole) — used for all circular report charts. */
  private donutChart(
    title: string,
    data: { name: string; y: number }[],
    colors: string[],
    legendHoverColor: string
  ): Highcharts.Options {
    return {
      chart: { type: 'pie', backgroundColor: 'transparent' },
      colors,
      title: this.chartTitleStyle(title),
      credits: { enabled: false },
      legend: {
        itemStyle: { color: '#475569', fontWeight: '500', fontFamily: 'inherit' },
        itemHoverStyle: { color: legendHoverColor },
      },
      plotOptions: {
        pie: {
          innerSize: '58%',
          allowPointSelect: true,
          cursor: 'pointer',
          borderWidth: 2,
          borderColor: '#ffffff',
          dataLabels: {
            enabled: true,
            distance: 18,
            format: '<b>{point.name}</b><br/><span style="opacity:0.9">{point.percentage:.1f}%</span>',
            style: { color: '#334155', fontWeight: '500', fontFamily: 'inherit', textOutline: 'none' },
          },
        },
      },
      series: [{ type: 'pie' as const, name: title, data }] as any,
    };
  }

  private pieChart(title: string, data: { name: string; y: number }[]): Highcharts.Options {
    return this.donutChart(title, data, this.chartColors, '#6d28d9');
  }

  /** Bookings by branch — alternating mauve palette. */
  private bookingsBranchDonutChart(title: string, data: { name: string; y: number }[]): Highcharts.Options {
    return this.donutChart(title, data, this.bookingsDonutColors, '#5b21b6');
  }
}
