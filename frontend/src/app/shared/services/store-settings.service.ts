import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, from, of } from 'rxjs';
import { catchError, concatMap, map, tap } from 'rxjs/operators';
import { TranslateService } from '@ngx-translate/core';
import { STORE_SETTINGS_URL } from '@core/base/urls';
export type ReceiptLanguageCode = 'ar' | 'en' | 'de' | 'fr';

const PAYMENT_FEE_BLOCKED = new Set(['cash', 'credit', 'mixed']);
const PAYMENT_FEE_KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;

export const RECEIPT_LANGUAGE_CODES: ReceiptLanguageCode[] = ['ar', 'en', 'de', 'fr'];

export interface PurchaseTreasuryMethod {
  key: string;
  label: string;
}

export interface PaymentAppFeePercent {
  method: string;
  label?: string;
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
  /** Return & exchange policy text (optional). */
  returnExchangePolicy: string;
  /** Print returnExchangePolicy on sale receipts when true. */
  showReturnExchangePolicyOnReceipt: boolean;
  /** Booking/reservation policy text (optional). */
  bookingPolicy: string;
  /** Print bookingPolicy on booking receipts when true. */
  showBookingPolicyOnReceipt: boolean;
}

const DEFAULTS: StoreSettings = {
  storeName: 'Store',
  storePhoneNumber: '',
  logoUrl: '',
  receiptLanguage: 'en',
  purchaseTreasuryMethods: [{ key: 'cash', label: 'Cash' }],
  paymentAppFeePercents: [],
  returnExchangePolicy: '',
  showReturnExchangePolicyOnReceipt: false,
  bookingPolicy: '',
  showBookingPolicyOnReceipt: false,
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
    const seen = new Set<string>();
    const out: PaymentAppFeePercent[] = [];
    for (const row of raw) {
      const method = String((row as PaymentAppFeePercent)?.method ?? '')
        .trim()
        .toLowerCase();
      if (!method || PAYMENT_FEE_BLOCKED.has(method) || !PAYMENT_FEE_KEY_RE.test(method) || seen.has(method)) {
        continue;
      }
      let percent = Number((row as PaymentAppFeePercent)?.percent);
      if (!Number.isFinite(percent)) {
        percent = 0;
      }
      percent = Math.max(0, Math.min(100, Math.round(percent * 100) / 100));
      const label = String((row as PaymentAppFeePercent)?.label ?? '').trim().slice(0, 120);
      seen.add(method);
      out.push({ method, label, percent });
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
          returnExchangePolicy: data.returnExchangePolicy ?? '',
          showReturnExchangePolicyOnReceipt: Boolean(data.showReturnExchangePolicyOnReceipt),
          bookingPolicy: data.bookingPolicy ?? '',
          showBookingPolicyOnReceipt: Boolean(data.showBookingPolicyOnReceipt),
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
   * Preload i18n JSON for receipt printing only (receipt lang + English fallback).
   * Uses HttpClient + setTranslation — NOT getTranslation — so we never stomp TranslateService.pending
   * while the UI language pack is loading via translate.use().
   */
  private ensureReceiptTranslationPacks(): void {
    const receiptLang = this._settings.value.receiptLanguage;
    const langs = Array.from(new Set<ReceiptLanguageCode>([receiptLang, 'en']));
    const missing = langs.filter((lang) => !this.translate.translations[lang]);
    if (!missing.length) {
      return;
    }
    from(missing)
      .pipe(
        concatMap((lang) =>
          this.http.get<Record<string, unknown>>(`/assets/i18n/${lang}.json`).pipe(
            map((body) => ({ lang, body })),
            tap(({ lang, body }) => this.translate.setTranslation(lang, body, false)),
            catchError(() => of(null))
          )
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
