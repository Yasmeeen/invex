import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { ONLINE_ORDERS_URL } from '@core/base/urls';
import { Observable } from 'rxjs';

export type OnlineOrderStatus =
  | 'pending'
  | 'preparing'
  | 'ready'
  | 'completed'
  | 'cancelled';

@Injectable({ providedIn: 'root' })
export class OnlineOrdersService {
  constructor(private http: HttpClient) {}

  list(filters: { page?: number; perPage?: number; status?: string } = {}): Observable<any> {
    let params = new HttpParams();
    Object.keys(filters).forEach((key) => {
      const value = (filters as any)[key];
      if (value !== undefined && value !== null && value !== '') {
        params = params.set(key, String(value));
      }
    });
    return this.http.get(ONLINE_ORDERS_URL, { params });
  }

  get(id: string): Observable<any> {
    return this.http.get(`${ONLINE_ORDERS_URL}/${id}`);
  }

  updateStatus(
    id: string,
    status: OnlineOrderStatus,
    paymentMethod?: string
  ): Observable<any> {
    return this.http.patch(`${ONLINE_ORDERS_URL}/${id}/status`, {
      status,
      ...(paymentMethod ? { paymentMethod } : {}),
    });
  }
}
