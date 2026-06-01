import { Injectable } from '@angular/core';
import { Vendor, VendorHistoryResponse } from '@core/models/products.model';
import {
  Client,
  ClientHistoryPurchaseRow,
  ClientHistoryResponse,
} from '@core/models/users-interfaces.model';
import { TranslateService } from '@ngx-translate/core';
import {
  PdfTableSection,
  ReportExportService,
} from '@shared/services/report-export.service';

@Injectable({ providedIn: 'root' })
export class AccountHistoryPdfService {
  constructor(private exportService: ReportExportService) {}

  async exportVendorHistory(
    vendor: Vendor,
    history: VendorHistoryResponse,
    translate: TranslateService,
    helpers: {
      netBalanceText: () => string;
      settlementNetAfterText: (preview: NonNullable<VendorHistoryResponse['settlementPreview']>) => string;
      ledgerTypeLabel: (type: string) => string;
      paymentStatusLabel: (status?: string) => string;
      formatMoney: (amount: number) => string;
    }
  ): Promise<void> {
    const t = (key: string, params?: Record<string, unknown>) => translate.instant(key, params);
    const title = `${t('tr_supplier_history')} — ${vendor.name || vendor.nameOfcompany || ''}`;
    const exportedAt = new Date().toLocaleString();
    const categories =
      (vendor.categories || [])
        .map((c) => (typeof c === 'object' && c?.name ? c.name : String(c)))
        .filter(Boolean)
        .join(', ') || '—';

    const summaryRows: { label: string; value: string }[] = [
      { label: t('tr_exported_at'), value: exportedAt },
      { label: t('tr_name'), value: vendor.name || '—' },
      { label: t('tr_legal_name'), value: vendor.nameOfcompany || '—' },
      { label: t('tr_phone_number'), value: vendor.phone || '—' },
      { label: t('tr_email'), value: vendor.email || '—' },
      { label: t('tr_address'), value: vendor.address || '—' },
      { label: t('tr_categories'), value: categories },
      {
        label: t('tr_vendor_debit_balance'),
        value: helpers.formatMoney(history.supplierOwesUs),
      },
    ];

    if ((history.owesFromOpeningBalance || 0) > 0) {
      summaryRows.push({
        label: t('tr_vendor_debit_from_opening'),
        value: helpers.formatMoney(history.owesFromOpeningBalance || 0),
      });
    }
    if ((history.owesFromSales || 0) > 0) {
      summaryRows.push({
        label: t('tr_vendor_debit_from_sales'),
        value: helpers.formatMoney(history.owesFromSales || 0),
      });
    }

    summaryRows.push({
      label: t('tr_vendor_credit_balance'),
      value: helpers.formatMoney(history.weOweSupplier),
    });
    if ((history.prepaidBalance || 0) > 0) {
      summaryRows.push({
        label: t('tr_vendor_credit_prepaid'),
        value: helpers.formatMoney(history.prepaidBalance || 0),
      });
    }
    if ((history.buyerPrepaidBalance || 0) > 0) {
      summaryRows.push({
        label: t('tr_vendor_buyer_prepaid'),
        value: helpers.formatMoney(history.buyerPrepaidBalance || 0),
      });
    }
    if ((history.purchasePayable || 0) > 0) {
      summaryRows.push({
        label: t('tr_vendor_purchase_payable'),
        value: helpers.formatMoney(history.purchasePayable || 0),
      });
    }
    if ((history.purchasePayableInstallments || 0) > 0) {
      summaryRows.push({
        label: t('tr_vendor_payable_from_installments'),
        value: helpers.formatMoney(history.purchasePayableInstallments || 0),
      });
    }
    if ((history.purchasePayableDeferred || 0) > 0) {
      summaryRows.push({
        label: t('tr_vendor_payable_from_deferred'),
        value: helpers.formatMoney(history.purchasePayableDeferred || 0),
      });
    }
    if (history.netBalanceMessage) {
      summaryRows.push({ label: t('tr_vendor_net_balance'), value: helpers.netBalanceText() });
    }

    const preview = history.settlementPreview;
    if (preview) {
      summaryRows.push(
        { label: t('tr_vendor_settlement_debit'), value: helpers.formatMoney(preview.debitTotal) },
        { label: t('tr_vendor_settlement_credit'), value: helpers.formatMoney(preview.creditTotal) }
      );
      if (preview.canSettle) {
        summaryRows.push({
          label: t('tr_vendor_settlement_will_offset'),
          value: helpers.formatMoney(preview.settleAmount),
        });
        summaryRows.push({
          label: t('tr_vendor_settlement_section'),
          value: helpers.settlementNetAfterText(preview),
        });
      }
    }

    const col = (key: string) => t(key);
    const sections: PdfTableSection[] = [
      {
        title: t('tr_supplier_orders'),
        columns: [
          col('tr_order_number'),
          col('tr_final_after_extra_discount'),
          col('tr_paid'),
          col('tr_remaining'),
          col('tr_payment_method'),
          col('tr_created_at'),
        ],
        rows: (history.orders || []).map((o) => ({
          [col('tr_order_number')]: o.orderNumber ?? '—',
          [col('tr_final_after_extra_discount')]: helpers.formatMoney(Number(o.totalPrice) || 0),
          [col('tr_paid')]: helpers.formatMoney(Number(o.amountPaid) || 0),
          [col('tr_remaining')]: helpers.formatMoney(Number(o.remaining) || 0),
          [col('tr_payment_method')]: o.paymentMethod || '—',
          [col('tr_created_at')]: this.formatDate(o.createdAt),
        })),
      },
      {
        title: t('tr_vendor_purchasing_requests'),
        columns: [
          col('tr_request_date'),
          col('tr_payment_terms'),
          col('tr_total_amount'),
          col('tr_paid'),
          col('tr_remaining'),
          col('tr_purchasing_status'),
        ],
        rows: (history.purchasingRequests || []).map((pr) => ({
          [col('tr_request_date')]: this.formatDate(pr.requestDate, true),
          [col('tr_payment_terms')]: helpers.paymentStatusLabel(pr.paymentStatus),
          [col('tr_total_amount')]: helpers.formatMoney(Number(pr.totalAmount) || 0),
          [col('tr_paid')]: helpers.formatMoney(Number(pr.amountPaid) || 0),
          [col('tr_remaining')]: helpers.formatMoney(Number(pr.remaining) || 0),
          [col('tr_purchasing_status')]: pr.status || '—',
        })),
      },
      {
        title: t('tr_vendor_ledger'),
        columns: [
          col('tr_date'),
          col('tr_type'),
          col('tr_payment_amount'),
          col('tr_payment_note'),
        ],
        rows: (history.ledgerEntries || []).map((e) => {
          const note = [e.orderNumber ? `#${e.orderNumber}` : '', e.note || ''].filter(Boolean).join(' — ');
          return {
            [col('tr_date')]: this.formatDate(e.createdAt),
            [col('tr_type')]: helpers.ledgerTypeLabel(e.type),
            [col('tr_payment_amount')]: helpers.formatMoney(Number(e.amount) || 0),
            [col('tr_payment_note')]: note || '—',
          };
        }),
      },
    ];

    await this.exportService.exportMultiSectionPdf(title, summaryRows, sections);
  }

