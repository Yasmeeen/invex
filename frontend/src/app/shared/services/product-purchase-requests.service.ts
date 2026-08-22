import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { PRODUCT_PURCHASE_REQUESTS_URL } from '@core/base/urls';
import { ProductAcquiredFrom } from '@core/models/products.model';

export interface PurchaseTreasurySplit {
  key: string;
  label?: string;
  amount: number;
}

export interface DeskPurchaseUnitDetail {
  code: string;
  price: number;
  netPrice: number;
  discount?: number;
  attributes?: Record<string, string>;
  imageUrl?: string;
}

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
  /** Employee who added the device */
  addedBy?: string;
  /** When category uses multi-code per piece and quantity > 1 */
  unitCodes?: string[];
  /** When units do not share price/discount/attributes — one entry per unit */
  unitDetails?: DeskPurchaseUnitDetail[];
  acquiredFrom?: ProductAcquiredFrom | null;
  /** Opt-in listing on the e-commerce catalog (default off). */
  listedOnEcommerce?: boolean;
  ecommerceDescription?: string;
  ecommerceShortDescription?: string;
  ecommerceIsFeatured?: boolean;
}

@Injectable({ providedIn: 'root' })
export class ProductPurchaseRequestsService {
  constructor(private http: HttpClient) {}

  create(payload: {
    userId: string;
    branchId: string;
    quantity?: number;
    product: DeskPurchaseProductPayload;
    /** Legacy single treasury (used when splits omitted). */
    purchaseTreasuryKey?: string;
    /** Split cost across treasuries; amounts must sum to netPrice × quantity. */
    purchaseTreasurySplits?: PurchaseTreasurySplit[];
    /** Cashier exchange trade-in: device intake only; treasury at settlement. */
    exchangeTradeIn?: boolean;
  }): Observable<any> {
    return this.http.post(PRODUCT_PURCHASE_REQUESTS_URL, payload);
  }

  /** Append another device to an existing exchange trade-in purchase (one invoice). */
  addLine(
    purchaseId: string,
    payload: {
      userId: string;
      quantity?: number;
      product: DeskPurchaseProductPayload;
    }
  ): Observable<any> {
    return this.http.post(`${PRODUCT_PURCHASE_REQUESTS_URL}/${purchaseId}/add-line`, payload);
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

  recordDeferredPayment(
    purchaseId: string,
    payload: {
      userId: string;
      branchId?: string;
      amount: number;
      paymentTreasurySplits: PurchaseTreasurySplit[];
      note?: string;
    }
  ): Observable<any> {
    return this.http.post(`${PRODUCT_PURCHASE_REQUESTS_URL}/${purchaseId}/deferred-payment`, payload);
  }

  list(params: {
    status?: 'pending' | 'approved' | 'rejected' | 'partially_returned' | 'returned';
    branchId?: string;
    page?: number;
    limit?: number;
    from?: string;
    to?: string;
    /** Filter by purchase treasury bucket (cash, deferred, bank_…); matches key or splits. */
    purchaseTreasuryKey?: string;
  }): Observable<any> {
    const q: Record<string, string> = {};
    if (params.status) q.status = params.status;
    if (params.branchId) q.branchId = params.branchId;
    if (params.from) q.from = params.from;
    if (params.to) q.to = params.to;
    if (params.purchaseTreasuryKey) q.purchaseTreasuryKey = params.purchaseTreasuryKey;
    if (params.page != null) q.page = String(params.page);
    if (params.limit != null) q.limit = String(params.limit);
    return this.http.get(PRODUCT_PURCHASE_REQUESTS_URL, { params: q });
  }

  returnPurchase(
    purchaseId: string,
    payload: {
      userId?: string;
      branchId?: string;
      note?: string;
      returnAll?: boolean;
      quantity?: number;
      unitRefundPrice?: number;
      cashRefundVia?: 'drawer' | 'treasury';
      cashTreasuryKey?: string;
      cashTreasuryLabel?: string;
      /** @deprecated Server computes treasury splits from original payment. */
      refundTreasurySplits?: PurchaseTreasurySplit[];
      returnedProductIds?: string[];
    }
  ): Observable<any> {
    return this.http.post(`${PRODUCT_PURCHASE_REQUESTS_URL}/${purchaseId}/return`, payload);
  }
}
