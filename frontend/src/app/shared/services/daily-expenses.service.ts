import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { DAILY_EXPENSES_URL } from '@core/base/urls';

export interface ExpenseTreasurySplit {
  key: string;
  label?: string;
  amount: number;
}

export interface DailyExpenseDto {
  _id: string;
  branch?: { _id: string; name?: string };
  amount: number;
  expenseType: string;
  notes?: string;
  expenseTreasuryKey?: string;
  expenseTreasuryLabel?: string;
  expenseTreasurySplits?: ExpenseTreasurySplit[];
  recordedBy?: { _id: string; name?: string; email?: string; role?: string };
  createdAt?: string;
  updatedAt?: string;
}

export interface DailyExpenseListMeta {
  currentPage: number;
  totalCount: number;
  /** Sum of amounts for all rows matching current filters (not only current page). */
  totalAmount: number;
  totalPages: number;
  nextPage: number | null;
  prevPage: number | null;
}

export interface DailyExpenseListResponse {
  expenses: DailyExpenseDto[];
  meta: DailyExpenseListMeta;
}

export interface CreateDailyExpensePayload {
  branch: string;
  /** Total; optional when expenseTreasurySplits provided (server sums splits). */
  amount?: number;
  expenseType: string;
  notes?: string;
  userId: string;
  expenseTreasurySplits?: ExpenseTreasurySplit[];
  expenseTreasuryKey?: string;
}

@Injectable({ providedIn: 'root' })
export class DailyExpensesService {
  constructor(private http: HttpClient) {}

  create(payload: CreateDailyExpensePayload): Observable<DailyExpenseDto> {
    return this.http.post<DailyExpenseDto>(DAILY_EXPENSES_URL, payload);
  }

  list(params: {
    viewerUserId: string;
    page?: number;
    limit?: number;
    branch_id?: string;
    dateFrom?: string;
    dateTo?: string;
    /** operating (default) | cash_movements | all */
    category?: 'operating' | 'cash_movements' | 'all';
  }): Observable<DailyExpenseListResponse> {
    let httpParams = new HttpParams().set('viewerUserId', params.viewerUserId);
    if (params.page != null) httpParams = httpParams.set('page', String(params.page));
    if (params.limit != null) httpParams = httpParams.set('limit', String(params.limit));
    if (params.branch_id) httpParams = httpParams.set('branch_id', params.branch_id);
    if (params.dateFrom) httpParams = httpParams.set('dateFrom', params.dateFrom);
    if (params.dateTo) httpParams = httpParams.set('dateTo', params.dateTo);
    if (params.category) httpParams = httpParams.set('category', params.category);
    return this.http.get<DailyExpenseListResponse>(DAILY_EXPENSES_URL, { params: httpParams });
  }
}
