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
import { StoreSettingsService } from '@shared/services/store-settings.service';
import { paymentMethodDisplayLabel } from '@shared/utils/cashier-payment-methods.util';

type ProfitTabId = 'consolidated' | 'cash' | 'installment';

type ReportColumnVM = { key: string; labelKey: string; format?: 'money' };

type ProfitDetailMetric = {
  titleKey: string;
  value: number;
  iconClass: string;
  iconTone: 'green' | 'purple' | 'blue' | 'amber' | 'red';
  hintKey?: string;
  hintParams?: Record<string, unknown>;
  /** Default money; use percent for margin cards. */
  format?: 'money' | 'percent';
};

type ProfitTabView = {
  cards: ReportCardVM[];
  /** Secondary metrics under “Account details” (installment first). */
  detailMetrics: ProfitDetailMetric[];
  timeColumns: ReportColumnVM[];
  /** Newest period first. The chart uses chronological order. */
  timeRows: any[];
  chart: Highcharts.Options | null;
  /** Optional second chart (e.g. installment profits vs collections bars). */
  secondaryChart: Highcharts.Options | null;
  invoiceColumns: ReportColumnVM[];
  invoiceRows: any[];
  invoiceMeta: { totalCount: number; page: number; limit: number } | null;
};

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
  iconClass?: string;
  iconTone?: '' | 'green' | 'purple' | 'blue' | 'amber' | 'red';
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

  /** Treasury report: payment methods + ledger source activity. */
  treasuryMethodColumns: { key: string; labelKey: string; format?: 'money' }[] = [];
  treasuryMethodRows: any[] = [];
  treasurySourceColumns: { key: string; labelKey: string; format?: 'money' }[] = [];
  treasurySourceRows: any[] = [];

  /** Sales report: breakdown by cash / card / application payment types. */
  salesPaymentColumns: { key: string; labelKey: string; format?: 'money' }[] = [];
  salesPaymentRows: any[] = [];

  /** Profit report: consolidated / cash / installments on one page. */
  profitTab: ProfitTabId = 'consolidated';
  profitTimeLimit = 25;
  profitTimePage: Record<ProfitTabId, number> = {
    consolidated: 1,
    cash: 1,
    installment: 1,
  };
  profitInvoiceColumns: ReportColumnVM[] = [];
  profitInvoiceRows: any[] = [];
  /** Client-side filter for the current invoice page. */
  profitInvoiceSearch = '';
  profitDetailMetrics: ProfitDetailMetric[] = [];
  profitAccountDetailsOpen = true;
  cashInvoicePage = 1;
  installmentInvoicePage = 1;
  profitInvoiceLimit = 25;
  profitInvoiceMeta: { totalCount: number; page: number; limit: number } | null = null;
  private profitViews: Partial<Record<ProfitTabId, ProfitTabView>> = {};

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
    treasury: 'tr_report_title_treasury',
  };

  constructor(
    private route: ActivatedRoute,
    private reportsService: ReportsService,
    private exportService: ReportExportService,
    private translate: TranslateService,
    private authenticationService: AuthenticationService,
    private productBookingsService: ProductBookingsService,
    private storeSettings: StoreSettingsService
  ) {}

  ngOnInit(): void {
    this.storeSettings.load();
    this.langSub = this.translate.onLangChange.subscribe(() => {
      if (this.lastReportPayload) {
        this.bindReportData(this.lastReportPayload);
        this.applyCostPriceVisibility();
      }
    });

    this.route.data.subscribe((d) => {
      this.reportType = d.reportType || 'sales';
      this.reportTitleKey = this.reportTitleKeys[this.reportType] || this.reportTitleKeys.sales;
      this.bookingsPage = 1;
      this.resetProfitPages();
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
    if (this.reportType === 'profit') {
      this.resetProfitPages();
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

  setProfitTab(tab: ProfitTabId): void {
    if (this.profitTab === tab) return;
    this.profitTab = tab;
    this.profitInvoiceSearch = '';
    this.applyProfitTab();
    this.applyCostPriceVisibility();
  }

  get filteredProfitInvoiceRows(): any[] {
    const q = (this.profitInvoiceSearch || '').trim().toLowerCase();
    const rows = this.profitInvoiceRows || [];
    if (!q) return rows;
    return rows.filter((row) => {
      const hay = [row.saleNumber, row.orderNumber, row.clientName, row.clientPhone, row.date]
        .map((v) => String(v ?? '').toLowerCase())
        .join(' ');
      return hay.includes(q);
    });
  }

  get profitInvoiceCountLabel(): { count: number } {
    return { count: this.profitInvoiceMeta?.totalCount || this.profitInvoiceRows.length || 0 };
  }

  get profitTimeCountLabel(): { count: number } {
    return { count: this.profitTimeTotalCount };
  }

  /** Main non-profit table panel title. */
  get mainTableTitleKey(): string {
    switch (this.reportType) {
      case 'products':
        return 'tr_report_chart_top_products';
      case 'treasury':
        return 'tr_report_treasury_accounts_title';
      case 'bookings':
        return 'tr_report_title_bookings';
      case 'sales':
        return 'tr_report_chart_sales_over_time';
      case 'stock':
        return 'tr_report_title_stock';
      case 'customers':
        return 'tr_report_title_customers';
      case 'deskPurchases':
        return 'tr_report_desk_purchases_by_treasury';
      case 'installments':
        return 'tr_report_title_installments';
      default:
        return this.reportTitleKey;
    }
  }

  get mainTableBadgeCount(): number | null {
    if (this.reportType === 'bookings') {
      return this.bookingsMeta?.totalCount ?? this.tableRows.length;
    }
    return this.tableRows?.length || null;
  }

  setProfitTimePage(page: number): void {
    const next = Math.min(this.profitTimeTotalPages, Math.max(1, page));
    this.profitTimePage[this.profitTab] = next;
    this.applyProfitTimeSlice();
  }

  setProfitInvoicePage(page: number): void {
    const next = Math.max(1, page);
    if (this.profitTab === 'cash') this.cashInvoicePage = next;
    else if (this.profitTab === 'installment') this.installmentInvoicePage = next;
    else return;
    if (Object.keys(this.filters || {}).length > 0) {
      this.loadReport(this.filters);
    }
  }

  get profitTimeTotalCount(): number {
    return this.profitViews[this.profitTab]?.timeRows.length || 0;
  }

  get profitTimeTotalPages(): number {
    return Math.max(1, Math.ceil(this.profitTimeTotalCount / this.profitTimeLimit));
  }

  private resetProfitPages(): void {
    this.profitTimePage = { consolidated: 1, cash: 1, installment: 1 };
    this.cashInvoicePage = 1;
    this.installmentInvoicePage = 1;
    this.profitInvoiceSearch = '';
  }

  get bookingsTotalPages(): number {
    const m = this.bookingsMeta;
    if (!m || !m.limit) return 1;
    return Math.max(1, Math.ceil((m.totalCount || 0) / m.limit));
  }

  get profitInvoiceTotalPages(): number {
    const m = this.profitInvoiceMeta;
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
          this.applyCostPriceVisibility();
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
          this.profitInvoiceColumns = [];
          this.profitInvoiceRows = [];
          this.profitInvoiceMeta = null;
          this.deskPurchasesDetailColumns = [];
          this.deskPurchasesDetailRows = [];
          this.treasuryMethodColumns = [];
          this.treasuryMethodRows = [];
          this.treasurySourceColumns = [];
          this.treasurySourceRows = [];
        }
      );
      return;
    }

    const scoped =
      this.reportType === 'profit'
        ? this.mergeBranchScope({
            ...filters,
            cash_invoice_page: this.cashInvoicePage,
            cash_invoice_limit: this.profitInvoiceLimit,
            installment_invoice_page: this.installmentInvoicePage,
            installment_invoice_limit: this.profitInvoiceLimit,
          })
        : this.mergeBranchScope({ ...filters });
    this.loading = true;
    const map: any = {
      sales: this.reportsService.getSalesReport.bind(this.reportsService),
      profit: this.reportsService.getProfitReport.bind(this.reportsService),
      products: this.reportsService.getProductsReport.bind(this.reportsService),
      stock: this.reportsService.getStockReport.bind(this.reportsService),
      customers: this.reportsService.getCustomersReport.bind(this.reportsService),
      installments: this.reportsService.getInstallmentsReport.bind(this.reportsService),
      deskPurchases: this.reportsService.getDeskPurchasesTreasuryReport.bind(this.reportsService),
      treasury: this.reportsService.getTreasuryAccountsReport.bind(this.reportsService),
    };

    map[this.reportType](scoped).subscribe(
      (res: any) => {
        this.loading = false;
        this.lastReportPayload = res || {};
        this.bindReportData(this.lastReportPayload);
        this.applyCostPriceVisibility();
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
        this.profitInvoiceColumns = [];
        this.profitInvoiceRows = [];
        this.profitInvoiceMeta = null;
        this.deskPurchasesDetailColumns = [];
        this.deskPurchasesDetailRows = [];
        this.treasuryMethodColumns = [];
        this.treasuryMethodRows = [];
        this.treasurySourceColumns = [];
        this.treasurySourceRows = [];
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
    this.profitInvoiceColumns = [];
    this.profitInvoiceRows = [];
    this.profitInvoiceMeta = null;
    this.deskPurchasesDetailColumns = [];
    this.deskPurchasesDetailRows = [];
    this.treasuryMethodColumns = [];
    this.treasuryMethodRows = [];
    this.treasurySourceColumns = [];
    this.treasurySourceRows = [];
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
        {
          titleKey: 'tr_report_card_total_sales',
          value: s.totalSales || 0,
          money: true,
          iconClass: 'fa-line-chart',
          iconTone: 'green',
        },
        {
          titleKey: 'tr_report_card_sold_qty',
          value: s.soldQty || 0,
          iconClass: 'fa-cubes',
          iconTone: 'blue',
        },
        {
          titleKey: 'tr_report_card_total_orders',
          value: s.totalOrders || 0,
          iconClass: 'fa-file-text-o',
          iconTone: 'purple',
        },
        {
          titleKey: 'tr_report_card_avg_order',
          value: s.averageOrderValue || 0,
          money: true,
          iconClass: 'fa-calculator',
          iconTone: 'amber',
        },
      ];
      this.tableColumns = [
        { key: 'period', labelKey: 'tr_report_col_period' },
        { key: 'totalSales', labelKey: 'tr_report_col_sales', format: 'money' },
        { key: 'soldQty', labelKey: 'tr_report_col_sold_qty' },
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
        { key: 'soldQty', labelKey: 'tr_report_col_sold_qty' },
        { key: 'totalOrders', labelKey: 'tr_report_col_orders' },
      ];
      this.salesPaymentRows = sortedPayment.map((x: any) => ({
        paymentType: t(catLabelKey[x.category] || x.category),
        totalSales: x.totalSales,
        soldQty: x.soldQty,
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
      this.bindProfitReport(res, t);
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
          iconClass: 'fa-money',
          iconTone: 'green',
        },
        {
          titleKey: 'tr_report_card_branches_inventory_capital',
          value: s.branchesInventoryCapital ?? 0,
          money: true,
          iconClass: 'fa-building',
          iconTone: 'purple',
        },
        {
          titleKey: 'tr_report_card_warehouse_inventory_capital',
          value: s.warehouseInventoryCapital ?? 0,
          money: true,
          iconClass: 'fa-home',
          iconTone: 'blue',
        },
        {
          titleKey: 'tr_report_card_total_stock',
          value: s.totalStock || 0,
          iconClass: 'fa-cubes',
          iconTone: 'amber',
        },
        {
          titleKey: 'tr_report_card_branches_stock',
          value: s.branchesStock || 0,
          iconClass: 'fa-sitemap',
          iconTone: 'purple',
        },
        {
          titleKey: 'tr_report_card_warehouse_stock',
          value: s.stockInWarehouse || 0,
          iconClass: 'fa-archive',
          iconTone: 'blue',
        },
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

      const topProducts = res.topSellingProducts || [];
      if (perBranch.length > 0) {
        this.chartOptions = this.barChart(
          t('tr_report_chart_capital_by_branch'),
          perBranch.map((x: any) => x.branchName || '—'),
          perBranch.map((x: any) => Number(x.inventoryCapital || 0))
        );
        this.secondaryChartOptions =
          topProducts.length > 0
            ? this.barChart(
                t('tr_report_chart_top_products'),
                topProducts.map((x: any) => x.productName),
                topProducts.map((x: any) => Number(x.soldQty || 0))
              )
            : null;
      } else {
        this.chartOptions = this.barChart(
          t('tr_report_chart_top_products'),
          topProducts.map((x: any) => x.productName),
          topProducts.map((x: any) => Number(x.soldQty || 0))
        );
        this.secondaryChartOptions = null;
      }
      return;
    }

    if (this.reportType === 'stock') {
      const summary = res.summaryByType || [];
      const stockTones: Array<ReportCardVM['iconTone']> = ['purple', 'blue', 'amber', 'green', 'red'];
      this.cards = summary.map((x: any, i: number) => ({
        titleKey: 'tr_report_movement_count',
        titleParams: { type: x.movementType },
        value: x.count,
        hintKey: 'tr_report_qty_hint',
        hintParams: { qty: x.totalQty },
        iconClass: 'fa-exchange',
        iconTone: stockTones[i % stockTones.length],
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
      this.cards = [
        {
          titleKey: 'tr_report_card_top_customers',
          value: (res.topCustomers || []).length,
          iconClass: 'fa-users',
          iconTone: 'purple',
        },
      ];
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
        {
          titleKey: 'tr_report_desk_purchases_total_cost',
          value: s.totalAmount ?? 0,
          money: true,
          iconClass: 'fa-shopping-cart',
          iconTone: 'purple',
        },
        {
          titleKey: 'tr_report_desk_purchases_intakes',
          value: s.totalIntakes ?? 0,
          iconClass: 'fa-download',
          iconTone: 'blue',
        },
      ];
      this.tableColumns = [
        { key: 'treasuryLabel', labelKey: 'tr_report_col_purchase_treasury' },
        { key: 'totalAmount', labelKey: 'tr_report_col_amount', format: 'money' },
        { key: 'intakeCount', labelKey: 'tr_report_desk_purchases_col_intakes' },
      ];
      const bt = s.byTreasury || [];
      this.tableRows = bt.map((x: any) => ({
        treasuryLabel: x.treasuryLabel || x.treasuryKey,
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

    if (this.reportType === 'treasury') {
      const s = res.summary || {};
      this.cards = [
        {
          titleKey: 'tr_report_card_spendable',
          value: s.spendableTotal ?? 0,
          money: true,
          iconClass: 'fa-check-circle',
          iconTone: 'green',
        },
        {
          titleKey: 'tr_treasury_type_cash',
          value: s.cashTotal ?? 0,
          money: true,
          iconClass: 'fa-money',
          iconTone: 'amber',
        },
        {
          titleKey: 'tr_treasury_type_bank',
          value: s.bankTotal ?? 0,
          money: true,
          iconClass: 'fa-university',
          iconTone: 'blue',
        },
        {
          titleKey: 'tr_treasury_type_wallet',
          value: s.walletTotal ?? 0,
          money: true,
          iconClass: 'fa-mobile',
          iconTone: 'purple',
        },
        {
          titleKey: 'tr_treasury_type_settlement',
          value: s.settlementTotal ?? 0,
          money: true,
          iconClass: 'fa-exchange',
          iconTone: 'red',
        },
        {
          titleKey: 'tr_report_card_method_sales',
          value: s.orderSales ?? 0,
          money: true,
          iconClass: 'fa-line-chart',
          iconTone: 'green',
        },
      ];

      const typeLabel: Record<string, string> = {
        cash: t('tr_treasury_type_cash'),
        bank: t('tr_treasury_type_bank'),
        wallet: t('tr_treasury_type_wallet'),
        settlement: t('tr_treasury_type_settlement'),
      };
      const showInLabel: Record<string, string> = {
        sale: t('tr_pay_show_in_sale'),
        purchase: t('tr_pay_show_in_purchase'),
        both: t('tr_pay_show_in_both'),
      };
      const effectLabel: Record<string, string> = {
        instant: t('tr_pay_effect_instant'),
        settlement: t('tr_pay_effect_settlement'),
        none: t('tr_pay_effect_none'),
      };

      this.tableColumns = [
        { key: 'accountLabel', labelKey: 'tr_treasury_account' },
        { key: 'displayType', labelKey: 'tr_treasury_kind' },
        { key: 'accountRef', labelKey: 'tr_report_col_account_ref' },
        { key: 'openingAtStart', labelKey: 'tr_report_treasury_opening_start', format: 'money' },
        { key: 'periodIn', labelKey: 'tr_treasury_in', format: 'money' },
        { key: 'periodOut', labelKey: 'tr_treasury_out', format: 'money' },
        { key: 'expectedBalance', labelKey: 'tr_treasury_expected', format: 'money' },
        { key: 'lastMovement', labelKey: 'tr_treasury_last_movement' },
      ];
      this.tableRows = (res.accounts || []).map((x: any) => {
        let accountRef = '—';
        if (x.channel === 'bank' && x.accountNumber) accountRef = x.accountNumber;
        else if (x.channel === 'wallet' && x.phone) accountRef = x.phone;
        const lm = x.lastMovement;
        const lastMovement = lm?.occurredAt
          ? `${new Date(lm.occurredAt).toLocaleString()} · ${t(
              'tr_treasury_source_' + (lm.sourceType || 'other')
            )}`
          : '—';
        return {
          accountLabel: x.label || x.key,
          displayType: typeLabel[x.displayType] || x.displayType,
          accountRef,
          openingAtStart: x.openingAtStart,
          periodIn: x.periodIn,
          periodOut: x.periodOut,
          expectedBalance: x.expectedBalance,
          lastMovement,
        };
      });

      const barCats = (res.accounts || []).filter(
        (x: any) => Math.abs(Number(x.expectedBalance || 0)) > 0
      );
      this.chartOptions =
        barCats.length > 0
          ? this.barChart(
              t('tr_report_chart_treasury_by_account'),
              barCats.map((x: any) => String(x.label || x.key)),
              barCats.map((x: any) => Number(x.expectedBalance || 0))
            )
          : null;

      const methods = res.paymentMethods || [];
      this.treasuryMethodColumns = [
        { key: 'methodLabel', labelKey: 'tr_report_col_payment_type' },
        { key: 'showIn', labelKey: 'tr_pay_show_in' },
        { key: 'effectMode', labelKey: 'tr_pay_effect' },
        { key: 'accountLabel', labelKey: 'tr_payment_linked_account' },
        { key: 'settlementBank', labelKey: 'tr_payment_settlement_bank' },
        { key: 'feePercent', labelKey: 'tr_report_col_fee_percent' },
        { key: 'totalOrders', labelKey: 'tr_report_col_orders' },
        { key: 'totalSales', labelKey: 'tr_report_col_sales', format: 'money' },
      ];
      this.treasuryMethodRows = methods.map((x: any) => ({
        methodLabel: this.prettyPayLabel(x.label, x.key),
        showIn: showInLabel[x.showIn] || x.showIn || '—',
        effectMode: effectLabel[x.effectMode] || x.effectMode || '—',
        accountLabel: x.accountLabel || '—',
        settlementBank: x.settlementBankLabel || '—',
        feePercent: `${Number(x.feePercent || 0)}%`,
        totalOrders: x.totalOrders || 0,
        totalSales: x.totalSales || 0,
      }));

      const pieMethods = methods
        .filter((x: any) => Number(x.totalSales || 0) > 0)
        .map((x: any) => ({
          name: this.prettyPayLabel(x.label, x.key),
          y: Number(x.totalSales || 0),
        }));
      this.secondaryChartOptions =
        pieMethods.length > 0
          ? this.pieChart(t('tr_report_chart_treasury_by_method'), pieMethods)
          : null;

      this.treasurySourceColumns = [
        { key: 'sourceType', labelKey: 'tr_treasury_source' },
        { key: 'inTotal', labelKey: 'tr_treasury_in', format: 'money' },
        { key: 'outTotal', labelKey: 'tr_treasury_out', format: 'money' },
        { key: 'count', labelKey: 'tr_report_desk_purchases_col_intakes' },
      ];
      this.treasurySourceRows = (res.bySourceType || []).map((x: any) => ({
        sourceType: t('tr_treasury_source_' + (x.sourceType || 'other')),
        inTotal: x.inTotal,
        outTotal: x.outTotal,
        count: x.count,
      }));
      return;
    }

    if (this.reportType === 'installments') {
      const s = res.summary || {};
      this.cards = [
        {
          titleKey: 'tr_collections_total_installments',
          value: s.totalAmount || 0,
          money: true,
          iconClass: 'fa-calendar',
          iconTone: 'purple',
        },
        {
          titleKey: 'tr_collections_collected',
          value: s.collectedAmount || 0,
          money: true,
          iconClass: 'fa-check-circle',
          iconTone: 'green',
        },
        {
          titleKey: 'tr_report_card_remaining_amount',
          value: s.remainingAmount || 0,
          money: true,
          iconClass: 'fa-hourglass-half',
          iconTone: 'amber',
        },
        {
          titleKey: 'tr_collections_overdue_amount',
          value: s.overdueAmount || 0,
          money: true,
          iconClass: 'fa-exclamation-triangle',
          iconTone: 'red',
        },
        {
          titleKey: 'tr_collections_due_soon',
          value: s.dueSoonAmount || 0,
          money: true,
          iconClass: 'fa-clock-o',
          iconTone: 'blue',
        },
        {
          titleKey: 'tr_collections_rate',
          value: `${Number(s.collectionRate || 0).toFixed(1)}%`,
          iconClass: 'fa-percent',
          iconTone: 'purple',
        },
      ];
      this.tableColumns = [
        { key: 'orderNumber', labelKey: 'tr_order_number' },
        { key: 'clientName', labelKey: 'tr_client_name' },
        { key: 'clientPhone', labelKey: 'tr_phone' },
        { key: 'collectorName', labelKey: 'tr_collector' },
        { key: 'branchName', labelKey: 'tr_branch' },
        { key: 'planName', labelKey: 'tr_installment_plan_select' },
        { key: 'sequence', labelKey: 'tr_report_col_installment_seq' },
        { key: 'dueDate', labelKey: 'tr_installment_due_date' },
        { key: 'amount', labelKey: 'tr_amount', format: 'money' },
        { key: 'paidAmount', labelKey: 'tr_collections_collected', format: 'money' },
        { key: 'remaining', labelKey: 'tr_remaining', format: 'money' },
        { key: 'statusLabel', labelKey: 'tr_status' },
        { key: 'promiseToPayAt', labelKey: 'tr_promise_to_pay' },
      ];
      const statusKeyMap: Record<string, string> = {
        paid: 'tr_paid',
        overdue: 'tr_collections_status_overdue',
        due_soon: 'tr_collections_due_soon',
        promised: 'tr_collections_status_promised',
        due: 'tr_collections_status_due',
      };
      this.tableRows = (res.rows || []).map((x: any) => ({
        orderNumber: x.orderNumber != null ? `#${x.orderNumber}` : '—',
        clientName: x.clientName || '—',
        clientPhone: x.clientPhone || '—',
        collectorName: x.collectorName || '—',
        branchName: x.branchName || '—',
        planName: x.planName || (x.planMonths ? `${x.planMonths}` : '—'),
        sequence: x.sequence ?? '—',
        dueDate: x.dueDate ? new Date(x.dueDate).toLocaleDateString() : '—',
        amount: x.amount,
        paidAmount: x.paidAmount,
        remaining: x.remaining,
        statusLabel: t(statusKeyMap[x.status] || 'tr_collections_status_due'),
        promiseToPayAt: x.promiseToPayAt
          ? new Date(x.promiseToPayAt).toLocaleString()
          : '—',
      }));

      this.salesPaymentColumns = [
        { key: 'collectorName', labelKey: 'tr_collector' },
        { key: 'totalAmount', labelKey: 'tr_collections_total_installments', format: 'money' },
        { key: 'collectedAmount', labelKey: 'tr_collections_collected', format: 'money' },
        { key: 'remainingAmount', labelKey: 'tr_remaining', format: 'money' },
        { key: 'overdueAmount', labelKey: 'tr_collections_overdue_amount', format: 'money' },
        { key: 'collectionRate', labelKey: 'tr_collections_rate' },
      ];
      this.salesPaymentRows = (res.byCollector || []).map((c: any) => ({
        collectorName: c.collectorName || '—',
        totalAmount: c.totalAmount,
        collectedAmount: c.collectedAmount,
        remainingAmount: c.remainingAmount,
        overdueAmount: c.overdueAmount,
        collectionRate: `${Number(c.collectionRate || 0).toFixed(1)}%`,
      }));

      const over = res.overTime || [];
      this.chartOptions = this.lineChart(
        t('tr_report_chart_collections_over_time'),
        over.map((x: any) => x.period),
        [
          {
            name: t('tr_collections_total_installments'),
            data: over.map((x: any) => Number(x.dueAmount || 0)),
          },
          {
            name: t('tr_collections_collected'),
            data: over.map((x: any) => Number(x.collectedAmount || 0)),
          },
        ]
      );
      this.secondaryChartOptions = this.pieChart(t('tr_report_chart_paid_vs_unpaid'), [
        { name: t('tr_collections_collected'), y: Number(s.collectedAmount || 0) },
        { name: t('tr_remaining'), y: Number(s.remainingAmount || 0) },
      ]);
      return;
    }
  }

  private applyCostPriceVisibility(): void {
    const role = this.authenticationService.getUserFromLocalStorage()?.role;
    if (this.storeSettings.canSeeCostPrice(role)) {
      return;
    }
    const hideCardKeys = new Set([
      'tr_report_card_cost',
      'tr_report_card_trading_profit',
      'tr_report_card_trading_loss',
      'tr_report_card_installment_profit_collected',
      'tr_report_card_cash_trading_profit',
      'tr_report_card_down_payment_cost',
      'tr_report_card_down_payment_profit',
      'tr_report_card_financing_amount',
      'tr_report_card_installment_recognized',
      'tr_report_card_installment_remaining',
      'tr_report_card_consolidated_trading',
      'tr_net_profit',
      'tr_net_loss',
      'tr_report_card_margin',
      'tr_report_card_loss_margin',
      'tr_report_card_inventory_capital',
      'tr_report_card_branches_inventory_capital',
      'tr_report_card_warehouse_inventory_capital',
    ]);
    this.cards = (this.cards || []).filter((c) => !hideCardKeys.has(c.titleKey));
    this.profitDetailMetrics = (this.profitDetailMetrics || []).filter(
      (m) => !hideCardKeys.has(m.titleKey)
    );
    const hideCol = new Set([
      'cost',
      'unitCost',
      'inventoryCapital',
      'tradingProfit',
      'installmentProfitShare',
      'installmentProfit',
      'installmentProfitPeriod',
      'installmentProfitLifetime',
      'downCost',
      'downProfit',
      'downPaymentProfit',
      'financingAmount',
      'cashTradingProfit',
      'recognizedProfit',
      'remainingProfit',
      'potentialProfit',
      'lineTotal',
    ]);
    this.tableColumns = (this.tableColumns || []).filter((c) => !hideCol.has(c.key));
    this.deskPurchasesDetailColumns = (this.deskPurchasesDetailColumns || []).filter(
      (c) => !hideCol.has(c.key)
    );
    this.branchCapitalColumns = (this.branchCapitalColumns || []).filter((c) => !hideCol.has(c.key));
    this.profitInvoiceColumns = (this.profitInvoiceColumns || []).filter((c) => !hideCol.has(c.key));
  }

  private bindBookingsReportData(res: BookingsReportResponse, t: (key: string, params?: object) => string): void {
    const s = res.summary || ({} as BookingsReportResponse['summary']);
    this.bookingsMeta = res.meta || null;
    this.cards = [
      {
        titleKey: 'tr_bookings_report_card_total',
        value: s.totalBookings || 0,
        iconClass: 'fa-bookmark',
        iconTone: 'purple',
      },
      {
        titleKey: 'tr_bookings_report_card_units',
        value: s.totalUnits || 0,
        iconClass: 'fa-cubes',
        iconTone: 'blue',
      },
      {
        titleKey: 'tr_bookings_report_card_deposits',
        value: s.totalDeposits || 0,
        money: true,
        iconClass: 'fa-money',
        iconTone: 'green',
      },
      {
        titleKey: 'tr_bookings_report_card_active',
        value: s.activeCount || 0,
        iconClass: 'fa-check-circle',
        iconTone: 'green',
      },
      {
        titleKey: 'tr_bookings_report_card_cancelled',
        value: s.cancelledCount || 0,
        iconClass: 'fa-times-circle',
        iconTone: 'red',
      },
      {
        titleKey: 'tr_bookings_report_card_confirmed',
        value: s.confirmedActive || 0,
        iconClass: 'fa-thumbs-up',
        iconTone: 'blue',
      },
      {
        titleKey: 'tr_bookings_report_card_pending_confirm',
        value: s.pendingConfirmation || 0,
        iconClass: 'fa-clock-o',
        iconTone: 'amber',
      },
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
          : [
              t('tr_booking_branch_pickup'),
              b.branch?.name || b.shippingAddress || '',
            ]
              .map((s) => String(s || '').trim())
              .filter(Boolean)
              .join(' — '),
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

    if (this.reportType === 'treasury') {
      const t = (key: string) => this.translate.instant(key);
      const summaryRows = this.cards.map((c) => ({
        [t('tr_report_col_label')]: this.translate.instant(c.titleKey, c.titleParams || {}),
        [t('tr_report_col_value')]: this.formatCardExportValue(c),
      }));
      const sheets: { name: string; rows: Record<string, unknown>[] }[] = [
        { name: t('tr_report_sheet_summary'), rows: summaryRows },
        { name: t('tr_report_treasury_accounts_title'), rows: this.mapRowsForExport(this.tableColumns, this.tableRows) },
      ];
      if (this.treasuryMethodRows.length > 0) {
        sheets.push({
          name: t('tr_report_treasury_methods_title'),
          rows: this.mapRowsForExport(this.treasuryMethodColumns, this.treasuryMethodRows),
        });
      }
      if (this.treasurySourceRows.length > 0) {
        sheets.push({
          name: t('tr_report_treasury_sources_title'),
          rows: this.mapRowsForExport(this.treasurySourceColumns, this.treasurySourceRows),
        });
      }
      this.exportService.exportToExcelMultiSheet(filename, sheets);
      return;
    }

    if (this.reportType === 'installments') {
      const t = (key: string) => this.translate.instant(key);
      const summaryRows = this.cards.map((c) => ({
        [t('tr_report_col_label')]: this.translate.instant(c.titleKey, c.titleParams || {}),
        [t('tr_report_col_value')]: this.formatCardExportValue(c),
      }));
      const sheets: { name: string; rows: Record<string, unknown>[] }[] = [
        { name: t('tr_report_sheet_summary'), rows: summaryRows },
      ];
      if (this.salesPaymentRows.length > 0) {
        sheets.push({
          name: t('tr_collections_collectors_perf'),
          rows: this.mapRowsForExport(this.salesPaymentColumns, this.salesPaymentRows),
        });
      }
      sheets.push({
        name: t('tr_report_title_installments'),
        rows: this.mapRowsForExport(this.tableColumns, this.tableRows),
      });
      this.exportService.exportToExcelMultiSheet(filename, sheets);
      return;
    }

    if (this.reportType === 'profit') {
      this.exportProfitExcel();
      return;
    }

    this.exportService.exportToExcel(
      filename,
      this.mapRowsForExport(this.tableColumns, this.tableRows)
    );
  }

  private exportProfitExcel(): void {
    const filename = this.translate
      .instant(this.reportTitleKey)
      .replace(/\s+/g, '_')
      .toLowerCase();
    this.reportsService
      .getProfitReport(
        this.mergeBranchScope({
          ...this.filters,
          invoice_all: true,
        })
      )
      .subscribe({
        next: (res: any) => {
          this.exportService.exportToExcelMultiSheet(filename, this.profitExcelSheets(res));
        },
        error: () => {
          this.exportService.exportToExcelMultiSheet(filename, this.profitExcelSheets(this.lastReportPayload || {}));
        },
      });
  }

  private profitExcelSheets(res: any): { name: string; rows: Record<string, unknown>[] }[] {
    const t = (key: string, params?: object) => this.translate.instant(key, params);
    const views = this.buildProfitViews(res || {}, t);
    const cardRows = (cards: ReportCardVM[]) =>
      cards.map((c) => ({
        [t('tr_report_col_label')]: this.translate.instant(c.titleKey, c.titleParams || {}),
        [t('tr_report_col_value')]: this.formatCardExportValue(c),
      }));
    const sheet = (nameKey: string, rows: Record<string, unknown>[]) => ({
      name: t(nameKey).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31),
      rows,
    });
    return [
      sheet('tr_report_profit_tab_consolidated', cardRows(views.consolidated.cards)),
      sheet('tr_report_profit_tab_cash', cardRows(views.cash.cards)),
      sheet('tr_report_profit_tab_installment', cardRows(views.installment.cards)),
      sheet(
        'tr_report_chart_profit_over_time',
        this.mapRowsForExport(views.consolidated.timeColumns, views.consolidated.timeRows)
      ),
      sheet(
        'tr_report_profit_cash_over_time',
        this.mapRowsForExport(views.cash.timeColumns, views.cash.timeRows)
      ),
      sheet(
        'tr_report_profit_installment_over_time',
        this.mapRowsForExport(views.installment.timeColumns, views.installment.timeRows)
      ),
      sheet(
        'tr_report_profit_by_invoice_cash',
        this.mapRowsForExport(views.cash.invoiceColumns, views.cash.invoiceRows)
      ),
      sheet(
        'tr_report_profit_by_invoice_installment',
        this.mapRowsForExport(views.installment.invoiceColumns, views.installment.invoiceRows)
      ),
    ];
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

    if (this.reportType === 'treasury') {
      const sections = [];
      if (this.tableRows.length > 0) {
        sections.push({
          title: this.translate.instant('tr_report_treasury_accounts_title'),
          columns: this.tableColumns.map((c) => this.translate.instant(c.labelKey)),
          rows: this.mapRowsForExport(this.tableColumns, this.tableRows),
        });
      }
      if (this.treasuryMethodRows.length > 0) {
        sections.push({
          title: this.translate.instant('tr_report_treasury_methods_title'),
          columns: this.treasuryMethodColumns.map((c) => this.translate.instant(c.labelKey)),
          rows: this.mapRowsForExport(this.treasuryMethodColumns, this.treasuryMethodRows),
        });
      }
      if (this.treasurySourceRows.length > 0) {
        sections.push({
          title: this.translate.instant('tr_report_treasury_sources_title'),
          columns: this.treasurySourceColumns.map((c) => this.translate.instant(c.labelKey)),
          rows: this.mapRowsForExport(this.treasurySourceColumns, this.treasurySourceRows),
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

    if (this.reportType === 'profit') {
      let res: any = this.lastReportPayload || {};
      try {
        res = await this.reportsService
          .getProfitReport(
            this.mergeBranchScope({
              ...this.filters,
              invoice_all: true,
            })
          )
          .toPromise();
      } catch {
        res = this.lastReportPayload || {};
      }
      const t = (key: string, params?: object) => this.translate.instant(key, params);
      const views = this.buildProfitViews(res, t);
      const tabLabel: Record<ProfitTabId, string> = {
        consolidated: t('tr_report_profit_tab_consolidated'),
        cash: t('tr_report_profit_tab_cash'),
        installment: t('tr_report_profit_tab_installment'),
      };
      const profitSummary = (['consolidated', 'cash', 'installment'] as ProfitTabId[]).reduce(
        (rows: { label: string; value: string | number }[], tab) => {
          views[tab].cards.forEach((c) => {
            rows.push({
              label: `${tabLabel[tab]} — ${this.translate.instant(c.titleKey, c.titleParams || {})}`,
              value: this.formatCardExportValue(c),
            });
          });
          return rows;
        },
        []
      );
      const sectionFor = (sectionTitle: string, columns: ReportColumnVM[], rows: any[]) => ({
        title: sectionTitle,
        columns: columns.map((c) => this.translate.instant(c.labelKey)),
        rows: this.mapRowsForExport(columns, rows),
      });
      const sections = [
        sectionFor(
          t('tr_report_chart_profit_over_time'),
          views.consolidated.timeColumns,
          views.consolidated.timeRows
        ),
        sectionFor(t('tr_report_profit_cash_over_time'), views.cash.timeColumns, views.cash.timeRows),
        sectionFor(
          t('tr_report_profit_installment_over_time'),
          views.installment.timeColumns,
          views.installment.timeRows
        ),
        sectionFor(
          t('tr_report_profit_by_invoice_cash'),
          views.cash.invoiceColumns,
          views.cash.invoiceRows
        ),
        sectionFor(
          t('tr_report_profit_by_invoice_installment'),
          views.installment.invoiceColumns,
          views.installment.invoiceRows
        ),
      ];
      await this.exportService.exportMultiSectionPdf(title, profitSummary, sections);
      return;
    }

    const colLabels = this.tableColumns.map((c) => this.translate.instant(c.labelKey));
    const pdfRows = this.mapRowsForExport(this.tableColumns, this.tableRows);
    await this.exportService.exportToPdf(title, summaryRows, colLabels, pdfRows);
  }

  private bindProfitReport(res: any, t: (key: string, params?: object) => string): void {
    this.profitViews = this.buildProfitViews(res, t);
    this.applyProfitTab();
  }

  private buildProfitViews(
    res: any,
    t: (key: string, params?: object) => string
  ): Record<ProfitTabId, ProfitTabView> {
    const s = res.summary || {};
    const cash = res.cash?.summary || {};
    const inst = res.installment?.summary || {};
    const bo = s.branchOverhead;
    const lossBadge = t('tr_report_loss_badge');
    const moneyLoss = (
      value: number,
      titleKey: string,
      lossTitleKey: string,
      hintKey?: string,
      lossHintKey?: string
    ): ReportCardVM => {
      const n = Number(value) || 0;
      const loss = n < 0;
      return {
        titleKey: loss ? lossTitleKey : titleKey,
        value: loss ? Math.abs(n) : n,
        money: true,
        tone: loss ? 'loss' : undefined,
        trendLabel: loss ? lossBadge : undefined,
        trendPositive: loss ? false : undefined,
        hintKey: loss ? lossHintKey || hintKey : hintKey,
      };
    };
    const consolidatedAsc = res.consolidated?.overTime || res.profitOverTime || [];
    const cashAsc = res.cash?.overTime || [];
    const installmentAsc = res.installment?.overTime || [];
    const cashMeta = this.invoiceMetaFrom(res.cashInvoicesMeta, this.cashInvoicePage);
    const installmentMeta = this.invoiceMetaFrom(
      res.installmentInvoicesMeta,
      this.installmentInvoicePage
    );

    const installmentRecognized =
      Number(s.downPaymentProfit || 0) + Number(s.installmentProfitCollected || 0);

    return {
      consolidated: {
        // Hero: cash + installment + combined trading + net.
        cards: [
          {
            ...moneyLoss(
              s.cashTradingProfit,
              'tr_report_card_cash_trading_profit',
              'tr_report_card_trading_loss',
              'tr_report_card_cash_trading_hint',
              'tr_report_trading_loss_hint'
            ),
            iconClass: 'fa-line-chart',
            iconTone: 'green',
          },
          {
            titleKey: 'tr_report_card_installment_recognized',
            value: installmentRecognized,
            money: true,
            hintKey: 'tr_report_card_installment_recognized_hint',
            iconClass: 'fa-calendar',
            iconTone: 'purple',
          },
          {
            ...moneyLoss(
              s.tradingProfit,
              'tr_report_card_consolidated_trading',
              'tr_report_card_trading_loss',
              'tr_report_card_consolidated_trading_hint',
              'tr_report_trading_loss_hint'
            ),
            iconClass: 'fa-bar-chart',
            iconTone: 'blue',
          },
          {
            ...moneyLoss(
              s.netProfit,
              'tr_net_profit',
              'tr_net_loss',
              undefined,
              'tr_report_net_loss_hint'
            ),
            iconClass: 'fa-check-circle',
            iconTone: 'green',
          },
        ],
        detailMetrics: [
          {
            titleKey: 'tr_report_card_down_payment_profit',
            value: Number(s.downPaymentProfit || 0),
            iconClass: 'fa-money',
            iconTone: 'green',
            hintKey: 'tr_report_card_down_payment_profit_hint',
          },
          {
            titleKey: 'tr_report_card_installment_profit_collected',
            value: Number(s.installmentProfitCollected || 0),
            iconClass: 'fa-calendar',
            iconTone: 'purple',
            hintKey: 'tr_report_card_installment_profit_collected_hint',
          },
          {
            titleKey: 'tr_report_card_branch_overhead',
            value: Number(s.branchOperatingCost || 0),
            iconClass: 'fa-building',
            iconTone: 'amber',
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
            value: Number(s.dailyExpensesTotal || 0),
            iconClass: 'fa-credit-card',
            iconTone: 'red',
            hintKey: 'tr_report_daily_expenses_hint',
            hintParams: { count: s.dailyExpensesCount ?? 0 },
          },
        ],
        timeColumns: this.consolidatedTimeColumns(),
        timeRows: [...consolidatedAsc].reverse(),
        chart: this.lineChart(t('tr_report_chart_profit_over_time'), consolidatedAsc.map((x: any) => x.period), [
          {
            name: t('tr_report_series_cash_trading'),
            data: consolidatedAsc.map((x: any) => Number(x.cashTradingProfit || 0)),
          },
          {
            name: t('tr_report_series_installment_recognized'),
            data: consolidatedAsc.map(
              (x: any) => Number(x.downPaymentProfit || 0) + Number(x.installmentProfit || 0)
            ),
          },
          {
            name: t('tr_report_series_net_after_branch'),
            data: consolidatedAsc.map((x: any) => Number(x.netProfit || 0)),
          },
        ]),
        secondaryChart: this.groupedBarChart(
          t('tr_report_chart_profits_and_collections'),
          consolidatedAsc.map((x: any) => x.period),
          [
            {
              name: t('tr_report_series_cash_trading'),
              data: consolidatedAsc.map((x: any) => Number(x.cashTradingProfit || 0)),
            },
            {
              name: t('tr_report_series_installment_recognized'),
              data: consolidatedAsc.map(
                (x: any) => Number(x.downPaymentProfit || 0) + Number(x.installmentProfit || 0)
              ),
            },
          ]
        ),
        invoiceColumns: [],
        invoiceRows: [],
        invoiceMeta: null,
      },
      cash: {
        // Hero: revenue, cost, trading profit.
        cards: [
          {
            titleKey: 'tr_report_card_revenue',
            value: cash.totalRevenue ?? 0,
            money: true,
            iconClass: 'fa-line-chart',
            iconTone: 'green',
          },
          {
            titleKey: 'tr_report_card_cost',
            value: cash.totalCost ?? 0,
            money: true,
            iconClass: 'fa-database',
            iconTone: 'red',
          },
          {
            ...moneyLoss(
              cash.tradingProfit,
              'tr_report_card_trading_profit',
              'tr_report_card_trading_loss',
              'tr_report_card_cash_trading_hint',
              'tr_report_trading_loss_hint'
            ),
            iconClass: 'fa-bar-chart',
            iconTone: 'purple',
          },
        ],
        detailMetrics: [
          {
            titleKey:
              Number(cash.profitMargin || 0) < 0
                ? 'tr_report_card_loss_margin'
                : 'tr_report_card_margin',
            value: Math.abs(Number(cash.profitMargin || 0)),
            iconClass: 'fa-percent',
            iconTone: Number(cash.profitMargin || 0) < 0 ? 'red' : 'blue',
            hintKey:
              Number(cash.profitMargin || 0) < 0
                ? 'tr_report_loss_margin_hint'
                : 'tr_report_cash_margin_hint',
            format: 'percent',
          },
        ],
        timeColumns: this.cashTimeColumns(),
        timeRows: [...cashAsc].reverse(),
        chart: this.lineChart(t('tr_report_chart_profit_over_time'), cashAsc.map((x: any) => x.period), [
          { name: t('tr_report_series_revenue'), data: cashAsc.map((x: any) => Number(x.revenue || 0)) },
          { name: t('tr_report_series_cost'), data: cashAsc.map((x: any) => Number(x.cost || 0)) },
          {
            name: t('tr_report_series_cash_trading'),
            data: cashAsc.map((x: any) => Number(x.tradingProfit || 0)),
          },
        ]),
        secondaryChart: this.groupedBarChart(
          t('tr_report_chart_profits_and_collections'),
          cashAsc.map((x: any) => x.period),
          [
            {
              name: t('tr_report_series_revenue'),
              data: cashAsc.map((x: any) => Number(x.revenue || 0)),
            },
            {
              name: t('tr_report_series_cash_trading'),
              data: cashAsc.map((x: any) => Number(x.tradingProfit || 0)),
            },
          ]
        ),
        invoiceColumns: this.cashInvoiceColumns(),
        invoiceRows: this.mapCashProfitInvoiceRows(res.cashInvoices || [], t),
        invoiceMeta: cashMeta,
      },
      installment: {
        // Hero: the four primary installment metrics.
        cards: [
          {
            titleKey: 'tr_report_card_down_payment_profit',
            value: inst.downPaymentProfit ?? 0,
            money: true,
            hintKey: 'tr_report_card_down_payment_profit_hint',
            iconClass: 'fa-line-chart',
            iconTone: 'green',
          },
          {
            titleKey: 'tr_report_card_financing_amount',
            value: inst.financingAmount ?? 0,
            money: true,
            hintKey: 'tr_report_card_financing_amount_hint',
            iconClass: 'fa-credit-card',
            iconTone: 'blue',
          },
          {
            titleKey: 'tr_report_card_installment_profit_collected',
            value: inst.installmentProfitCollected ?? 0,
            money: true,
            hintKey: 'tr_report_card_installment_profit_collected_hint',
            iconClass: 'fa-calendar',
            iconTone: 'purple',
          },
          {
            titleKey: 'tr_report_card_installment_recognized',
            value: inst.recognizedProfit ?? 0,
            money: true,
            hintKey: 'tr_report_card_installment_recognized_hint',
            iconClass: 'fa-bar-chart',
            iconTone: 'green',
          },
        ],
        detailMetrics: [
          {
            titleKey: 'tr_report_card_down_payment_revenue',
            value: Number(inst.downPaymentRevenue || 0),
            iconClass: 'fa-money',
            iconTone: 'green',
            hintKey: 'tr_report_card_down_payment_revenue_hint',
          },
          {
            titleKey: 'tr_report_card_down_payment_cost',
            value: Number(inst.downPaymentCost || 0),
            iconClass: 'fa-database',
            iconTone: 'red',
            hintKey: 'tr_report_card_down_payment_cost_hint',
          },
          {
            titleKey: 'tr_report_card_installment_collected_cash',
            value: Number(inst.collectedCash || 0),
            iconClass: 'fa-check-circle',
            iconTone: 'purple',
            hintKey: 'tr_report_card_installment_collected_cash_hint',
          },
          {
            titleKey: 'tr_report_card_installment_remaining',
            value: Number(inst.remainingProfit || 0),
            iconClass: 'fa-clock-o',
            iconTone: 'blue',
            hintKey: 'tr_report_card_installment_remaining_hint',
          },
        ],
        timeColumns: this.installmentTimeColumns(),
        timeRows: [...installmentAsc].reverse(),
        chart: this.lineChart(t('tr_report_chart_profit_over_time'), installmentAsc.map((x: any) => x.period), [
          {
            name: t('tr_report_series_down_profit'),
            data: installmentAsc.map((x: any) => Number(x.downProfit || 0)),
          },
          {
            name: t('tr_report_col_installment_profit_collected'),
            data: installmentAsc.map((x: any) => Number(x.installmentProfit || 0)),
          },
          {
            name: t('tr_report_series_installment_recognized'),
            data: installmentAsc.map((x: any) => Number(x.recognizedProfit || 0)),
          },
        ]),
        secondaryChart: this.groupedBarChart(
          t('tr_report_chart_profits_and_collections'),
          installmentAsc.map((x: any) => x.period),
          [
            {
              name: t('tr_report_card_installment_collected_cash'),
              data: installmentAsc.map((x: any) => Number(x.collectedCash || 0)),
            },
            {
              name: t('tr_report_col_recognized_profit'),
              data: installmentAsc.map((x: any) => Number(x.recognizedProfit || 0)),
            },
          ]
        ),
        invoiceColumns: this.installmentInvoiceColumns(),
        invoiceRows: this.mapInstallmentProfitInvoiceRows(res.installmentInvoices || []),
        invoiceMeta: installmentMeta,
      },
    };
  }

  toggleProfitAccountDetails(): void {
    this.profitAccountDetailsOpen = !this.profitAccountDetailsOpen;
  }

  private applyProfitTab(): void {
    const view = this.profitViews[this.profitTab];
    if (!view) {
      this.cards = [];
      this.tableColumns = [];
      this.tableRows = [];
      this.chartOptions = null;
      this.secondaryChartOptions = null;
      this.profitInvoiceColumns = [];
      this.profitInvoiceRows = [];
      this.profitInvoiceMeta = null;
      this.profitDetailMetrics = [];
      return;
    }
    this.cards = view.cards.map((card) => ({ ...card }));
    this.profitDetailMetrics = (view.detailMetrics || []).map((m) => ({ ...m }));
    this.tableColumns = view.timeColumns.map((col) => ({ ...col }));
    this.chartOptions = view.chart;
    this.secondaryChartOptions = view.secondaryChart || null;
    this.chartRedrawKey++;
    this.chartBranchRedrawKey++;
    this.profitInvoiceColumns = view.invoiceColumns.map((col) => ({ ...col }));
    this.profitInvoiceRows = view.invoiceRows;
    this.profitInvoiceMeta = view.invoiceMeta ? { ...view.invoiceMeta } : null;
    this.applyProfitTimeSlice();
  }

  private applyProfitTimeSlice(): void {
    const rows = this.profitViews[this.profitTab]?.timeRows || [];
    const page = this.profitTimePage[this.profitTab] || 1;
    const start = (page - 1) * this.profitTimeLimit;
    this.tableRows = rows.slice(start, start + this.profitTimeLimit);
  }

  private invoiceMetaFrom(
    meta: any,
    fallbackPage: number
  ): { totalCount: number; page: number; limit: number } {
    return {
      totalCount: Number(meta?.totalCount) || 0,
      page: Number(meta?.page) || fallbackPage,
      limit: Number(meta?.limit) || this.profitInvoiceLimit,
    };
  }

  private consolidatedTimeColumns(): ReportColumnVM[] {
    return [
      { key: 'period', labelKey: 'tr_report_col_period' },
      { key: 'cashTradingProfit', labelKey: 'tr_report_col_cash_trading', format: 'money' },
      { key: 'downPaymentProfit', labelKey: 'tr_report_col_down_payment_profit', format: 'money' },
      {
        key: 'installmentProfit',
        labelKey: 'tr_report_col_installment_profit_collected',
        format: 'money',
      },
      { key: 'tradingProfit', labelKey: 'tr_report_col_trading_profit', format: 'money' },
      { key: 'branchOverheadAllocated', labelKey: 'tr_report_col_branch_overhead', format: 'money' },
      { key: 'dailyExpenses', labelKey: 'tr_report_col_daily_expenses', format: 'money' },
      { key: 'netProfit', labelKey: 'tr_report_col_net_profit_after_branch', format: 'money' },
    ];
  }

  private cashTimeColumns(): ReportColumnVM[] {
    return [
      { key: 'period', labelKey: 'tr_report_col_period' },
      { key: 'revenue', labelKey: 'tr_report_col_revenue', format: 'money' },
      { key: 'cost', labelKey: 'tr_report_col_cost', format: 'money' },
      { key: 'tradingProfit', labelKey: 'tr_report_col_trading_profit', format: 'money' },
    ];
  }

  private installmentTimeColumns(): ReportColumnVM[] {
    return [
      { key: 'period', labelKey: 'tr_report_col_period' },
      { key: 'downRevenue', labelKey: 'tr_report_col_down_payment_revenue', format: 'money' },
      { key: 'downCost', labelKey: 'tr_report_col_down_payment_cost', format: 'money' },
      { key: 'downProfit', labelKey: 'tr_report_col_down_payment_profit', format: 'money' },
      { key: 'financingAmount', labelKey: 'tr_report_col_financing_amount', format: 'money' },
      {
        key: 'installmentProfit',
        labelKey: 'tr_report_col_installment_profit_collected',
        format: 'money',
      },
      { key: 'collectedCash', labelKey: 'tr_report_col_collected_cash', format: 'money' },
      { key: 'recognizedProfit', labelKey: 'tr_report_col_recognized_profit', format: 'money' },
    ];
  }

  private cashInvoiceColumns(): ReportColumnVM[] {
    // Important first, then secondary detail columns.
    return [
      { key: 'orderNumber', labelKey: 'tr_invoice_number' },
      { key: 'clientName', labelKey: 'tr_report_col_customer' },
      { key: 'date', labelKey: 'tr_report_col_invoice_date' },
      { key: 'revenue', labelKey: 'tr_report_col_sale_total', format: 'money' },
      { key: 'tradingProfit', labelKey: 'tr_report_col_trading_profit', format: 'money' },
      { key: 'cost', labelKey: 'tr_report_col_cost', format: 'money' },
      { key: 'clientPhone', labelKey: 'tr_report_col_phone' },
      { key: 'paymentStatus', labelKey: 'tr_status' },
    ];
  }

  private installmentInvoiceColumns(): ReportColumnVM[] {
    // Important first (sale #, client, date, sale/finance/realized/remaining), then details.
    return [
      { key: 'saleNumber', labelKey: 'tr_installment_sale_number' },
      { key: 'clientName', labelKey: 'tr_report_col_customer' },
      { key: 'date', labelKey: 'tr_report_col_invoice_date' },
      { key: 'revenue', labelKey: 'tr_report_col_sale_total', format: 'money' },
      { key: 'financingAmount', labelKey: 'tr_report_col_financing_amount', format: 'money' },
      { key: 'recognizedProfit', labelKey: 'tr_report_col_recognized_profit', format: 'money' },
      { key: 'remainingProfit', labelKey: 'tr_report_col_remaining_profit_full', format: 'money' },
      { key: 'clientPhone', labelKey: 'tr_report_col_phone' },
      { key: 'cost', labelKey: 'tr_report_col_cost', format: 'money' },
      { key: 'downPayment', labelKey: 'tr_report_col_down_payment', format: 'money' },
      { key: 'downPaymentProfit', labelKey: 'tr_report_col_down_payment_profit', format: 'money' },
      {
        key: 'installmentProfitPeriod',
        labelKey: 'tr_report_col_installment_profit_period',
        format: 'money',
      },
      {
        key: 'installmentProfitLifetime',
        labelKey: 'tr_report_col_installment_profit_lifetime',
        format: 'money',
      },
      { key: 'potentialProfit', labelKey: 'tr_report_col_potential_profit', format: 'money' },
    ];
  }

  private mapCashProfitInvoiceRows(
    rows: any[],
    t: (key: string) => string
  ): Record<string, unknown>[] {
    const payStatusKey: Record<string, string> = {
      paid: 'tr_paid',
      partial: 'tr_partial',
      unpaid: 'tr_unpaid',
    };
    return (rows || []).map((x: any) => ({
      orderNumber: x.orderNumber != null ? `#${x.orderNumber}` : '—',
      date: this.formatInvoiceDate(x.createdAt),
      clientName: x.clientName || '—',
      clientPhone: x.clientPhoneNumber || '—',
      revenue: x.revenue,
      cost: x.cost,
      tradingProfit: x.tradingProfit,
      paymentStatus: t(payStatusKey[x.paymentStatus] || 'tr_paid'),
    }));
  }

  private mapInstallmentProfitInvoiceRows(rows: any[]): Record<string, unknown>[] {
    return (rows || []).map((x: any) => {
      const down = Number(x.downPaymentProfit ?? 0);
      const lifetime = Number(x.installmentProfitLifetime ?? 0);
      const sale =
        x.installmentSaleNumber != null && String(x.installmentSaleNumber).trim() !== ''
          ? `#${x.installmentSaleNumber}`
          : '—';
      return {
        saleNumber: sale,
        date: this.formatInvoiceDate(x.createdAt),
        clientName: x.clientName || '—',
        clientPhone: x.clientPhoneNumber || '—',
        revenue: x.revenue,
        cost: x.cost,
        downPayment: x.downPayment ?? 0,
        financingAmount: x.financingAmount ?? 0,
        downPaymentProfit: down,
        installmentProfitPeriod: x.installmentProfitPeriod ?? 0,
        installmentProfitLifetime: lifetime,
        recognizedProfit: down + lifetime,
        potentialProfit: x.potentialProfit ?? 0,
        remainingProfit: x.remainingProfit ?? 0,
      };
    });
  }

  private formatInvoiceDate(value: unknown): string {
    if (!value) return '—';
    const d = new Date(value as string | number | Date);
    if (Number.isNaN(d.getTime())) return '—';
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
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
        if (col.format === 'money') {
          acc[this.translate.instant(col.labelKey)] =
            raw == null || raw === '' ? '—' : formatEgpMoney(raw);
        } else {
          acc[this.translate.instant(col.labelKey)] = raw;
        }
        return acc;
      }, {})
    );
  }

  printReport(): void {
    window.print();
  }

  /**
   * Soft, distinguishable palette (indigo / teal / clay / slate / mauve / steel / sand).
   * Avoids near-identical purples and neon accents.
   */
  private readonly chartColors = [
    '#5b6bc0',
    '#3d8b7a',
    '#b57a5a',
    '#6b7c8f',
    '#8a6d9b',
    '#5c8a9e',
    '#9c7a4f',
    '#7a8f6b',
  ];

  /** Multi-series lines: keep hue families clearly separated. */
  private readonly chartLineContrast = ['#5b6bc0', '#b57a5a', '#3d8b7a', '#6b7c8f'];

  private chartTitleStyle(text: string): Highcharts.TitleOptions {
    return {
      text,
      style: { color: '#334155', fontSize: '15px', fontWeight: '600', fontFamily: 'inherit' },
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
        itemHoverStyle: { color: '#334155' },
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
        itemHoverStyle: { color: '#334155' },
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

  /** Grouped columns — installment profits vs collections. */
  private groupedBarChart(
    title: string,
    categories: string[],
    series: { name: string; data: number[]; color?: string }[]
  ): Highcharts.Options {
    return {
      chart: { type: 'column', backgroundColor: 'transparent' },
      colors: this.chartColors,
      title: this.chartTitleStyle(title),
      credits: { enabled: false },
      legend: {
        align: 'left',
        verticalAlign: 'top',
        itemStyle: { color: '#475569', fontWeight: '500', fontFamily: 'inherit' },
        itemHoverStyle: { color: '#334155' },
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
        gridLineDashStyle: 'Dash',
        labels: { style: { color: '#64748b', fontFamily: 'inherit' } },
      },
      plotOptions: {
        column: {
          borderRadius: 6,
          borderWidth: 0,
          grouping: true,
          groupPadding: 0.18,
          pointPadding: 0.08,
          dataLabels: {
            enabled: true,
            style: {
              color: '#64748b',
              fontSize: '11px',
              fontWeight: '600',
              fontFamily: 'inherit',
              textOutline: 'none',
            },
            formatter: function (this: Highcharts.PointLabelObject) {
              const n = Number(this.y);
              if (!Number.isFinite(n)) return '';
              return n.toLocaleString('en-EG', { maximumFractionDigits: 2 });
            },
          },
        },
      },
      series: series.map((s, i) => ({
        type: 'column' as const,
        name: s.name,
        data: s.data,
        color: s.color || this.chartColors[i % this.chartColors.length],
      })) as any,
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
    return this.donutChart(title, data, this.chartColors, '#334155');
  }

  private bookingsBranchDonutChart(title: string, data: { name: string; y: number }[]): Highcharts.Options {
    return this.donutChart(title, data, this.chartColors, '#334155');
  }

  private prettyPayLabel(label: string | undefined, key: string | undefined): string {
    const snap = this.storeSettings.snapshot;
    return paymentMethodDisplayLabel(
      key || label,
      snap.paymentAppFeePercents,
      this.translate,
      undefined,
      snap.paymentMethodsCatalog,
      [...(snap.moneyAccounts || []), ...(snap.purchaseTreasuryMethods || [])]
    );
  }
}
