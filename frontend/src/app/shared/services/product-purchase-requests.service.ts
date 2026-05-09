import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { PRODUCT_PURCHASE_REQUESTS_URL } from '@core/base/urls';

export interface DeskPurchaseProductPayload {
  name: string;
  code: string;
  categoryId: string;
  price: number;
  netPrice: number;
  discount?: number;
  attributes?: Record<string, string>;
  imageUrl?: string;
  notes?: string;
}

@Injectable({ providedIn: 'root' })
export class ProductPurchaseRequestsService {
  constructor(private http: HttpClient) {}

  create(payload: {
    userId: string;
    branchId: string;
    quantity?: number;
    product: DeskPurchaseProductPayload;
  }): Observable<any> {
    return this.http.post(PRODUCT_PURCHASE_REQUESTS_URL, payload);
  }

  approve(purchaseId: string, payload: { userId: string; resolutionNote?: string }): Observable<any> {
    return this.http.patch(`${PRODUCT_PURCHASE_REQUESTS_URL}/${purchaseId}/approve`, payload);
  }

  reject(purchaseId: string, payload: { userId: string; resolutionNote?: string }): Observable<any> {
    return this.http.patch(`${PRODUCT_PURCHASE_REQUESTS_URL}/${purchaseId}/reject`, payload);
  }

  getById(purchaseId: string, userId: string): Observable<any> {
    return this.http.get(`${PRODUCT_PURCHASE_REQUESTS_URL}/${purchaseId}`, {
      params: { userId },
    });
  }

  list(params: {
    status?: 'pending' | 'approved' | 'rejected';
    branchId?: string;
    page?: number;
    limit?: number;
  }): Observable<any> {
    const q: Record<string, string> = {};
    if (params.status) q.status = params.status;
    if (params.branchId) q.branchId = params.branchId;
    if (params.page != null) q.page = String(params.page);
    if (params.limit != null) q.limit = String(params.limit);
    return this.http.get(PRODUCT_PURCHASE_REQUESTS_URL, { params: q });
  }
}
