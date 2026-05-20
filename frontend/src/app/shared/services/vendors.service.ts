import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { VENDORS_URL } from '@core/base/urls';
import { AppNotificationService } from './app-notification.service';
import { Vendor, VendorHistoryResponse } from '@core/models/products.model';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';


@Injectable({
  providedIn: 'root',
})
export class VendorsSerivce {

constructor(
  private http: HttpClient,
  private appNotificationService: AppNotificationService
) {}
getVendors(params: any) {
  return this.http.get(VENDORS_URL, { params: params });
}
getVendor(vendorId: string): Observable<Vendor> {
  return this.http.get<Vendor>(`${VENDORS_URL}/${vendorId}`);
}

createVendor(params: any) {
  return this.http.post(VENDORS_URL+'/createVendor', params);
}
updateVendor(vendor: Vendor, vendorId: string): Observable<Vendor> {
  return this.http.put<Vendor>(VENDORS_URL + '/updateVendor' + `/${vendorId}`, vendor).pipe(
    tap({
      error: (errorResponse: Error) => {
        this.appNotificationService.push('Update Product Failed', 'error');
      },
    })
  );
}

deleteVendor(vendorId: string) {
  return this.http.delete(VENDORS_URL + '/deleteVendor/' + vendorId).pipe(
    tap({
      error: (errorResponse: Error) => {
        this.appNotificationService.push('Delete Product Failed', 'error');
      },
    })
  );
}

getVendorByPhone(phone: string): Observable<Vendor> {
  const encoded = encodeURIComponent(String(phone).trim());
  return this.http.get<Vendor>(`${VENDORS_URL}/by-phone/${encoded}`);
}

getVendorHistory(vendorId: string): Observable<VendorHistoryResponse> {
  return this.http.get<VendorHistoryResponse>(`${VENDORS_URL}/${vendorId}/history`);
}

settleVendorBalances(
  vendorId: string,
  payload: { userId?: string; note?: string }
): Observable<any> {
  return this.http.post(`${VENDORS_URL}/${vendorId}/settle`, payload);
}

addVendorDeposit(
  vendorId: string,
  payload: { amount: number; userId?: string; note?: string }
): Observable<any> {
  return this.http.post(`${VENDORS_URL}/${vendorId}/deposit`, payload);
}

recordDeferredPurchasePayment(
  vendorId: string,
  payload: { purchasingRequestId: string; amount: number; userId?: string; note?: string }
): Observable<any> {
  return this.http.post(`${VENDORS_URL}/${vendorId}/deferred-payment`, payload);
}

}