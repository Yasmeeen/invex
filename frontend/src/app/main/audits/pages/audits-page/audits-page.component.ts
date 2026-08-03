import { Component, OnInit } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { Globals } from '@core/globals';
import { AuditsService, AuditLogRow } from '@shared/services/audits.service';
import { ReportCellPart } from '../../../reports/components/report-table/report-table.component';

type Col = { key: string; labelKey: string; format?: 'money' | 'parts' };

const PRODUCT_ENTITY_TYPES = new Set([
  'Product',
  'ProductBooking',
  'ProductPurchaseRequest',
  'ProductBranchTransfer',
]);

@Component({
  selector: 'app-audits-page',
  templateUrl: './audits-page.component.html',
  styleUrls: ['./audits-page.component.scss'],
})
export class AuditsPageComponent implements OnInit {
  loading = false;

  from = '';
  to = '';
  module = '';
  action = '';
  actorName = '';
  entitySearch = '';

  page = 1;
  limit = 50;
  totalPages = 1;
  totalCount = 0;

  columns: Col[] = [
    { key: 'createdAt', labelKey: 'tr_audit_col_time' },
    { key: 'actor', labelKey: 'tr_audit_col_actor' },
    { key: 'action', labelKey: 'tr_audit_col_action' },
    { key: 'module', labelKey: 'tr_audit_col_module' },
    { key: 'entity', labelKey: 'tr_audit_col_entity', format: 'parts' },
    { key: 'details', labelKey: 'tr_audit_col_details' },
    { key: 'status', labelKey: 'tr_audit_col_status' },
  ];

  moduleOptions = [
    { value: '', labelKey: 'tr_audit_filter_all' },
    { value: 'orders', labelKey: 'tr_audit_module_orders' },
    { value: 'products', labelKey: 'tr_audit_module_products' },
    { value: 'bookings', labelKey: 'tr_audit_module_bookings' },
    { value: 'product_purchase_requests', labelKey: 'tr_audit_module_product_purchase_requests' },
    { value: 'auth', labelKey: 'tr_audit_module_auth' },
  ];

  actionOptions = [
    { value: '', labelKey: 'tr_audit_filter_all' },
    { value: 'create', labelKey: 'tr_audit_action_create' },
    { value: 'update', labelKey: 'tr_audit_action_update' },
    { value: 'delete', labelKey: 'tr_audit_action_delete' },
    { value: 'payment', labelKey: 'tr_audit_action_payment' },
    { value: 'restore', labelKey: 'tr_audit_action_restore' },
    { value: 'confirm', labelKey: 'tr_audit_action_confirm' },
    { value: 'cancel', labelKey: 'tr_audit_action_cancel' },
    { value: 'approve', labelKey: 'tr_audit_action_approve' },
    { value: 'reject', labelKey: 'tr_audit_action_reject' },
    { value: 'login', labelKey: 'tr_audit_action_login' },
    { value: 'logout', labelKey: 'tr_audit_action_logout' },
    { value: 'login_failed', labelKey: 'tr_audit_action_login_failed' },
    { value: 'branch_transfer_request', labelKey: 'tr_audit_action_branch_transfer_request' },
    { value: 'branch_transfer_approve', labelKey: 'tr_audit_action_branch_transfer_approve' },
    { value: 'branch_transfer_reject', labelKey: 'tr_audit_action_branch_transfer_reject' },
  ];

  rows: any[] = [];

  constructor(
    private audits: AuditsService,
    public globals: Globals,
    private translate: TranslateService
  ) {}

  ngOnInit(): void {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    this.from = this.toISODate(start);
    this.to = this.toISODate(now);
    this.load();
  }

