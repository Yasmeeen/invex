import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BASE_URL, PRODUCT_CREATE_PRODUCT_URL, PRODUCT_DELETE_PRODUCT_URL, PRODUCT_UPDATE_PRODUCT_URL, ORDERS_URL, ORDER_CREATE_URL, ORDER_UPDATE_URL } from '@core/base/urls';
import { AppNotificationService } from './app-notification.service';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Order } from '@core/models/products.model';


@Injectable({
  providedIn: 'root',
})
export class OrdersSerivce {

constructor(
  private http: HttpClient,
  private appNotificationService: AppNotificationService
) {}
getOrders(params: any) {
  return this.http.get(ORDERS_URL, { params: params });
}
getOrder(orderId: any) {
  return this.http.get(ORDERS_URL+ `/${orderId}`);
}

createOrder(params: any) {
  return this.http.post(ORDER_CREATE_URL, params);
}

restoreOrder(orderId: string): Observable<any> {
  return this.http.put(`${ORDERS_URL}/${orderId}/restore`, {});
}

updateOrder(order:any): Observable<Order> {
  return this.http.put<Order>(ORDER_UPDATE_URL, order).pipe(
    tap({
      error: (errorResponse: Error) => {
        this.appNotificationService.push('Update Order Failed', 'error');
      },
    })
  );
}

}