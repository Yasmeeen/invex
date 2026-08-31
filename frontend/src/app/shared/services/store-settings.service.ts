import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, from, of } from 'rxjs';
import { catchError, concatMap, map, tap } from 'rxjs/operators';
import { TranslateService } from '@ngx-translate/core';
import { STORE_SETTINGS_URL } from '@core/base/urls';
import {
  canSeeCostPrice,
  DEFAULT_ROLES_HIDDEN_FROM_COST_PRICE,
  normalizeRolesHiddenFromCostPrice,
} from '@core/utils/role-utils';
export type ReceiptLanguageCode = 'ar' | 'en' | 'de' | 'fr';

export type BusinessActivityType = 'general' | 'butcher' | 'farm';

export const BUSINESS_ACTIVITY_TYPES: BusinessActivityType[] = ['general', 'butcher', 'farm'];

const PAYMENT_FEE_BLOCKED = new Set(['cash', 'credit', 'mixed']);
const PAYMENT_FEE_KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;

export const RECEIPT_LANGUAGE_CODES: ReceiptLanguageCode[] = ['ar', 'en', 'de', 'fr'];

export interface PurchaseTreasuryMethod {
  key: string;
  label: string;
}

export type MoneyAccountKind = 'cash' | 'treasury' | 'settlement';
export type MoneyAccountChannel = 'bank' | 'wallet' | '';

export interface MoneyAccount {
  key: string;
  label: string;
  kind: MoneyAccountKind;
  /** bank vs wallet for treasury accounts. */
  channel?: MoneyAccountChannel;
  /** Optional bank account number. */
  accountNumber?: string;
  /** Optional wallet phone. */
  phone?: string;
  /** When false, account is inactive in UI (cash stays always enabled). */
  enabled?: boolean;
}

export type PaymentMethodShowIn = 'sale' | 'purchase' | 'both';
export type PaymentMethodEffectMode = 'instant' | 'settlement' | 'none';
export type PaymentMethodMapMode = 'instant' | 'settlement';

export interface PaymentMethodCatalogRow {
  key: string;
  label: string;
  showIn: PaymentMethodShowIn;
  effectMode: PaymentMethodEffectMode;
  /** Sale/cashier fee only. */
  feePercent: number;
}

export interface PaymentMethodAccountMapRow {
  method: string;
  accountKey: string;
  mode?: PaymentMethodMapMode;
  settlementBankAccountKey?: string;
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
  /** Unified payment methods (visibility + effect + sale fee%). */
  paymentMethodsCatalog: PaymentMethodCatalogRow[];
  /** Purchase desk treasury buckets (from API; includes cash + banks/wallets). */
  purchaseTreasuryMethods: PurchaseTreasuryMethod[];
  /** Balance-bearing accounts including settlement apps. */
  moneyAccounts: MoneyAccount[];
  /** Cashier payment method → money account. */
  paymentMethodAccountMap: PaymentMethodAccountMapRow[];
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
  /** Master switch for sell-by-weight categories and cashier weight entry. */
  weightSalesEnabled: boolean;
  /** Deduct fridge/carcass stock when selling a cut SKU (butcher). Default off. */
  cutFromSourceEnabled: boolean;
  /** Master switch for delivery invoices at cashier. */
  deliveryOrdersEnabled: boolean;
  /** Master switch for desk product purchase + exchange at cashier. */
  cashierPurchaseExchangeEnabled: boolean;
  /** general = retail default; butcher | farm unlock slaughter & butcher SKUs. */
  businessActivityType: BusinessActivityType;
  /** Env-gated e-commerce integration. */
  ecommerceIntegrationFeatureAvailable?: boolean;
  ecommerceIntegrationEnabled?: boolean;
  ecommerceBaseUrl?: string;
  ecommerceSharedKey?: string;
  ecommerceCatalogMode?: 'all' | 'online_only';
  onlineBranchId?: string | null;
  /** Roles that must not see product cost / purchase price. Super Admin is never hidden. */
  rolesHiddenFromCostPrice?: string[];
}

