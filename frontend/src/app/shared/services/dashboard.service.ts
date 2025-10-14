import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { BASE_URL, ORDER_STATISTICS } from '@core/base/urls';
import { orderStatistics } from '@core/models/dashboard.model';



@Injectable({
  providedIn: 'root'
})
export class DashboardService {

  constructor(private http: HttpClient) {}

  getDashboardStats(filters?:any): Observable<orderStatistics> {
    let params = new HttpParams();
    if (filters?.from) params = params.set('from', filters.from);
    if (filters?.to) params = params.set('to', filters.to);
    if (filters?.branch) params = params.set('branch', filters.branch);

    return this.http.get<orderStatistics>(`${ORDER_STATISTICS}`, { params });
  }
  getInvoicesPerMonth(branchId?: string, year?: number) {
    const params: any = {};
    if (branchId) params.branchId = branchId;
    if (year) params.year = year;
  
    return this.http.get(`${BASE_URL}/api/dashboard/invoicesPerMonth`, { params });
  }
  getCategoriesStats(branchId?:string): Observable<any> {
    let params: any = {};
    if (branchId) params.branch = branchId;
    return this.http.get(`${BASE_URL}/api/dashboard/categoriesStats`,{ params });
  }
  getOrdersStatusStats(branchId?: string) {
    let params: any = {};
    if (branchId) params.branch = branchId;
    return this.http.get(`${BASE_URL}/api/dashboard/getOrdersStatusStats`, { params });
  }
  
}
