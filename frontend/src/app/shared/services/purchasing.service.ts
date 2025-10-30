import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { PRODUCTS_URL, PURCHASING_URL } from '@core/base/urls';
import { AppNotificationService } from './app-notification.service';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { PurchasingRequest } from '@core/models/products.model';

@Injectable({
  providedIn: 'root',
})
export class PurchasingRequestsService {
  constructor(
    private http: HttpClient,
    private appNotificationService: AppNotificationService
  ) {}

  // 🔹 Get all purchasing requests (with pagination/filter params)
  getPurchasingRequests(params: any) {
    return this.http.get(PURCHASING_URL, { params });
  }



  // 🔹 Get single purchasing request by ID
  getPurchasingRequest(id: string) {
    return this.http.get(`${PURCHASING_URL}/${id}`);
  }

  // 🔹 Create new purchasing request
  createPurchasingRequest(request: PurchasingRequest): Observable<PurchasingRequest> {
    return this.http.post<PurchasingRequest>(`${PURCHASING_URL}/createPurchasingRequest`, request).pipe(
      tap({
        next: () =>
          this.appNotificationService.push('Purchasing request created successfully', 'success'),
        error: () =>
          this.appNotificationService.push('Create purchasing request failed', 'error'),
      })
    );
  }

  // 🔹 Update existing purchasing request
  updatePurchasingRequest(requestId: string, request: PurchasingRequest): Observable<PurchasingRequest> {
    return this.http.put<PurchasingRequest>(`${PURCHASING_URL}/update/${requestId}`, request).pipe(
      tap({
        next: () =>
          this.appNotificationService.push('Purchasing request updated successfully', 'success'),
        error: () =>
          this.appNotificationService.push('Update purchasing request failed', 'error'),
      })
    );
  }

  // 🔹 Delete purchasing request
  deletePurchasingRequest(requestId: string) {
    return this.http.delete(`${PURCHASING_URL}/delete/${requestId}`).pipe(
      tap({
        next: () =>
          this.appNotificationService.push('Purchasing request deleted successfully', 'success'),
        error: () =>
          this.appNotificationService.push('Delete purchasing request failed', 'error'),
      })
    );
  }
}
