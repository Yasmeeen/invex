import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { DRAWER_CLOSE_URL } from '@core/base/urls';

export interface DrawerClosePreview {
  businessDate: string;
  branchId: string;
  paymentsReceivedByMethod: Record<string, number>;
  refundsByMethod: Record<string, number>;
  restoredInvoiceCount: number;
  invoiceCount: number;
  dailyExpenseTotal: number;
  deskPurchaseCashOutTotal: number;
  deskPurchaseIntakeCount: number;
  cashReceivedTotal: number;
  cashRefundedTotal: number;
  expectedCashInDrawer: number;
}

export interface DrawerCloseRecord {
  _id: string;
  branch?: { _id: string; name?: string };
  businessDate: string;
  snapshot?: DrawerClosePreview & Record<string, unknown>;
  expectedCashInDrawer: number;
  actualCashCounted: number;
  variance: number;
  shortageReason?: string;
  closedBy?: { _id: string; name?: string; email?: string; role?: string };
  createdAt?: string;
  updatedAt?: string;
}

export interface DrawerCloseListMeta {
  currentPage: number;
  totalCount: number;
  totalPages: number;
  nextPage: number | null;
  prevPage: number | null;
}

export interface DrawerCloseListResponse {
  closes: DrawerCloseRecord[];
  meta: DrawerCloseListMeta;
}

export interface CloseDrawerPayload {
  branch: string;
  businessDate: string;
  userId: string;
  actualCashCounted: number;
  shortageReason?: string;
}

@Injectable({ providedIn: 'root' })
export class DrawerCloseService {
  constructor(private http: HttpClient) {}

  preview(params: { userId: string; branch: string; date: string }): Observable<DrawerClosePreview> {
    let httpParams = new HttpParams()
      .set('userId', params.userId)
      .set('branch', params.branch)
      .set('date', params.date);
    return this.http.get<DrawerClosePreview>(`${DRAWER_CLOSE_URL}/preview`, { params: httpParams });
  }

  close(payload: CloseDrawerPayload): Observable<DrawerCloseRecord> {
    return this.http.post<DrawerCloseRecord>(DRAWER_CLOSE_URL, payload);
  }

  list(params: {
    viewerUserId: string;
    page?: number;
    limit?: number;
    branch_id?: string;
    dateFrom?: string;
    dateTo?: string;
  }): Observable<DrawerCloseListResponse> {
    let httpParams = new HttpParams().set('viewerUserId', params.viewerUserId);
    if (params.page != null) httpParams = httpParams.set('page', String(params.page));
    if (params.limit != null) httpParams = httpParams.set('limit', String(params.limit));
    if (params.branch_id) httpParams = httpParams.set('branch_id', params.branch_id);
    if (params.dateFrom) httpParams = httpParams.set('dateFrom', params.dateFrom);
    if (params.dateTo) httpParams = httpParams.set('dateTo', params.dateTo);
    return this.http.get<DrawerCloseListResponse>(DRAWER_CLOSE_URL, { params: httpParams });
  }
}
