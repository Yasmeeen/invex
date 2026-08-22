import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import {
  ReceiptLanguageCode,
  StoreSettings,
  StoreSettingsService,
} from '@shared/services/store-settings.service';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { TranslateService } from '@ngx-translate/core';

type SettingsTabId = 'general' | 'payments' | 'policies' | 'ecommerce';

interface SettingsTab {
  id: SettingsTabId;
  labelKey: string;
  icon: string;
  /** When true, tab only shows if ecommerce feature env is unlocked. */
  requiresEcommerceFeature?: boolean;
}

@Component({
  selector: 'app-store-settings',
  templateUrl: './store-settings.component.html',
  styleUrls: ['./store-settings.component.scss'],
})
export class StoreSettingsComponent implements OnInit, OnDestroy {
  form: StoreSettings = {
    storeName: '',
    storePhoneNumber: '',
    logoUrl: '',
    receiptLanguage: 'en',
    purchaseTreasuryMethods: [],
    moneyAccounts: [],
    paymentMethodAccountMap: [],
    paymentMethodsCatalog: [],
    paymentAppFeePercents: [],
    returnExchangePolicy: '',
    showReturnExchangePolicyOnReceipt: false,
    bookingPolicy: '',
    showBookingPolicyOnReceipt: false,
    ecommerceIntegrationFeatureAvailable: false,
    ecommerceIntegrationEnabled: false,
    ecommerceBaseUrl: '',
    ecommerceSharedKey: '',
    ecommerceCatalogMode: 'all',
    onlineBranchId: null,
  };

  readonly receiptLanguageOptions: { value: ReceiptLanguageCode; labelKey: string }[] = [
    { value: 'ar', labelKey: 'tr_lang_ar' },
    { value: 'en', labelKey: 'tr_lang_en' },
    { value: 'de', labelKey: 'tr_lang_de' },
    { value: 'fr', labelKey: 'tr_lang_fr' },
  ];

  readonly allTabs: SettingsTab[] = [
    { id: 'general', labelKey: 'tr_settings_tab_general', icon: 'fa-store' },
    { id: 'payments', labelKey: 'tr_settings_tab_payments', icon: 'fa-credit-card' },
    { id: 'policies', labelKey: 'tr_settings_tab_policies', icon: 'fa-file-text-o' },
    {
      id: 'ecommerce',
      labelKey: 'tr_settings_tab_ecommerce',
      icon: 'fa-globe',
      requiresEcommerceFeature: true,
    },
  ];

  activeTab: SettingsTabId = 'general';
  logoPreview = '';
  saving = false;
  private settingsSub?: Subscription;

  constructor(
    private storeSettingsService: StoreSettingsService,
    private appNotificationService: AppNotificationService,
    private translate: TranslateService
  ) {}

  get visibleTabs(): SettingsTab[] {
    return this.allTabs.filter(
      (t) => !t.requiresEcommerceFeature || this.form.ecommerceIntegrationFeatureAvailable
    );
  }

  setTab(id: SettingsTabId): void {
    this.activeTab = id;
  }

  ngOnInit(): void {
    this.storeSettingsService.load();
    this.settingsSub = this.storeSettingsService.settings$.subscribe((v) => {
      this.form = {
        storeName: v.storeName,
        storePhoneNumber: v.storePhoneNumber,
        logoUrl: v.logoUrl,
        receiptLanguage: v.receiptLanguage || 'en',
        purchaseTreasuryMethods: v.purchaseTreasuryMethods || [],
        moneyAccounts: v.moneyAccounts || [],
        paymentMethodAccountMap: v.paymentMethodAccountMap || [],
        paymentMethodsCatalog: v.paymentMethodsCatalog || [],
        paymentAppFeePercents: v.paymentAppFeePercents || [],
        returnExchangePolicy: v.returnExchangePolicy || '',
        showReturnExchangePolicyOnReceipt: Boolean(v.showReturnExchangePolicyOnReceipt),
        bookingPolicy: v.bookingPolicy || '',
        showBookingPolicyOnReceipt: Boolean(v.showBookingPolicyOnReceipt),
        ecommerceIntegrationFeatureAvailable: Boolean(v.ecommerceIntegrationFeatureAvailable),
        ecommerceIntegrationEnabled: Boolean(v.ecommerceIntegrationEnabled),
        ecommerceBaseUrl: v.ecommerceBaseUrl || '',
        ecommerceSharedKey: v.ecommerceSharedKey || '',
        ecommerceCatalogMode: v.ecommerceCatalogMode === 'online_only' ? 'online_only' : 'all',
        onlineBranchId: v.onlineBranchId || null,
      };
      this.logoPreview = this.form.logoUrl || '';
      if (
        this.activeTab === 'ecommerce' &&
        !this.form.ecommerceIntegrationFeatureAvailable
      ) {
        this.activeTab = 'general';
      }
    });
  }

  ngOnDestroy(): void {
    this.settingsSub?.unsubscribe();
  }

  onLogoSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || !file.type.startsWith('image/')) {
      return;
    }
    if (file.size > 450000) {
      this.appNotificationService.push(
        this.translate.instant('tr_logo_too_large'),
        'warning'
      );
      input.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      this.form.logoUrl = result;
      this.logoPreview = result;
    };
    reader.readAsDataURL(file);
    input.value = '';
  }

  clearLogo(): void {
    this.form.logoUrl = '';
    this.logoPreview = '';
  }

  save(): void {
    this.saving = true;
    this.storeSettingsService
      .update({
        storeName: this.form.storeName?.trim() || '',
        storePhoneNumber: this.form.storePhoneNumber?.trim() || '',
        logoUrl: this.form.logoUrl || '',
        receiptLanguage: this.form.receiptLanguage || 'en',
        returnExchangePolicy: this.form.returnExchangePolicy?.trim() || '',
        showReturnExchangePolicyOnReceipt: Boolean(this.form.showReturnExchangePolicyOnReceipt),
        bookingPolicy: this.form.bookingPolicy?.trim() || '',
        showBookingPolicyOnReceipt: Boolean(this.form.showBookingPolicyOnReceipt),
        ecommerceIntegrationEnabled: Boolean(this.form.ecommerceIntegrationEnabled),
        ecommerceBaseUrl: this.form.ecommerceBaseUrl?.trim() || '',
        ecommerceSharedKey: this.form.ecommerceSharedKey?.trim() || '',
        ecommerceCatalogMode:
          this.form.ecommerceCatalogMode === 'online_only' ? 'online_only' : 'all',
      })
      .subscribe({
        next: () => {
          this.saving = false;
          this.appNotificationService.push(
            this.translate.instant('tr_settings_saved'),
            'success'
          );
        },
        error: () => {
          this.saving = false;
          this.appNotificationService.push(
            this.translate.instant('tr_unexpected_error_message'),
            'error'
          );
        },
      });
  }
}
