import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, from, of } from 'rxjs';
import { catchError, concatMap, tap } from 'rxjs/operators';
import { TranslateService } from '@ngx-translate/core';
import { STORE_SETTINGS_URL } from '@core/base/urls';

export type ReceiptLanguageCode = 'ar' | 'en' | 'de' | 'fr';

export const RECEIPT_LANGUAGE_CODES: ReceiptLanguageCode[] = ['ar', 'en', 'de', 'fr'];

export interface StoreSettings {
  storeName: string;
  storePhoneNumber: string;
  logoUrl: string;
  receiptLanguage: ReceiptLanguageCode;
}

const DEFAULTS: StoreSettings = {
  storeName: 'Store',
  storePhoneNumber: '',
  logoUrl: '',
  receiptLanguage: 'en',
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

  /** Load from API (call once after login / main layout). */
  load(): void {
    const epoch = ++this.loadEpoch;
    this.http.get<StoreSettings>(STORE_SETTINGS_URL).subscribe({
      next: (data) => {
        if (epoch !== this.loadEpoch) {
          return;
        }
        const receiptLanguage = this.normalizeReceiptLanguage(data.receiptLanguage);
        this._settings.next({
          ...this._settings.value,
          storeName: data.storeName ?? DEFAULTS.storeName,
          storePhoneNumber: data.storePhoneNumber ?? '',
          logoUrl: data.logoUrl ?? '',
          receiptLanguage,
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
        this._settings.next({
          ...this._settings.value,
          ...data,
          receiptLanguage,
        });
        this.ensureReceiptTranslationPacks();
      })
    );
  }
}
