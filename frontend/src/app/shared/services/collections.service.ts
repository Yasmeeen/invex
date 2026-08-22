import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { BehaviorSubject, Observable } from 'rxjs';
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
  promiseToPayHistory?: Array<{
    promiseToPayAt?: string;
    recordedAt?: string;
    paidOnPromisedDay?: boolean | null;
  }>;
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
  /** Open installment invoices (when listCollectors?withWorkload=1). */
  openOrdersCount?: number;
  /** Distinct clients on those invoices. */
  openClientsCount?: number;
}

export interface CollectorPerformance {
  collectorId: string;
  collectorName: string;
  target: number;
  collected: number;
  overdue: number;
  collectionRate: number;
  status: 'excellent' | 'good' | 'follow_up' | 'low';
  openOrdersCount?: number;
  openClientsCount?: number;
}

export interface CollectionsDashboardResponse {
  summary: {
    totalInstallments: number;
    collected: number;
    overdue: number;
    dueSoon: number;
    collectionRate: number;
    unassignedOrdersCount?: number;
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
  private readonly hasInstallmentsSubject = new BehaviorSubject<boolean>(false);
  private hasInstallmentsFetchStarted = false;

  constructor(private http: HttpClient) {}

  /** Whether the store has any sale installment invoices. */
  hasInstallments(): Observable<boolean> {
    this.ensureHasInstallmentsLoaded();
    return this.hasInstallmentsSubject.asObservable();
  }

  /** Re-check the API (home/sidebar after backend was down or a merge restart). */
  refreshHasInstallments(): void {
    this.hasInstallmentsFetchStarted = true;
    this.http
      .get<{ hasInstallments: boolean }>(`${COLLECTIONS_URL}/has-installments`)
      .subscribe({
        next: (r) => this.hasInstallmentsSubject.next(!!r?.hasInstallments),
        error: () => {
          this.hasInstallmentsSubject.next(false);
          this.hasInstallmentsFetchStarted = false;
        },
      });
  }

  /** After the first installment sale, show collections UI without a full reload. */
  notifyInstallmentSaleCreated(): void {
    this.hasInstallmentsSubject.next(true);
  }

  private ensureHasInstallmentsLoaded(): void {
    if (this.hasInstallmentsFetchStarted) {
      return;
    }
    this.refreshHasInstallments();
  }

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
    branchId?: string;
    status?: string;
    from?: string;
    to?: string;
    promiseFrom?: string;
    promiseTo?: string;
    page?: number;
    limit?: number;
    sortBy?: string;
    sortDir?: 'asc' | 'desc';
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

  listCollectors(opts?: {
    withWorkload?: boolean;
  }): Observable<{ collectors: CollectorUser[] }> {
    let params = new HttpParams();
    if (opts?.withWorkload) {
      params = params.set('withWorkload', '1');
    }
    return this.http.get<{ collectors: CollectorUser[] }>(`${COLLECTIONS_URL}/collectors`, {
      params,
    });
  }

  assignOrderCollector(
    orderId: string,
    collectorId: string | null
  ): Observable<{
    orderId: string;
    orderNumber?: number;
    collectorId?: string | null;
    collectorName?: string;
  }> {
    return this.http.patch<any>(`${COLLECTIONS_URL}/orders/${orderId}/collector`, {
      collectorId,
    });
  }
}