const DEFAULTS: StoreSettings = {
  storeName: 'Store',
  storePhoneNumber: '',
  logoUrl: '',
  receiptLanguage: 'en',
  paymentMethodsCatalog: [
    { key: 'cash', label: 'Cash', showIn: 'both', effectMode: 'instant', feePercent: 0 },
    { key: 'credit', label: 'Credit', showIn: 'both', effectMode: 'none', feePercent: 0 },
  ],
  purchaseTreasuryMethods: [{ key: 'cash', label: 'Cash' }],
  moneyAccounts: [
    { key: 'cash', label: 'Cash', kind: 'cash', channel: '', accountNumber: '', phone: '', enabled: true },
  ],
  paymentMethodAccountMap: [
    { method: 'cash', accountKey: 'cash', mode: 'instant', settlementBankAccountKey: '' },
  ],
  paymentAppFeePercents: [],
  returnExchangePolicy: '',
  showReturnExchangePolicyOnReceipt: false,
  bookingPolicy: '',
  showBookingPolicyOnReceipt: false,
  weightSalesEnabled: false,
  cutFromSourceEnabled: false,
  deliveryOrdersEnabled: false,
  cashierPurchaseExchangeEnabled: true,
  businessActivityType: 'general',
  ecommerceIntegrationFeatureAvailable: false,
  ecommerceIntegrationEnabled: false,
  ecommerceBaseUrl: '',
  ecommerceSharedKey: '',
  ecommerceCatalogMode: 'all',
  onlineBranchId: null,
  rolesHiddenFromCostPrice: [...DEFAULT_ROLES_HIDDEN_FROM_COST_PRICE],
};

@Injectable({ providedIn: 'root' })
export class StoreSettingsService {
  private _settings = new BehaviorSubject<StoreSettings>({ ...DEFAULTS });
  readonly settings$ = this._settings.asObservable();
  /** True after the first GET or successful PUT — snapshot is no longer the in-memory default. */
  private _hydrated = false;
  /** Bumps on each new GET and on each successful PUT so stale GET responses cannot overwrite fresher saves. */
  private loadEpoch = 0;

  get hydrated(): boolean {
    return this._hydrated;
  }

  constructor(private http: HttpClient, private translate: TranslateService) {}

  get snapshot(): StoreSettings {
    return this._settings.value;
  }

  get butcherFeaturesEnabled(): boolean {
    const t = this.snapshot.businessActivityType || 'general';
    return t === 'butcher' || t === 'farm';
  }

  canSeeCostPrice(role: string | undefined | null): boolean {
    return canSeeCostPrice(role, this._settings.value.rolesHiddenFromCostPrice);
  }

