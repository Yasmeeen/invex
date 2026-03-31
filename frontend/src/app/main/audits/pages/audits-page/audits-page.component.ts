import { Component, OnInit } from '@angular/core';
import { Globals } from '@core/globals';
import { AuditsService, AuditLogRow } from '@shared/services/audits.service';

type Col = { key: string; labelKey: string };

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
  actorUserId = '';
  entityId = '';

  page = 1;
  limit = 50;
  totalPages = 1;
  totalCount = 0;

  columns: Col[] = [
    { key: 'createdAt', labelKey: 'tr_audit_col_time' },
    { key: 'actor', labelKey: 'tr_audit_col_actor' },
    { key: 'action', labelKey: 'tr_audit_col_action' },
    { key: 'module', labelKey: 'tr_audit_col_module' },
    { key: 'entity', labelKey: 'tr_audit_col_entity' },
    { key: 'path', labelKey: 'tr_audit_col_path' },
    { key: 'statusCode', labelKey: 'tr_audit_col_status' },
  ];

  rows: any[] = [];

  constructor(private audits: AuditsService, public globals: Globals) {}

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
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    this.from = this.toISODate(start);
    this.to = this.toISODate(now);
    this.module = '';
    this.action = '';
    this.actorUserId = '';
    this.entityId = '';
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
      from: this.from,
      to: this.to,
    };
    if (this.module) params.module = this.module;
    if (this.action) params.action = this.action;
    if (this.actorUserId) params.actorUserId = this.actorUserId;
    if (this.entityId) params.entityId = this.entityId;
    return params;
  }

  private vmRow(x: AuditLogRow): any {
    const t = x.createdAt ? new Date(x.createdAt).toLocaleString() : '';
    const actor = [x.actorName, x.actorRole].filter(Boolean).join(' — ');
    const entity = [x.entityType, x.entityId].filter(Boolean).join(' #');
    return {
      createdAt: t,
      actor: actor || '—',
      action: x.action || '—',
      module: x.module || '—',
      entity: entity || '—',
      path: x.path || '—',
      statusCode: x.statusCode ?? '—',
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

