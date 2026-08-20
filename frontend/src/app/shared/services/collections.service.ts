import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { COLLECTIONS_URL } from '@core/base/urls';

export interface CollectionDueItem {
  orderId: string;
  orderNumber?: number;
  clientId?: string;
  clientName?: string;
  clientPhoneNumber?: string;
  collectorId?: string;
  collectorName?: string;
  branchName?: string;
  planName?: string;
  planMonths?: number;
  installmentId: string;
  sequence?: number;
  dueDate?: string;
  amount?: number;
  paidAmount?: number;
  remaining?: number;
  promiseToPayAt?: string;
  note?: string;
  status?: 'due' | 'overdue' | 'promised' | 'severe' | 'paid';
  orderRemaining?: number;
  daysOverdue?: number;
}

export interface CollectorUser {
  _id: string;
  name?: string;
  email?: string;
  role?: string;
  branch?: { _id?: string; name?: string };
}

export interface CollectorPerformance {
  collectorId: string;
  collectorName: string;
  target: number;
  collected: number;
  overdue: number;
  collectionRate: number;
  status: 'excellent' | 'good' | 'follow_up' | 'low';
}

export interface CollectionsDashboardResponse {
  summary: {
    totalInstallments: number;
    collected: number;
    overdue: number;
    dueSoon: number;
    collectionRate: number;
  };
  collectors: CollectorPerformance[];
  monthly: {
    target: number;
    collected: number;
    series: { key: string; label: string; target: number; collected: number }[];
  };
  overdueItems: CollectionDueItem[];
  promisesToday: {
    count: number;
    items: CollectionDueItem[];
  };
}

@Injectable({ providedIn: 'root' })
export class CollectionsService {
  constructor(private http: HttpClient) {}

  getDashboard(params: {
    collectorId?: string;
    branchId?: string;
    status?: string;
    from?: string;
    to?: string;
  }): Observable<CollectionsDashboardResponse> {
    let httpParams = new HttpParams();
    Object.keys(params || {}).forEach((k) => {
      const v = (params as any)[k];
      if (v !== undefined && v !== null && v !== '') {
        httpParams = httpParams.set(k, String(v));
      }
    });
    return this.http.get<CollectionsDashboardResponse>(`${COLLECTIONS_URL}/dashboard`, {
      params: httpParams,
    });
  }

  listDue(params: {
    collectorId?: string;
    status?: string;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
  }): Observable<{
    items: CollectionDueItem[];
    meta: any;
    summary: {
      dueCount: number;
      overdueCount: number;
      promisedCount: number;
      dueAmount: number;
    };
  }> {
    let httpParams = new HttpParams();
    Object.keys(params || {}).forEach((k) => {
      const v = (params as any)[k];
      if (v !== undefined && v !== null && v !== '') {
        httpParams = httpParams.set(k, String(v));
      }
    });
    return this.http.get<any>(`${COLLECTIONS_URL}/due`, { params: httpParams });
  }

  listCollectors(): Observable<{ collectors: CollectorUser[] }> {
    return this.http.get<{ collectors: CollectorUser[] }>(`${COLLECTIONS_URL}/collectors`);
  }
}
