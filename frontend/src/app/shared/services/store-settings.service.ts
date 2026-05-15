import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, from, of } from 'rxjs';
import { catchError, concatMap, tap } from 'rxjs/operators';
import { TranslateService } from '@ngx-translate/core';
import { STORE_SETTINGS_URL } from '@core/base/urls';
import { PAYMENT_APP_FEE_METHOD_IDS } from '@shared/constants/payment-app-fee-methods';

export type ReceiptLanguageCode = 'ar' | 'en' | 'de' | 'fr';

export const RECEIPT_LANGUAGE_CODES: ReceiptLanguageCode[] = ['ar', 'en', 'de', 'fr'];

export interface PurchaseTreasuryMethod {
  key: string;
  label: string;
}

export interface PaymentAppFeePercent {
  method: string;
  percent: number;
}

export interface StoreSettings {
  storeName: string;
  storePhoneNumber: string;
  logoUrl: string;
  receiptLanguage: ReceiptLanguageCode;
  /** Purchase desk treasury buckets (from API; includes cash + banks/wallets). */
  purchaseTreasuryMethods: PurchaseTreasuryMethod[];
  /** Cashier: customer gross payment → invoice net (percent on top of net). */
  paymentAppFeePercents: PaymentAppFeePercent[];
}

const DEFAULTS: StoreSettings = {
  storeName: 'Store',
  storePhoneNumber: '',
  logoUrl: '',
  receiptLanguage: 'en',
  purchaseTreasuryMethods: [{ key: 'cash', label: 'Cash' }],
  paymentAppFeePercents: [],
};

@Injectable({ providedIn: 'root' })
export class StoreSettingsService {
  private _settings = new BehaviorSubject<StoreSettings>({ ...DEFAULTS });
  readonly settings$ = this._settings.asObservable();
  /** Bumps on each new GET and on each successful PUT so stale GET responses cannot overwrite fresher saves. */
  private loadEpoch = 0;

  constructor(private http: HttpClient, private translate: TranslateService) {}

  get snapshot(): StoreSettings {
    return this._settings.value;
  }

  private normalizePaymentAppFeePercents(raw: unknown): PaymentAppFeePercent[] {
    if (!Array.isArray(raw)) {
      return [];
    }
    const allowed = new Set<string>(PAYMENT_APP_FEE_METHOD_IDS as unknown as string[]);
    const seen = new Set<string>();
    const out: PaymentAppFeePercent[] = [];
    for (const row of raw) {
      const method = String((row as PaymentAppFeePercent)?.method ?? '')
        .trim()
        .toLowerCase();
      if (!method || !allowed.has(method) || seen.has(method)) {
        continue;
      }
      let percent = Number((row as PaymentAppFeePercent)?.percent);
      if (!Number.isFinite(percent)) {
        percent = 0;
      }
      percent = Math.max(0, Math.min(100, Math.round(percent * 100) / 100));
      seen.add(method);
      out.push({ method, percent });
    }
    out.sort((a, b) => a.method.localeCompare(b.method));
    return out;
  }

  /** Load from API (call once after login / main layout). */
  load(): void {
    const epoch = ++this.loadEpoch;
    this.http.get<StoreSettings>(STORE_SETTINGS_URL).subscribe({
      next: (data) => {
        if (epoch !== this.loadEpoch) {
          return;
        }
        const receiptLanguage = this.normalizeReceiptLanguage(data.receiptLanguage);
        const methods = Array.isArray(data.purchaseTreasuryMethods)
          ? data.purchaseTreasuryMethods
              .filter((m: PurchaseTreasuryMethod) => m?.key && m?.label)
              .map((m: PurchaseTreasuryMethod) => ({
                key: String(m.key).trim().toLowerCase(),
                label: String(m.label).trim(),
              }))
          : DEFAULTS.purchaseTreasuryMethods;
        this._settings.next({
          ...this._settings.value,
          storeName: data.storeName ?? DEFAULTS.storeName,
          storePhoneNumber: data.storePhoneNumber ?? '',
          logoUrl: data.logoUrl ?? '',
          receiptLanguage,
          purchaseTreasuryMethods: methods.length ? methods : DEFAULTS.purchaseTreasuryMethods,
          paymentAppFeePercents: this.normalizePaymentAppFeePercents(data.paymentAppFeePercents),
        });
        this.ensureReceiptTranslationPacks();
      },
      error: () => {},
    });
  }

  private normalizeReceiptLanguage(v: string | undefined | null): ReceiptLanguageCode {
    if (v == null || typeof v !== 'string') {
      return 'en';
    }
    const lower = v.trim().toLowerCase() as ReceiptLanguageCode;
    if (RECEIPT_LANGUAGE_CODES.includes(lower)) {
      return lower;
    }
    return 'en';
  }

  /**
   * Load missing i18n JSON for receipt languages (sequential — avoids ngx-translate races from parallel getTranslation).
   * Safe to call repeatedly; skips langs already on TranslateService.store.
   */
  private ensureReceiptTranslationPacks(): void {
    const missing = RECEIPT_LANGUAGE_CODES.filter((lang) => !this.translate.translations[lang]);
    if (!missing.length) {
      return;
    }
    from(missing)
      .pipe(
        concatMap((lang) =>
          this.translate.getTranslation(lang).pipe(catchError(() => of(null)))
        )
      )
      .subscribe();
  }

  update(body: Partial<StoreSettings>): Observable<StoreSettings> {
    return this.http.put<StoreSettings>(STORE_SETTINGS_URL, body).pipe(
      tap((data) => {
        this.loadEpoch++;
        const receiptFromResponse =
          data.receiptLanguage !== undefined && data.receiptLanguage !== null
            ? data.receiptLanguage
            : undefined;
        const receiptFromBody =
          body.receiptLanguage !== undefined && body.receiptLanguage !== null
            ? body.receiptLanguage
            : undefined;
        const receiptLanguage = this.normalizeReceiptLanguage(
          receiptFromResponse ?? receiptFromBody ?? this._settings.value.receiptLanguage
        );
        const mergedMethods =
          Array.isArray(data.purchaseTreasuryMethods) && data.purchaseTreasuryMethods.length
            ? data.purchaseTreasuryMethods.map((m: PurchaseTreasuryMethod) => ({
                key: String(m.key).trim().toLowerCase(),
                label: String(m.label).trim(),
              }))
            : this._settings.value.purchaseTreasuryMethods;
        const mergedFees =
          data.paymentAppFeePercents !== undefined && data.paymentAppFeePercents !== null
            ? this.normalizePaymentAppFeePercents(data.paymentAppFeePercents)
            : this._settings.value.paymentAppFeePercents;
        this._settings.next({
          ...this._settings.value,
          ...data,
          receiptLanguage,
          purchaseTreasuryMethods: mergedMethods?.length ? mergedMethods : DEFAULTS.purchaseTreasuryMethods,
          paymentAppFeePercents: mergedFees,
        });
        this.ensureReceiptTranslationPacks();
      })
    );
  }
}
