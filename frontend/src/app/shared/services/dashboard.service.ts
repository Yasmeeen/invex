import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ORDER_STATISTICS } from '@core/base/urls';
import { orderStatistics } from '@core/models/dashboard.model';



@Injectable({
  providedIn: 'root'
})
export class DashboardService {

  constructor(private http: HttpClient) {}

  getDashboardStats(filters?: { from?: string; to?: string; branch?: string }): Observable<orderStatistics> {
    let params = new HttpParams();
    if (filters?.from) params = params.set('from', filters.from);
    if (filters?.to) params = params.set('to', filters.to);
    if (filters?.branch) params = params.set('branch', filters.branch);

    return this.http.get<orderStatistics>(`${ORDER_STATISTICS}`, { params });
  }
}
