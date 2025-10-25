import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BASE_URL,PRODUCT_UPDATE_PRODUCT_URL, VENDORS_URL } from '@core/base/urls';
import { AppNotificationService } from './app-notification.service';
import { Product } from '@core/models/products.model';
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
getVendor(vendorId: any) {
  return this.http.get(VENDORS_URL+ `/${vendorId}`);
}

createProduct(params: any) {
  return this.http.post(VENDORS_URL+'/createVendor', params);
}
updateProduct(vendor: Product, vendorId: string): Observable<Product> {
  return this.http.put<Product>(VENDORS_URL + '/updateVendor' + `/${vendorId}`, vendor).pipe(
    tap({
      error: (errorResponse: Error) => {
        this.appNotificationService.push('Update Product Failed', 'error');
      },
    })
  );
}

deleteVendor(vendorId: string) {
  return this.http.delete(VENDORS_URL + '/deleteVendor' + vendorId).pipe(
    tap({
      error: (errorResponse: Error) => {
        this.appNotificationService.push('Delete Product Failed', 'error');
      },
    })
  );
}

}