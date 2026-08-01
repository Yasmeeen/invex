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
  /** Saved on the Client profile when the phone is new; ignored when the client already exists. */
  registeredAddress: string;
  pickupType: 'branch_pickup' | 'online_shipping';
  shippingAddress?: string;
  depositAmount: number;
  paymentSplits?: Array<{ method: string; amount: number }>;
  paymentFeeAllocations?: Array<{
    forMethod: string;
    feeNet: number;
    paidVia: string;
    feeGrossOnPaidVia?: number;
    feePercentSnapshot?: number;
  }>;
  depositTransferImageUrl?: string;
  depositTransferImageUrls?: string[];
  /** Required when non-cash deposit methods or transfer proof images are uploaded. */
  transferReferencePhone?: string;
  userId: string;
  branchId?: string;
}

export interface CreateProductBookingResponse {
  message?: string;
  booking: ProductActiveBooking & {
    product?: string;
    createdAt?: string;
  };
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

export interface CheckoutActiveBooking {
  _id: string;
  productId: string;
  productName?: string;
  productCode?: string;
  clientId?: string;
  customerName?: string;
  customerPhone?: string;
  quantity: number;
  depositAmount: number;
  productUnitPrice?: number;
  confirmed?: boolean;
  createdAt?: string;
  bookingDate?: string;
}

export interface BookingDepositAllocation {
  bookingId: string;
  quantityApplied: number;
  creditApplied: number;
}

@Injectable({ providedIn: 'root' })
export class ProductBookingsService {
  constructor(private http: HttpClient) {}

  createBooking(payload: CreateProductBookingPayload): Observable<CreateProductBookingResponse> {
    return this.http.post<CreateProductBookingResponse>(PRODUCT_BOOKINGS_URL, payload);
  }

  /** Active bookings for cashier deposit credit (by phone and/or clientId). */
  getActiveForCheckout(params: {
    phone?: string;
    clientId?: string;
    productId?: string;
  }): Observable<{ bookings: CheckoutActiveBooking[] }> {
    const httpParams: Record<string, string> = {};
    if (params.phone) httpParams.phone = String(params.phone).trim();
    if (params.clientId) httpParams.clientId = String(params.clientId).trim();
    if (params.productId) httpParams.productId = String(params.productId).trim();
    return this.http.get<{ bookings: CheckoutActiveBooking[] }>(
      `${PRODUCT_BOOKINGS_URL}/active-for-checkout`,
      { params: httpParams }
    );
  }

  /** Confirmed active reservations on a SKU (cashier reserved-stock warning). */
  getActiveReservationsForProduct(
    productId: string
  ): Observable<{ bookings: CheckoutActiveBooking[] }> {
    return this.http.get<{ bookings: CheckoutActiveBooking[] }>(
      `${PRODUCT_BOOKINGS_URL}/active-reservations/${productId}`
    );
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
