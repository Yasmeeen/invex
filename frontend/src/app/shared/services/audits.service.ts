import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { AUDITS_URL } from '@core/base/urls';
import { Observable } from 'rxjs';

export type AuditLogRow = {
  _id: string;
  createdAt: string;
  actorName?: string;
  actorRole?: string;
  action: string;
  module?: string;
  entityType?: string;
  entityId?: string;
  path?: string;
  method?: string;
  statusCode?: number;
  ip?: string;
  message?: string;
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

