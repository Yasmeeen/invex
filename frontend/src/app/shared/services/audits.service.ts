import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { AUDITS_URL } from '@core/base/urls';
import { Observable } from 'rxjs';

export type AuditLogRow = {
  _id: string;
  createdAt: string;
  actorUserId?: string;
  actorName?: string;
  actorRole?: string;
  action: string;
  module?: string;
  entityType?: string;
  entityId?: string;
  entityLabel?: string;
  path?: string;
  method?: string;
  statusCode?: number;
  businessStatus?: string;
  httpStatusKey?: string;
  ip?: string;
  message?: string;
  metadata?: Record<string, unknown>;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
};

export type AuditLogsResponse = {
  rows: AuditLogRow[];
  meta: { page: number; limit: number; totalCount: number; totalPages: number };
};

@Injectable({ providedIn: 'root' })
export class AuditsService {
  constructor(private http: HttpClient) {}

  list(params: Record<string, string>): Observable<AuditLogsResponse> {
    return this.http.get<AuditLogsResponse>(AUDITS_URL, { params });
  }
}
