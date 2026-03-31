import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { PRODUCT_BOOKINGS_URL } from '@core/base/urls';
import { ProductActiveBooking } from '@core/models/products.model';

export interface CreateProductBookingPayload {
  productId: string;
  quantity?: number;
  customerName: string;
  customerPhone: string;
  pickupType: 'branch_pickup' | 'online_shipping';
  shippingAddress?: string;
  depositAmount: number;
  bookingDate: string;
  userId: string;
}

export interface ProductBookingsSummary {
  totalBookedQty: number;
  stock: number;
  availableToBook: number;
}

export interface ProductBookingsForProductResponse {
  bookings: ProductActiveBooking[];
  summary: ProductBookingsSummary;
}

export interface BookingsReportSummary {
  totalBookings: number;
  totalUnits: number;
  totalDeposits: number;
  activeCount: number;
  cancelledCount: number;
  confirmedActive: number;
  pendingConfirmation: number;
}

export interface BookingsReportResponse {
  summary: BookingsReportSummary;
  byBranch: { branchName: string; totalBookings: number; totalUnits: number }[];
  topProducts: {
    productName?: string;
    productCode?: string;
    bookingCount: number;
    totalQty: number;
  }[];
  bookingsOverTime: { period: string; count: number; units: number }[];
  upcoming: unknown[];
  bookings: unknown[];
  meta: { totalCount: number; page: number; limit: number };
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

  confirmBooking(bookingId: string, body: { userId: string }): Observable<unknown> {
    return this.http.patch(`${PRODUCT_BOOKINGS_URL}/${bookingId}/confirm`, body);
  }

  /** viewerUserId: current user; admins see all bookings on the product, others only their own. */
  getForProduct(productId: string, viewerUserId: string): Observable<ProductBookingsForProductResponse> {
    return this.http.get<ProductBookingsForProductResponse>(`${PRODUCT_BOOKINGS_URL}/product/${productId}`, {
      params: { viewerUserId },
    });
  }

  /** Report analytics + paginated rows; use branch_id from branch ng-select. */
  getReport(params: Record<string, unknown>): Observable<BookingsReportResponse> {
    const httpParams: Record<string, string> = {};
    Object.keys(params).forEach((k) => {
      const v = params[k];
      if (v !== undefined && v !== null && String(v) !== '') {
        httpParams[k] = String(v);
      }
    });
    return this.http.get<BookingsReportResponse>(`${PRODUCT_BOOKINGS_URL}/report`, {
      params: httpParams,
    });
  }
}