  async exportClientHistory(
    client: Client,
    history: ClientHistoryResponse,
    translate: TranslateService,
    helpers: {
      netBalanceText: () => string;
      settlementNetAfterText: (preview: NonNullable<ClientHistoryResponse['settlementPreview']>) => string;
      ledgerTypeLabel: (type: string) => string;
      paymentStatusLabel: (status?: string) => string;
      paymentMethodLabel: (method?: string) => string;
      purchaseStatusLabel: (status?: string) => string;
      purchaseTreasuryLabel: (row: ClientHistoryPurchaseRow) => string;
      orderPaid: (order: ClientHistoryResponse['orders'][number]) => number;
      orderRemaining: (order: ClientHistoryResponse['orders'][number]) => number;
      formatMoney: (amount: number) => string;
    }
  ): Promise<void> {
    const t = (key: string, params?: Record<string, unknown>) => translate.instant(key, params);
    const displayName = client.name || client.phoneNumber || '';
    const title = `${t('tr_client_history')} — ${displayName}`;
    const exportedAt = new Date().toLocaleString();

    const summaryRows: { label: string; value: string }[] = [
      { label: t('tr_exported_at'), value: exportedAt },
      { label: t('tr_name'), value: client.name || '—' },
      { label: t('tr_phone_number'), value: client.phoneNumber || '—' },
      { label: t('tr_address'), value: client.address || '—' },
      { label: t('tr_client_total_points'), value: String(history.totalPointsEarned ?? 0) },
      {
        label: t('tr_client_debit_balance'),
        value: helpers.formatMoney(history.clientOwesUs ?? history.creditBalanceDue ?? 0),
      },
    ];

    if ((history.owesFromOpeningBalance || 0) > 0) {
      summaryRows.push({
        label: t('tr_client_debit_from_opening'),
        value: helpers.formatMoney(history.owesFromOpeningBalance || 0),
      });
    }
    if ((history.owesFromSales || 0) > 0) {
      summaryRows.push({
        label: t('tr_client_debit_from_sales'),
        value: helpers.formatMoney(history.owesFromSales || 0),
      });
    }
    if (history.creditOrdersCount > 0) {
      summaryRows.push({
        label: t('tr_client_unpaid_credit_orders'),
        value: t('tr_client_credit_invoices_count', { count: history.creditOrdersCount }),
      });
    }

    summaryRows.push({
      label: t('tr_client_credit_balance'),
      value: helpers.formatMoney(history.weOweClient ?? history.prepaidBalance ?? 0),
    });

    if (history.netBalanceMessage) {
      summaryRows.push({ label: t('tr_client_net_balance'), value: helpers.netBalanceText() });
    }

    const preview = history.settlementPreview;
    if (preview) {
      summaryRows.push(
        { label: t('tr_client_settlement_debit'), value: helpers.formatMoney(preview.debitTotal) },
        { label: t('tr_client_settlement_credit'), value: helpers.formatMoney(preview.creditTotal) }
      );
      if (preview.canSettle) {
        summaryRows.push({
          label: t('tr_client_settlement_will_offset'),
          value: helpers.formatMoney(preview.settleAmount),
        });
        summaryRows.push({
          label: t('tr_client_settlement_section'),
          value: helpers.settlementNetAfterText(preview),
        });
      }
    }

    const col = (key: string) => t(key);
    const sections: PdfTableSection[] = [];

    if (history.creditOrders?.length) {
      sections.push({
        title: t('tr_client_unpaid_credit_orders'),
        columns: [
          col('tr_order_number'),
          col('tr_final_after_extra_discount'),
          col('tr_paid'),
          col('tr_remaining'),
          col('tr_payment_status'),
          col('tr_created_at'),
        ],
        rows: history.creditOrders.map((o) => ({
          [col('tr_order_number')]: o.orderNumber ?? '—',
          [col('tr_final_after_extra_discount')]: helpers.formatMoney(Number(o.totalPrice) || 0),
          [col('tr_paid')]: helpers.formatMoney(helpers.orderPaid(o)),
          [col('tr_remaining')]: helpers.formatMoney(helpers.orderRemaining(o)),
          [col('tr_payment_status')]: helpers.paymentStatusLabel(o.paymentStatus),
          [col('tr_created_at')]: this.formatDate(o.createdAt),
        })),
      });
    }

    sections.push({
      title: t('tr_client_purchases_from_client'),
      columns: [
        col('tr_name'),
        col('tr_code'),
        col('tr_cashier.QTY'),
        col('tr_paid'),
        col('tr_remaining'),
        col('tr_receipt_purchase_treasury'),
        col('tr_status'),
        col('tr_created_at'),
      ],
      rows: (history.purchases || []).map((p) => ({
        [col('tr_name')]: p.productName || '—',
        [col('tr_code')]: p.productCode || '—',
        [col('tr_cashier.QTY')]: p.quantity ?? '—',
        [col('tr_paid')]: helpers.formatMoney(Number(p.totalPaid) || 0),
        [col('tr_remaining')]:
          p.isDeferredPurchase && (p.remaining || 0) > 0
            ? helpers.formatMoney(Number(p.remaining) || 0)
            : '—',
        [col('tr_receipt_purchase_treasury')]: helpers.purchaseTreasuryLabel(p),
        [col('tr_status')]: helpers.purchaseStatusLabel(p.status),
        [col('tr_created_at')]: this.formatDate(p.createdAt),
      })),
    });

    sections.push({
      title: t('tr_client_operations'),
      columns: [
        col('tr_order_number'),
        col('tr_final_after_extra_discount'),
        col('tr_paid'),
        col('tr_remaining'),
        col('tr_points_earned'),
        col('tr_payment_method'),
        col('tr_status'),
        col('tr_created_at'),
      ],
      rows: (history.orders || []).map((o) => {
        const rem = helpers.orderRemaining(o);
        const status =
          o.status === 'restored'
            ? t('tr_restored')
            : helpers.paymentStatusLabel(o.paymentStatus);
        return {
          [col('tr_order_number')]: o.orderNumber ?? '—',
          [col('tr_final_after_extra_discount')]: helpers.formatMoney(Number(o.totalPrice) || 0),
          [col('tr_paid')]: helpers.formatMoney(helpers.orderPaid(o)),
          [col('tr_remaining')]: rem > 0 ? helpers.formatMoney(rem) : '—',
          [col('tr_points_earned')]: String(o.pointsEarned ?? 0),
          [col('tr_payment_method')]: helpers.paymentMethodLabel(o.paymentMethod),
          [col('tr_status')]: status,
          [col('tr_created_at')]: this.formatDate(o.createdAt),
        };
      }),
    });

    sections.push({
      title: t('tr_client_ledger'),
      columns: [
        col('tr_date'),
        col('tr_type'),
        col('tr_payment_method'),
        col('tr_payment_amount'),
        col('tr_payment_note'),
      ],
      rows: (history.ledgerEntries || []).map((e) => ({
        [col('tr_date')]: this.formatDate(e.createdAt),
        [col('tr_type')]: helpers.ledgerTypeLabel(e.type),
        [col('tr_payment_method')]: helpers.paymentMethodLabel(e.paymentMethod),
        [col('tr_payment_amount')]: helpers.formatMoney(Number(e.amount) || 0),
        [col('tr_payment_note')]: e.note || '—',
      })),
    });

    await this.exportService.exportMultiSectionPdf(title, summaryRows, sections);
  }

  private formatDate(value?: string | Date, dateOnly = false): string {
    if (!value) return '—';
    try {
      const d = new Date(value);
      return dateOnly ? d.toLocaleDateString() : d.toLocaleString();
    } catch {
      return String(value);
    }
  }
}
