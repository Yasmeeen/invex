import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { ONLINE_ORDERS_URL } from '@core/base/urls';
import { AuthenticationService } from '@core/services/authentication.service';
import { Observable } from 'rxjs';

export type OnlineOrderStatus =
  | 'pending'
  | 'preparing'
  | 'ready'
  | 'completed'
  | 'cancelled';

export type OnlineOrderChannel = 'crm' | 'website';

export interface OnlineOrderChannelCounts {
  all: number;
  crm: number;
  website: number;
}

@Injectable({ providedIn: 'root' })
export class OnlineOrdersService {
  constructor(
    private http: HttpClient,
    private auth: AuthenticationService
  ) {}

  private withUser(params = new HttpParams()): HttpParams {
    const userId = String(this.auth.getUserFromLocalStorage()?._id || '').trim();
    return userId ? params.set('userId', userId) : params;
  }

  list(filters: {
    page?: number;
    perPage?: number;
    status?: string;
    branchId?: string;
    channel?: OnlineOrderChannel | '';
    search?: string;
  } = {}): Observable<{
    orders: any[];
    meta: { page: number; perPage: number; total: number; totalPages: number };
    channelCounts?: OnlineOrderChannelCounts;
  }> {
    let params = new HttpParams();
    Object.keys(filters).forEach((key) => {
      const value = (filters as any)[key];
      if (value !== undefined && value !== null && value !== '') {
        params = params.set(key, String(value));
      }
    });
    return this.http.get(ONLINE_ORDERS_URL, { params: this.withUser(params) }) as Observable<any>;
  }

  get(id: string): Observable<any> {
    return this.http.get(`${ONLINE_ORDERS_URL}/${id}`, { params: this.withUser() });
  }

  /** Lightweight pending count for the global online-orders banner. */
  pendingSummary(branchId?: string): Observable<{
    count: number;
    status?: string;
    oldestPendingAt?: string | null;
  }> {
    let params = new HttpParams();
    if (branchId) {
      params = params.set('branchId', String(branchId));
    }
    return this.http.get<{
      count: number;
      status?: string;
      oldestPendingAt?: string | null;
    }>(`${ONLINE_ORDERS_URL}/pending-summary`, { params: this.withUser(params) });
  }

  updateStatus(
    id: string,
    status: OnlineOrderStatus,
    paymentMethod?: string,
    options?: { deliveryPersonName?: string }
  ): Observable<any> {
    const deliveryPersonName = String(options?.deliveryPersonName || '').trim();
    const userId = String(this.auth.getUserFromLocalStorage()?._id || '').trim();
    return this.http.patch(`${ONLINE_ORDERS_URL}/${id}/status`, {
      status,
      ...(userId ? { userId } : {}),
      ...(paymentMethod ? { paymentMethod } : {}),
      ...(deliveryPersonName ? { deliveryPersonName } : {}),
    });
  }
}
