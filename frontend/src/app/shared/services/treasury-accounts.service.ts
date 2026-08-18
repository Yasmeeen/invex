import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { TREASURY_URL } from '@core/base/urls';

export type MoneyAccountKind = 'cash' | 'treasury' | 'settlement';

export interface MoneyAccountBalance {
  key: string;
  label: string;
  kind: MoneyAccountKind;
  channel?: 'bank' | 'wallet' | '';
  accountNumber?: string;
  phone?: string;
  enabled?: boolean;
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
  counterAccountLabel?: string;
  note?: string;
  branchId?: string;
  branchName?: string;
  createdBy?: { _id: string; name?: string };
}

export interface TreasuryRecentEntry {
  _id: string;
  accountKey: string;
  accountLabel: string;
  counterAccountKey?: string;
  counterAccountLabel?: string;
  direction: 'in' | 'out';
  amount: number;
  occurredAt: string;
  sourceType: string;
  sourceId?: string | null;
  note?: string;
}

@Injectable({ providedIn: 'root' })
export class TreasuryAccountsService {
  constructor(private http: HttpClient) {}

  listAccounts(params: {
    userId: string;
    branch?: string;
    until?: string;
    includeSettlement?: boolean;
  }): Observable<{ branch: string | null; until: string; accounts: MoneyAccountBalance[] }> {
    let httpParams = new HttpParams().set('userId', params.userId);
    if (params.branch) httpParams = httpParams.set('branch', params.branch);
    if (params.until) httpParams = httpParams.set('until', params.until);
    if (params.includeSettlement) httpParams = httpParams.set('includeSettlement', '1');
    return this.http.get<{ branch: string; until: string; accounts: MoneyAccountBalance[] }>(
      `${TREASURY_URL}/accounts`,
      { params: httpParams }
    );
  }

  listRecent(params: {
    userId: string;
    branch?: string;
    limit?: number;
  }): Observable<{ branch: string | null; entries: TreasuryRecentEntry[] }> {
    let httpParams = new HttpParams()
      .set('userId', params.userId)
      .set('limit', String(params.limit || 8));
    if (params.branch) httpParams = httpParams.set('branch', params.branch);
    return this.http.get<{ branch: string; entries: TreasuryRecentEntry[] }>(
      `${TREASURY_URL}/recent`,
      { params: httpParams }
    );
  }

  getAccount(params: {
    key: string;
    userId: string;
    branch?: string;
    until?: string;
  }): Observable<{
    branch: string | null;
    allBranches?: boolean;
    account: {
      key: string;
      label: string;
      kind: MoneyAccountKind;
      channel?: string;
      accountNumber?: string;
      phone?: string;
    };
    linkedPaymentMethods?: Array<{ key: string; label: string }>;
    openingBalance: number;
    inTotal: number;
    outTotal: number;
    periodNet: number;
    expectedBalance: number;
  }> {
    let httpParams = new HttpParams().set('userId', params.userId);
    if (params.branch) httpParams = httpParams.set('branch', params.branch);
    if (params.until) httpParams = httpParams.set('until', params.until);
    return this.http.get<any>(`${TREASURY_URL}/accounts/${encodeURIComponent(params.key)}`, {
      params: httpParams,
    });
  }

  listLedger(params: {
    key: string;
    userId: string;
    branch?: string;
    from?: string;
    to?: string;
    methods?: string[];
    page?: number;
    limit?: number;
  }): Observable<{
    branch: string | null;
    allBranches?: boolean;
    accountKey: string;
    linkedPaymentMethods?: Array<{ key: string; label: string }>;
    methodTotals?: Array<{ key: string; label: string; inTotal: number; outTotal: number; net: number }>;
    page: number;
    limit: number;
    total: number;
    entries: TreasuryLedgerEntry[];
  }> {
    let httpParams = new HttpParams()
      .set('userId', params.userId)
      .set('page', String(params.page || 1))
      .set('limit', String(params.limit || 30));
    if (params.branch) httpParams = httpParams.set('branch', params.branch);
    if (params.from) httpParams = httpParams.set('from', params.from);
    if (params.to) httpParams = httpParams.set('to', params.to);
    if (params.methods?.length) {
      httpParams = httpParams.set('methods', params.methods.join(','));
    }
    return this.http.get<any>(
      `${TREASURY_URL}/accounts/${encodeURIComponent(params.key)}/ledger`,
      { params: httpParams }
    );
  }

  createTransfer(body: {
    userId: string;
    branch?: string;
    fromAccountKey: string;
    toAccountKey: string;
    amount: number;
    note?: string;
    isSettlement?: boolean;
  }): Observable<any> {
    return this.http.post(`${TREASURY_URL}/transfers`, body);
  }

  createDeposit(body: {
    userId: string;
    branch: string;
    accountKey: string;
    amount: number;
    note?: string;
  }): Observable<any> {
    return this.http.post(`${TREASURY_URL}/deposits`, body);
  }

  setOpeningBalance(
    key: string,
    body: {
      userId: string;
      branch?: string;
      amount: number;
      note?: string;
      allBranches?: boolean;
    }
  ): Observable<any> {
    return this.http.post(
      `${TREASURY_URL}/accounts/${encodeURIComponent(key)}/opening-balance`,
      body
    );
  }

  settleAccount(
    key: string,
    body: { userId: string; amount: number; note?: string }
  ): Observable<any> {
    return this.http.post(
      `${TREASURY_URL}/accounts/${encodeURIComponent(key)}/settle`,
      body
    );
  }
}
