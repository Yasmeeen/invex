import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { PRODUCT_BOOKINGS_URL } from '@core/base/urls';
import { ProductActiveBooking } from '@core/models/products.model';

export interface CreateProductBookingPayload {
  productId: string;
  customerName: string;
  customerPhone: string;
  pickupType: 'branch_pickup' | 'online_shipping';
  shippingAddress?: string;
  depositAmount: number;
  bookingDate: string;
  userId: string;
}

@Injectable({ providedIn: 'root' })
export class ProductBookingsService {
  constructor(private http: HttpClient) {}

  createBooking(payload: CreateProductBookingPayload): Observable<unknown> {
    return this.http.post(PRODUCT_BOOKINGS_URL, payload);
  }

  cancelBooking(bookingId: string, body: { userId: string; reason?: string }): Observable<unknown> {
    return this.http.patch(`${PRODUCT_BOOKINGS_URL}/${bookingId}/cancel`, body);
  }

  getByProductId(productId: string): Observable<{ booking: ProductActiveBooking | null }> {
    return this.http.get<{ booking: ProductActiveBooking | null }>(
      `${PRODUCT_BOOKINGS_URL}/product/${productId}`
    );
  }
}
