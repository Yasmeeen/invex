import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import {
  ReceiptLanguageCode,
  StoreSettings,
  StoreSettingsService,
} from '@shared/services/store-settings.service';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { TranslateService } from '@ngx-translate/core';

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
  };

  readonly receiptLanguageOptions: { value: ReceiptLanguageCode; labelKey: string }[] = [
    { value: 'ar', labelKey: 'tr_lang_ar' },
    { value: 'en', labelKey: 'tr_lang_en' },
    { value: 'de', labelKey: 'tr_lang_de' },
    { value: 'fr', labelKey: 'tr_lang_fr' },
  ];

  logoPreview = '';
  saving = false;
  private settingsSub?: Subscription;

  constructor(
    private storeSettingsService: StoreSettingsService,
    private appNotificationService: AppNotificationService,
    private translate: TranslateService
  ) {}

  ngOnInit(): void {
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
      };
      this.logoPreview = this.form.logoUrl || '';
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