  private toISODate(d: Date): string {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  applyFilters(): void {
    this.page = 1;
    this.load();
  }

  clearFilters(): void {
    this.from = '';
    this.to = '';
    this.module = '';
    this.action = '';
    this.actorName = '';
    this.entitySearch = '';
    this.page = 1;
    this.load();
  }

  prev(): void {
    if (this.page <= 1) return;
    this.page -= 1;
    this.load();
  }

  next(): void {
    if (this.page >= this.totalPages) return;
    this.page += 1;
    this.load();
  }

  private buildParams(): Record<string, string> {
    const uid = this.globals.currentUser?._id;
    const params: Record<string, string> = {
      userId: uid ? String(uid) : '',
      page: String(this.page),
      limit: String(this.limit),
    };

    const from = String(this.from || '').trim();
    const to = String(this.to || '').trim();
    if (from || to) {
      if (from) params.from = from;
      if (to) params.to = to;
    } else {
      // Empty dates = all history (not current month). Wide range also works if
      // an older API still requires from/to and defaults missing values to this month.
      params.allDates = '1';
      params.from = '2000-01-01';
      params.to = this.toISODate(new Date());
    }

    if (this.module) params.module = this.module;
    if (this.action) params.action = this.action;
    if (this.actorName.trim()) params.actorName = this.actorName.trim();
    if (this.entitySearch.trim()) params.entityId = this.entitySearch.trim();
    return params;
  }

  private tOr(key: string, fallback: string): string {
    const v = this.translate.instant(key);
    return !v || v === key ? fallback : v;
  }

  private translateAction(action?: string): string {
    const a = String(action || '').trim();
    if (!a) return '—';
    return this.tOr(`tr_audit_action_${a}`, a);
  }

  private translateModule(module?: string): string {
    const m = String(module || '').trim();
    if (!m) return '—';
    return this.tOr(`tr_audit_module_${m}`, m);
  }

  private translateEntityType(type?: string): string {
    const t = String(type || '').trim();
    if (!t) return '';
    return this.tOr(`tr_audit_entity_${t}`, t);
  }

  private translateBusinessStatus(status?: string): string {
    const s = String(status || '').trim();
    if (!s) return '';
    return this.tOr(`tr_audit_status_${s}`, s);
  }

  private translateHttpStatus(key?: string, code?: number): string {
    if (key) {
      const label = this.tOr(`tr_audit_http_${key}`, '');
      if (label) return label;
    }
    if (code != null) return String(code);
    return '';
  }

  private formatActor(x: AuditLogRow): string {
    const name = String(x.actorName || '').trim();
    const role = String(x.actorRole || '').trim();
    if (name && role) return `${name} — ${role}`;
    if (name) return name;
    if (role) return role;
    return this.tOr('tr_audit_actor_unknown', '—');
  }

  private asRecord(v: unknown): Record<string, unknown> {
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  }

  private pickProductCodes(x: AuditLogRow): string[] {
    const meta = this.asRecord(x.metadata);
    const after = this.asRecord(x.after);
    const before = this.asRecord(x.before);
    const out: string[] = [];
    const push = (v: unknown) => {
      const s = String(v ?? '').trim();
      if (s && !out.includes(s)) out.push(s);
    };

    push(meta['productCode']);
    push(after['code']);
    push(before['code']);

    const multi = after['codes'] || meta['productCodes'];
    if (Array.isArray(multi)) {
      for (const c of multi) push(c);
    }

    if (!out.length && PRODUCT_ENTITY_TYPES.has(String(x.entityType || ''))) {
      const label = String(x.entityLabel || '').trim();
      if (label && !label.startsWith('#')) {
        const sep = label.indexOf(' — ');
        if (sep > 0) push(label.slice(0, sep).trim());
      }
    }

    return out;
  }

  private serialTrackPart(code: string): ReportCellPart {
    return {
      text: code,
      routerLink: ['/products/serial-track'],
      queryParams: { code },
    };
  }

  private formatEntityCell(x: AuditLogRow): ReportCellPart[] {
    const typeLabel = this.translateEntityType(x.entityType);
    const label = String(x.entityLabel || '').trim();
    const codes = this.pickProductCodes(x);

    if (!codes.length) {
      const plain =
        label && typeLabel
          ? `${typeLabel}: ${label}`
          : label || typeLabel || '—';
      return [{ text: plain }];
    }

    const parts: ReportCellPart[] = [];
    if (typeLabel) parts.push({ text: `${typeLabel}: ` });

    if (codes.length > 1) {
      codes.forEach((c, i) => {
        if (i) parts.push({ text: ', ' });
        parts.push(this.serialTrackPart(c));
      });
      const name = String(
        this.asRecord(x.metadata)['productName'] ||
          this.asRecord(x.after)['name'] ||
          this.asRecord(x.before)['name'] ||
          ''
      ).trim();
      if (name) parts.push({ text: ` — ${name}` });
      return parts;
    }

    const code = codes[0];
    parts.push(this.serialTrackPart(code));
    if (label.startsWith(code)) {
      const rest = label.slice(code.length);
      if (rest) parts.push({ text: rest });
    } else if (label && label !== code) {
      parts.push({ text: ` — ${label}` });
    }
    return parts;
  }

  private formatStatus(x: AuditLogRow): string {
    const business = this.translateBusinessStatus(x.businessStatus);
    if (business) return business;
    const http = this.translateHttpStatus(x.httpStatusKey, x.statusCode);
    return http || '—';
  }

  private formatDetails(x: AuditLogRow): string {
    const msg = String(x.message || '').trim();
    if (msg) return msg;
    const meta = this.asRecord(x.metadata);
    const bits: string[] = [];
    if (meta['orderNumber'] != null) bits.push(`#${meta['orderNumber']}`);
    if (meta['productCode']) bits.push(String(meta['productCode']));
    if (meta['productName']) bits.push(String(meta['productName']));
    if (meta['quantity'] != null) bits.push(`×${meta['quantity']}`);
    return bits.length ? bits.join(' ') : '—';
  }

  private vmRow(x: AuditLogRow): any {
    const t = x.createdAt ? new Date(x.createdAt).toLocaleString() : '';
    return {
      createdAt: t,
      actor: this.formatActor(x),
      action: this.translateAction(x.action),
      module: this.translateModule(x.module),
      entity: this.formatEntityCell(x),
      details: this.formatDetails(x),
      status: this.formatStatus(x),
    };
  }

  load(): void {
    this.loading = true;
    this.audits.list(this.buildParams()).subscribe(
      (res) => {
        this.loading = false;
        this.totalCount = res?.meta?.totalCount || 0;
        this.totalPages = res?.meta?.totalPages || 1;
        this.rows = (res?.rows || []).map((x) => this.vmRow(x));
      },
      () => {
        this.loading = false;
        this.totalCount = 0;
        this.totalPages = 1;
        this.rows = [];
      }
    );
  }
}
