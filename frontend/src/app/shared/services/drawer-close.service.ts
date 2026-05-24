import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { DRAWER_CLOSE_URL } from '@core/base/urls';

export type CashDisposition = 'deposit_all' | 'retain_all' | 'retain_partial';

export interface DeskPurchaseTreasuryLine {
  key: string;
  label: string;
  total: number;
  count: number;
}

export interface DrawerClosePreview {
  businessDate: string;
  branchId: string;
  periodStartDate: string;
  periodEndDate: string;
  missedDaysCount: number;
  openingCashBalance: number;
  periodNetCashMovements: number;
  paymentsReceivedByMethod: Record<string, number>;
  refundsByMethod: Record<string, number>;
  restoredInvoiceCount: number;
  invoiceCount: number;
  dailyExpenseTotal: number;
  /** Cash paid from physical drawer for desk purchases only (legacy alias). */
  deskPurchaseCashOutTotal: number;
  deskPurchaseCashDrawerTotal?: number;
  deskPurchaseGrandTotal?: number;
  deskPurchaseByTreasuryMethod?: DeskPurchaseTreasuryLine[];
  deskPurchaseIntakeCount: number;
  /** Cash paid to suppliers from vendor ledger (deposits + deferred/installment payments). */
  vendorCashDrawerTotal?: number;
  vendorCashDrawerPaymentCount?: number;
  /** Cash received from suppliers (deposits / opening debit payments). */
  vendorCashDrawerInflowTotal?: number;
  vendorCashDrawerInflowCount?: number;
  /** Cash collected from clients on credit sales (installments) — included in cashReceivedTotal. */
  clientOrderCashDrawerTotal?: number;
  clientOrderCashDrawerPaymentCount?: number;
  cashReceivedTotal: number;
  cashRefundedTotal: number;
  expectedCashInDrawer: number;
}

export interface DrawerOpeningBalance {
  branchId: string;
  businessDate: string;
  openingCashBalance: number;
  periodStartDate: string;
  periodEndDate: string;
  missedDaysCount: number;
  periodAlreadyClosed: boolean;
}

export interface DrawerCloseRecord {
  _id: string;
  branch?: { _id: string; name?: string };
  businessDate: string;
  periodStartDate?: string;
  periodEndDate?: string;
  openingCashBalance?: number;
  periodNetCashMovements?: number;
  snapshot?: DrawerClosePreview & Record<string, unknown>;
  expectedCashInDrawer: number;
  actualCashCounted: number;
  variance: number;
  shortageReason?: string;
  cashDisposition?: CashDisposition;
  retainedCash?: number;
  depositedCash?: number;
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
  cashDisposition: CashDisposition;
  retainedCash?: number;
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

  openingBalance(params: {
    userId: string;
    branch: string;
    date: string;
  }): Observable<DrawerOpeningBalance> {
    let httpParams = new HttpParams()
      .set('userId', params.userId)
      .set('branch', params.branch)
      .set('date', params.date);
    return this.http.get<DrawerOpeningBalance>(`${DRAWER_CLOSE_URL}/opening-balance`, {
      params: httpParams,
    });
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
