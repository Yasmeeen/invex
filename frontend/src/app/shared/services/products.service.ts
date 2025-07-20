import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BASE_URL, PRODUCT_CREATE_PRODUCT_URL, PRODUCT_DELETE_PRODUCT_URL, PRODUCT_UPDATE_PRODUCT_URL, PRODUCTS_URL } from '@core/base/urls';
import { AppNotificationService } from './app-notification.service';
import { Product } from '@core/models/products.model';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';


@Injectable({
  providedIn: 'root',
})
export class ProductsSerivce {

constructor(
  private http: HttpClient,
  private appNotificationService: AppNotificationService
) {}
getProducts(params: any) {
  return this.http.get(PRODUCTS_URL, { params: params });
}
getProduct(productId: any) {
  return this.http.get(PRODUCTS_URL+ `/${productId}`);
}

createProduct(params: any) {
  return this.http.post(PRODUCT_CREATE_PRODUCT_URL, params);
}
updateProduct(product: Product, productId: string): Observable<Product> {
  return this.http.put<Product>(PRODUCT_UPDATE_PRODUCT_URL + `/${productId}`, product).pipe(
    tap({
      error: (errorResponse: Error) => {
        this.appNotificationService.push('Update Product Failed', 'error');
      },
    })
  );
}

deleteProduct(productId: string) {
  return this.http.delete( PRODUCT_DELETE_PRODUCT_URL + '/' + productId).pipe(
    tap({
      error: (errorResponse: Error) => {
        this.appNotificationService.push('Delete Product Failed', 'error');
      },
    })
  );
}
}