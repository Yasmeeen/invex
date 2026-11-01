import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { TranslateService } from '@ngx-translate/core';
import { STOCK_COUNTS_URL } from '@core/base/urls';
import { PaginationData } from '@core/models/users-interfaces.model';

export interface StockCountCategorySnap {
  categoryId: string;
  name: string;
}

export interface StockCountSummary {
  expectedUnits: number;
  countedUnits: number;
  shortageUnits: number;
  surplusUnits: number;
}

export interface StockCountDto {
  _id: string;
  locationType: 'branch' | 'warehouse';
  branch?: { _id: string; name?: string } | null;
  branchName?: string;
  categories: StockCountCategorySnap[];
  status: 'open' | 'completed';
  note?: string;
  startedAt?: string;
  completedAt?: string | null;
  createdBy?: { userId?: string; name?: string };
  summary: StockCountSummary;
}

export interface StockCountLine {
  scanId?: string;
  productId?: string;
  name?: string;
  code?: string;
  rawCode?: string;
  categoryName?: string;
  reason?: string;
  scannedAt?: string;
  expectedQty?: number;
  scannedQty?: number;
  shortageQty?: number;
  diffQty?: number;
  imageUrl?: string;
  subtitle?: string;
}

export type StockCountSection = 'all' | 'shortage' | 'surplus' | 'scanned';

export interface StockCountDetailResponse {
  count: StockCountDto;
  section: StockCountSection;
  lines: StockCountLine[];
  meta: PaginationData;
}

export interface StockCountListResponse {
  counts: StockCountDto[];
  meta: PaginationData;
}

export interface StockCountScanResponse {
  feedback: 'matched' | 'surplus' | 'already_scanned' | 'ambiguous';
  reason?: string;
  rawCode?: string;
  product?: { name?: string; code?: string; categoryName?: string };
  summary: StockCountSummary;
}

export interface CreateStockCountPayload {
  userId: string;
  categoryIds: string[];
  locationType?: 'branch' | 'warehouse';
  branchId?: string;
  note?: string;
}

interface ApiErrorBody {
  error?: string;
  code?: string;
  names?: string[];
}

export function stockCountErrorMessage(
  translate: TranslateService,
  err: { error?: ApiErrorBody }
): string {
  const code = err?.error?.code;
  if (code === 'weight_category') {
    const names = (err.error?.names || []).filter((name) => !!name).join('، ');
    return translate.instant('tr_stock_count_err_weight_category', { names });
  }
  if (code) {
    const key = `tr_stock_count_err_${code}`;
    const text = translate.instant(key);
    if (text !== key) return text;
  }
  return translate.instant('tr_unexpected_error_message');
}

@Injectable({ providedIn: 'root' })
export class StockCountService {
  constructor(private http: HttpClient) {}

  list(params: {
    userId: string;
    page?: number;
    limit?: number;
    location?: string;
    status?: string;
    categoryId?: string;
    dateFrom?: string;
    dateTo?: string;
  }): Observable<StockCountListResponse> {
    let httpParams = new HttpParams().set('userId', params.userId);
    if (params.page != null) httpParams = httpParams.set('page', String(params.page));
    if (params.limit != null) httpParams = httpParams.set('limit', String(params.limit));
    if (params.location) httpParams = httpParams.set('location', params.location);
    if (params.status) httpParams = httpParams.set('status', params.status);
    if (params.categoryId) httpParams = httpParams.set('categoryId', params.categoryId);
    if (params.dateFrom) httpParams = httpParams.set('dateFrom', params.dateFrom);
    if (params.dateTo) httpParams = httpParams.set('dateTo', params.dateTo);
    return this.http.get<StockCountListResponse>(STOCK_COUNTS_URL, { params: httpParams });
  }

  create(payload: CreateStockCountPayload): Observable<{ count: StockCountDto }> {
    return this.http.post<{ count: StockCountDto }>(STOCK_COUNTS_URL, payload);
  }

  get(
    id: string,
    params: {
      userId: string;
      section?: StockCountSection;
      page?: number;
      limit?: number;
      q?: string;
      category?: string;
      exportAll?: boolean;
    }
  ): Observable<StockCountDetailResponse> {
    let httpParams = new HttpParams().set('userId', params.userId);
    if (params.section) httpParams = httpParams.set('section', params.section);
    if (params.page != null) httpParams = httpParams.set('page', String(params.page));
    if (params.limit != null) httpParams = httpParams.set('limit', String(params.limit));
    if (params.q) httpParams = httpParams.set('q', params.q);
    if (params.category) httpParams = httpParams.set('category', params.category);
    if (params.exportAll) httpParams = httpParams.set('export', '1');
    return this.http.get<StockCountDetailResponse>(`${STOCK_COUNTS_URL}/${id}`, {
      params: httpParams,
    });
  }

  scan(id: string, userId: string, code: string): Observable<StockCountScanResponse> {
    return this.http.post<StockCountScanResponse>(`${STOCK_COUNTS_URL}/${id}/scan`, {
      userId,
      code,
    });
  }

  removeScan(id: string, scanId: string, userId: string): Observable<{ count: StockCountDto }> {
    const params = new HttpParams().set('userId', userId);
    return this.http.delete<{ count: StockCountDto }>(
      `${STOCK_COUNTS_URL}/${id}/scans/${scanId}`,
      { params }
    );
  }

  complete(id: string, userId: string): Observable<{ count: StockCountDto }> {
    return this.http.post<{ count: StockCountDto }>(`${STOCK_COUNTS_URL}/${id}/complete`, {
      userId,
    });
  }

  delete(id: string, userId: string): Observable<{ ok: boolean }> {
    const params = new HttpParams().set('userId', userId);
    return this.http.delete<{ ok: boolean }>(`${STOCK_COUNTS_URL}/${id}`, { params });
  }
}
