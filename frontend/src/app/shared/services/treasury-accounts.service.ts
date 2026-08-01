import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { TREASURY_URL } from '@core/base/urls';

export type MoneyAccountKind = 'cash' | 'treasury' | 'settlement';

export interface MoneyAccountBalance {
  key: string;
  label: string;
  kind: MoneyAccountKind;
  openingBalance: number;
  inTotal: number;
  outTotal: number;
  periodNet: number;
  expectedBalance: number;
  lastMovement?: {
    occurredAt: string;
    direction: 'in' | 'out';
    amount: number;
    sourceType: string;
  } | null;
}

export interface TreasuryLedgerEntry {
  _id: string;
  accountKey: string;
  direction: 'in' | 'out';
  amount: number;
  occurredAt: string;
  businessDate: string;
  sourceType: string;
  sourceId?: string;
  counterAccountKey?: string;
  note?: string;
  createdBy?: { _id: string; name?: string };
}

@Injectable({ providedIn: 'root' })
export class TreasuryAccountsService {
  constructor(private http: HttpClient) {}

  listAccounts(params: {
    userId: string;
    branch: string;
    until?: string;
  }): Observable<{ branch: string; until: string; accounts: MoneyAccountBalance[] }> {
    let httpParams = new HttpParams()
      .set('userId', params.userId)
      .set('branch', params.branch);
    if (params.until) httpParams = httpParams.set('until', params.until);
    return this.http.get<{ branch: string; until: string; accounts: MoneyAccountBalance[] }>(
      `${TREASURY_URL}/accounts`,
      { params: httpParams }
    );
  }

  getAccount(params: {
    key: string;
    userId: string;
    branch: string;
    until?: string;
  }): Observable<{
    branch: string;
    account: { key: string; label: string; kind: MoneyAccountKind };
    openingBalance: number;
    inTotal: number;
    outTotal: number;
    periodNet: number;
    expectedBalance: number;
  }> {
    let httpParams = new HttpParams()
      .set('userId', params.userId)
      .set('branch', params.branch);
    if (params.until) httpParams = httpParams.set('until', params.until);
    return this.http.get<any>(`${TREASURY_URL}/accounts/${encodeURIComponent(params.key)}`, {
      params: httpParams,
    });
  }

  listLedger(params: {
    key: string;
    userId: string;
    branch: string;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
  }): Observable<{
    branch: string;
    accountKey: string;
    page: number;
    limit: number;
    total: number;
    entries: TreasuryLedgerEntry[];
  }> {
    let httpParams = new HttpParams()
      .set('userId', params.userId)
      .set('branch', params.branch)
      .set('page', String(params.page || 1))
      .set('limit', String(params.limit || 30));
    if (params.from) httpParams = httpParams.set('from', params.from);
    if (params.to) httpParams = httpParams.set('to', params.to);
    return this.http.get<any>(
      `${TREASURY_URL}/accounts/${encodeURIComponent(params.key)}/ledger`,
      { params: httpParams }
    );
  }

  createTransfer(body: {
    userId: string;
    branch: string;
    fromAccountKey: string;
    toAccountKey: string;
    amount: number;
    note?: string;
    isSettlement?: boolean;
  }): Observable<any> {
    return this.http.post(`${TREASURY_URL}/transfers`, body);
  }

  setOpeningBalance(
    key: string,
    body: { userId: string; branch: string; amount: number; note?: string }
  ): Observable<any> {
    return this.http.post(
      `${TREASURY_URL}/accounts/${encodeURIComponent(key)}/opening-balance`,
      body
    );
  }
}