  private normalizeBusinessActivityType(v: unknown): BusinessActivityType {
    const s = String(v || 'general').trim().toLowerCase();
    if (s === 'butcher' || s === 'farm') return s;
    return 'general';
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

  private normalizeMoneyAccounts(raw: unknown): MoneyAccount[] {
    if (!Array.isArray(raw)) return [...DEFAULTS.moneyAccounts];
    const seen = new Set<string>();
    const out: MoneyAccount[] = [];
    for (const row of raw as MoneyAccount[]) {
      const key = String(row?.key ?? '')
        .trim()
        .toLowerCase();
      const label = String(row?.label ?? '').trim();
      let kind = String(row?.kind ?? 'treasury').trim().toLowerCase() as MoneyAccountKind;
      if (!key || !label || seen.has(key)) continue;
      if (key === 'cash') kind = 'cash';
      if (kind !== 'cash' && kind !== 'treasury' && kind !== 'settlement') kind = 'treasury';
      let channel = String(row?.channel ?? '')
        .trim()
        .toLowerCase() as MoneyAccountChannel;
      if (kind !== 'treasury' || (channel !== 'bank' && channel !== 'wallet')) {
        channel = '';
      }
      const accountNumber =
        channel === 'bank' ? String(row?.accountNumber ?? '').trim().slice(0, 80) : '';
      const phone = channel === 'wallet' ? String(row?.phone ?? '').trim().slice(0, 40) : '';
      let enabled = (row as MoneyAccount)?.enabled !== false;
      if (key === 'cash') enabled = true;
      seen.add(key);
      out.push({ key, label, kind, channel, accountNumber, phone, enabled });
    }
    if (!out.some((a) => a.key === 'cash')) {
      out.unshift({
        key: 'cash',
        label: 'Cash',
        kind: 'cash',
        channel: '',
        accountNumber: '',
        phone: '',
        enabled: true,
      });
    }
    return out;
  }

  private normalizePaymentMethodsCatalog(raw: unknown): PaymentMethodCatalogRow[] {
    if (!Array.isArray(raw) || !raw.length) return [...DEFAULTS.paymentMethodsCatalog];
    const seen = new Set<string>();
    const out: PaymentMethodCatalogRow[] = [];
    for (const row of raw as PaymentMethodCatalogRow[]) {
      const key = String(row?.key ?? '')
        .trim()
        .toLowerCase();
      const label = String(row?.label ?? '').trim();
      if (!key || !label || seen.has(key) || key === 'mixed') continue;
      let showIn = String(row?.showIn || 'sale').toLowerCase() as PaymentMethodShowIn;
      if (showIn !== 'sale' && showIn !== 'purchase' && showIn !== 'both') showIn = 'sale';
      let effectMode = String(row?.effectMode || 'instant').toLowerCase() as PaymentMethodEffectMode;
      if (effectMode !== 'instant' && effectMode !== 'settlement' && effectMode !== 'none') {
        effectMode = 'instant';
      }
      if (key === 'credit') effectMode = 'none';
      if (key === 'cash') effectMode = 'instant';
      let feePercent = Number(row?.feePercent);
      if (!Number.isFinite(feePercent)) feePercent = 0;
      feePercent = Math.max(0, Math.min(100, feePercent));
      if (key === 'cash') feePercent = 0;
      else if (key !== 'credit' && effectMode === 'none') feePercent = 0;
      seen.add(key);
      out.push({ key, label, showIn, effectMode, feePercent });
    }
    if (!out.some((r) => r.key === 'cash')) {
      out.unshift({
        key: 'cash',
        label: 'Cash',
        showIn: 'both',
        effectMode: 'instant',
        feePercent: 0,
      });
    }
    return out;
  }

  private normalizePaymentMethodAccountMap(raw: unknown): PaymentMethodAccountMapRow[] {
    if (!Array.isArray(raw)) return [...DEFAULTS.paymentMethodAccountMap];
    const seen = new Set<string>();
    const out: PaymentMethodAccountMapRow[] = [];
    for (const row of raw as PaymentMethodAccountMapRow[]) {
      const method = String(row?.method ?? '')
        .trim()
        .toLowerCase();
      let accountKey = String(row?.accountKey ?? '')
        .trim()
        .toLowerCase();
      if (!method || !accountKey || seen.has(method) || method === 'credit' || method === 'mixed') {
        continue;
      }
      if (method === 'cash') accountKey = 'cash';
      let mode = String(row?.mode || 'instant').toLowerCase() as PaymentMethodMapMode;
      if (mode !== 'instant' && mode !== 'settlement') mode = 'instant';
      if (method === 'cash') mode = 'instant';
      let settlementBankAccountKey = String(row?.settlementBankAccountKey ?? '')
        .trim()
        .toLowerCase();
      if (mode !== 'settlement') settlementBankAccountKey = '';
      seen.add(method);
      out.push({ method, accountKey, mode, settlementBankAccountKey });
    }
    if (!out.some((r) => r.method === 'cash')) {
      out.unshift({
        method: 'cash',
        accountKey: 'cash',
        mode: 'instant',
        settlementBankAccountKey: '',
      });
    }
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
        this._hydrated = true;
        this._settings.next({
          ...this._settings.value,
          storeName: data.storeName ?? DEFAULTS.storeName,
          storePhoneNumber: data.storePhoneNumber ?? '',
          logoUrl: data.logoUrl ?? '',
          receiptLanguage,
          paymentMethodsCatalog: this.normalizePaymentMethodsCatalog(data.paymentMethodsCatalog),
          purchaseTreasuryMethods: methods.length ? methods : DEFAULTS.purchaseTreasuryMethods,
          moneyAccounts: this.normalizeMoneyAccounts(data.moneyAccounts),
          paymentMethodAccountMap: this.normalizePaymentMethodAccountMap(
            data.paymentMethodAccountMap
          ),
          paymentAppFeePercents: this.normalizePaymentAppFeePercents(data.paymentAppFeePercents),
          returnExchangePolicy: data.returnExchangePolicy ?? '',
          showReturnExchangePolicyOnReceipt: Boolean(data.showReturnExchangePolicyOnReceipt),
          bookingPolicy: data.bookingPolicy ?? '',
          showBookingPolicyOnReceipt: Boolean(data.showBookingPolicyOnReceipt),
          weightSalesEnabled: Boolean(data.weightSalesEnabled),
          cutFromSourceEnabled: Boolean(data.cutFromSourceEnabled),
          deliveryOrdersEnabled: Boolean(data.deliveryOrdersEnabled),
          cashierPurchaseExchangeEnabled: data.cashierPurchaseExchangeEnabled !== false,
          businessActivityType: this.normalizeBusinessActivityType(data.businessActivityType),
          ecommerceIntegrationFeatureAvailable: Boolean(data.ecommerceIntegrationFeatureAvailable),
          ecommerceIntegrationEnabled: Boolean(data.ecommerceIntegrationEnabled),
          ecommerceBaseUrl: data.ecommerceBaseUrl ?? '',
          ecommerceSharedKey: data.ecommerceSharedKey ?? '',
          ecommerceCatalogMode:
            data.ecommerceCatalogMode === 'online_only' ? 'online_only' : 'all',
          onlineBranchId: data.onlineBranchId ?? null,
          rolesHiddenFromCostPrice: normalizeRolesHiddenFromCostPrice(
            data.rolesHiddenFromCostPrice
          ),
        });
        this.ensureReceiptTranslationPacks();
      },
      error: () => {
        this._hydrated = true;
      },
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
        const mergedMoney =
          data.moneyAccounts !== undefined && data.moneyAccounts !== null
            ? this.normalizeMoneyAccounts(data.moneyAccounts)
            : this._settings.value.moneyAccounts;
        const mergedMap =
          data.paymentMethodAccountMap !== undefined && data.paymentMethodAccountMap !== null
            ? this.normalizePaymentMethodAccountMap(data.paymentMethodAccountMap)
            : this._settings.value.paymentMethodAccountMap;
        const mergedCatalog =
          data.paymentMethodsCatalog !== undefined && data.paymentMethodsCatalog !== null
            ? this.normalizePaymentMethodsCatalog(data.paymentMethodsCatalog)
            : this._settings.value.paymentMethodsCatalog;
        this._hydrated = true;
        this._settings.next({
          ...this._settings.value,
          ...data,
          receiptLanguage,
          paymentMethodsCatalog: mergedCatalog,
          purchaseTreasuryMethods: mergedMethods?.length ? mergedMethods : DEFAULTS.purchaseTreasuryMethods,
          moneyAccounts: mergedMoney,
          paymentMethodAccountMap: mergedMap,
          paymentAppFeePercents: mergedFees,
          ecommerceCatalogMode:
            (data as StoreSettings).ecommerceCatalogMode === 'online_only' ||
            body.ecommerceCatalogMode === 'online_only'
              ? 'online_only'
              : 'all',
          rolesHiddenFromCostPrice: normalizeRolesHiddenFromCostPrice(
            data.rolesHiddenFromCostPrice ??
              body.rolesHiddenFromCostPrice ??
              this._settings.value.rolesHiddenFromCostPrice
          ),
        });
        this.ensureReceiptTranslationPacks();
      })
    );
  }
}
