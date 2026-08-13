import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { PAYMENT_METHODS_URL } from '@core/base/urls';
import {
  PaymentMethodEffectMode,
  PaymentMethodShowIn,
} from './store-settings.service';

export interface PaymentMethodLinkedAccount {
  key: string;
  label: string;
  kind: string;
  channel?: string;
}

export interface PaymentMethodRecord {
  key: string;
  label: string;
  showIn: PaymentMethodShowIn;
  effectMode: PaymentMethodEffectMode;
  feePercent: number;
  accountKey: string;
  settlementBankAccountKey: string;
  linkedAccount?: PaymentMethodLinkedAccount | null;
}

export interface PaymentMethodPayload {
  label: string;
  showIn: PaymentMethodShowIn;
  effectMode: PaymentMethodEffectMode;
  feePercent?: number;
  accountKey?: string;
  settlementBankAccountKey?: string;
}

@Injectable({ providedIn: 'root' })
export class PaymentMethodsService {
  constructor(private http: HttpClient) {}

  list(): Observable<{ paymentMethods: PaymentMethodRecord[] }> {
    return this.http.get<{ paymentMethods: PaymentMethodRecord[] }>(PAYMENT_METHODS_URL);
  }

  create(body: PaymentMethodPayload): Observable<{ paymentMethod: PaymentMethodRecord }> {
    return this.http.post<{ paymentMethod: PaymentMethodRecord }>(PAYMENT_METHODS_URL, body);
  }

  update(
    key: string,
    body: Partial<PaymentMethodPayload>
  ): Observable<{ paymentMethod: PaymentMethodRecord }> {
    return this.http.put<{ paymentMethod: PaymentMethodRecord }>(
      `${PAYMENT_METHODS_URL}/${encodeURIComponent(key)}`,
      body
    );
  }

  delete(key: string): Observable<{ deleted: boolean; key: string }> {
    return this.http.delete<{ deleted: boolean; key: string }>(
      `${PAYMENT_METHODS_URL}/${encodeURIComponent(key)}`
    );
  }
}
