import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { STORE_SETTINGS_URL } from '@core/base/urls';

export interface StoreSettings {
  storeName: string;
  storePhoneNumber: string;
  logoUrl: string;
}

const DEFAULTS: StoreSettings = {
  storeName: 'Store',
  storePhoneNumber: '',
  logoUrl: '',
};

@Injectable({ providedIn: 'root' })
export class StoreSettingsService {
  private _settings = new BehaviorSubject<StoreSettings>({ ...DEFAULTS });
  readonly settings$ = this._settings.asObservable();

  constructor(private http: HttpClient) {}

  get snapshot(): StoreSettings {
    return this._settings.value;
  }

  /** Load from API (call once after login / main layout). */
  load(): void {
    this.http.get<StoreSettings>(STORE_SETTINGS_URL).subscribe({
      next: (data) =>
        this._settings.next({
          ...this._settings.value,
          storeName: data.storeName ?? DEFAULTS.storeName,
          storePhoneNumber: data.storePhoneNumber ?? '',
          logoUrl: data.logoUrl ?? '',
        }),
      error: () => {},
    });
  }

  update(body: Partial<StoreSettings>): Observable<StoreSettings> {
    return this.http.put<StoreSettings>(STORE_SETTINGS_URL, body).pipe(
      tap((data) =>
        this._settings.next({
          ...this._settings.value,
          ...data,
        })
      )
    );
  }
}
