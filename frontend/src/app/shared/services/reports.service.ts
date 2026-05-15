import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { REPORTS_URL } from '@core/base/urls';

@Injectable({
  providedIn: 'root',
})
export class ReportsService {
  constructor(private http: HttpClient) {}

  getSalesReport(params: any) {
    return this.http.get(`${REPORTS_URL}/sales`, { params });
  }

  getProfitReport(params: any) {
    return this.http.get(`${REPORTS_URL}/profit`, { params });
  }

  getProductsReport(params: any) {
    return this.http.get(`${REPORTS_URL}/products`, { params });
  }

  getStockReport(params: any) {
    return this.http.get(`${REPORTS_URL}/stock`, { params });
  }

  getCustomersReport(params: any) {
    return this.http.get(`${REPORTS_URL}/customers`, { params });
  }

  getInstallmentsReport(params: any) {
    return this.http.get(`${REPORTS_URL}/installments`, { params });
  }

  getDeskPurchasesTreasuryReport(params: any) {
    return this.http.get(`${REPORTS_URL}/desk-purchases-treasury`, { params });
  }
}

