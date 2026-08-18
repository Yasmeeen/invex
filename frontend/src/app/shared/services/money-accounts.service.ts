import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { MONEY_ACCOUNTS_URL } from '@core/base/urls';
import { MoneyAccount, MoneyAccountChannel } from './store-settings.service';

export interface MoneyAccountPayload {
  label: string;
  kind?: 'cash' | 'treasury' | 'settlement';
  channel?: MoneyAccountChannel | '';
  accountNumber?: string;
  phone?: string;
  enabled?: boolean;
}

@Injectable({ providedIn: 'root' })
export class MoneyAccountsService {
  constructor(private http: HttpClient) {}

  list(opts?: { includeSettlement?: boolean }): Observable<{ accounts: MoneyAccount[] }> {
    let params = new HttpParams();
    if (opts?.includeSettlement) params = params.set('includeSettlement', '1');
    return this.http.get<{ accounts: MoneyAccount[] }>(MONEY_ACCOUNTS_URL, { params });
  }

  create(body: MoneyAccountPayload): Observable<{ account: MoneyAccount }> {
    return this.http.post<{ account: MoneyAccount }>(MONEY_ACCOUNTS_URL, body);
  }

  update(key: string, body: Partial<MoneyAccountPayload>): Observable<{ account: MoneyAccount }> {
    return this.http.put<{ account: MoneyAccount }>(`${MONEY_ACCOUNTS_URL}/${encodeURIComponent(key)}`, body);
  }

  delete(key: string): Observable<{ deleted: boolean; key: string }> {
    return this.http.delete<{ deleted: boolean; key: string }>(
      `${MONEY_ACCOUNTS_URL}/${encodeURIComponent(key)}`
    );
  }
}
