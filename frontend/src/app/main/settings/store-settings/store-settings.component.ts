import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import {
  PurchaseTreasuryMethod,
  ReceiptLanguageCode,
  StoreSettings,
  StoreSettingsService,
} from '@shared/services/store-settings.service';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { TranslateService } from '@ngx-translate/core';
import { MatDialog } from '@angular/material/dialog';
import { PaymentAppFeesDialogComponent } from './payment-app-fees-dialog/payment-app-fees-dialog.component';

/** Editable row: user sees `label` only; `key` kept internally (server or generated on save). */
export interface TreasuryUiRow {
  key: string;
  label: string;
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
    paymentAppFeePercents: [],
  };

  readonly receiptLanguageOptions: { value: ReceiptLanguageCode; labelKey: string }[] = [
    { value: 'ar', labelKey: 'tr_lang_ar' },
    { value: 'en', labelKey: 'tr_lang_en' },
    { value: 'de', labelKey: 'tr_lang_de' },
    { value: 'fr', labelKey: 'tr_lang_fr' },
  ];

  /** Purchase treasury: same list UX as before — one visible column (`label`). */
  purchaseTreasuryRows: TreasuryUiRow[] = [{ key: 'cash', label: '' }];

  /** معاينة شعار المتجر فقط — بدون لوجو ثابت من assets */
  logoPreview = '';
  saving = false;
  private settingsSub?: Subscription;

  constructor(
    private storeSettingsService: StoreSettingsService,
    private appNotificationService: AppNotificationService,
    private translate: TranslateService,
    private dialog: MatDialog
  ) {}

  ngOnInit(): void {
    // Settings are loaded from MainComponent.load(); avoid a second GET here — it can race with Save
    // and an older GET response would overwrite receiptLanguage back to the previous value.
    this.settingsSub = this.storeSettingsService.settings$.subscribe((v) => {
      this.form = {
        storeName: v.storeName,
        storePhoneNumber: v.storePhoneNumber,
        logoUrl: v.logoUrl,
        receiptLanguage: v.receiptLanguage || 'en',
        purchaseTreasuryMethods: v.purchaseTreasuryMethods || [],
        paymentAppFeePercents: v.paymentAppFeePercents || [],
      };
      this.logoPreview = this.form.logoUrl || '';
      const methods =
        v.purchaseTreasuryMethods?.length ? v.purchaseTreasuryMethods : [{ key: 'cash', label: 'Cash' }];
      this.syncTreasuryUiFromSaved(methods);
    });
  }

  private syncTreasuryUiFromSaved(methods: PurchaseTreasuryMethod[]): void {
    const rows: TreasuryUiRow[] = [];
    const cash = methods.find((m) => String(m?.key ?? '').trim().toLowerCase() === 'cash');
    const others = methods.filter((m) => String(m?.key ?? '').trim().toLowerCase() !== 'cash');

    const cashLabel =
      String(cash?.label ?? '').trim() || this.translate.instant('tr_treasury_cash');
    rows.push({ key: 'cash', label: cashLabel.slice(0, 120) });

    for (const m of others) {
      const key = String(m.key ?? '')
        .trim()
        .toLowerCase();
      const label = String(m.label ?? '').trim();
      if (!key) {
        continue;
      }
      rows.push({ key, label: label.slice(0, 120) });
    }
    this.purchaseTreasuryRows = rows;
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

  openPaymentAppFeesDialog(): void {
    this.dialog.open(PaymentAppFeesDialogComponent, {
      width: '520px',
      maxWidth: '96vw',
      panelClass: 'payment-app-fees-dialog-panel',
      backdropClass: 'payment-app-fees-dialog-backdrop',
      disableClose: false,
    });
  }

  addPurchaseTreasuryRow(): void {
    this.purchaseTreasuryRows.push({ key: '', label: '' });
  }

  removePurchaseTreasuryRow(index: number): void {
    const row = this.purchaseTreasuryRows[index];
    if (row?.key === 'cash') {
      return;
    }
    this.purchaseTreasuryRows.splice(index, 1);
  }

  /** ASCII-ish slug from label (Arabic-only labels → empty → hash fallback). */
  private latinSlug(label: string): string {
    const stripped = label
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/_+/g, '_');
    return stripped.slice(0, 32);
  }

  private hashTreasuryKey(label: string): string {
    let h = 2166136261;
    for (let i = 0; i < label.length; i++) {
      h ^= label.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const hex = (h >>> 0).toString(16).padStart(8, '0').slice(0, 10);
    return `tr_${hex}`;
  }

  private allocateTreasuryKey(label: string, used: Set<string>): string {
    const keyRe = /^[a-z][a-z0-9_]{0,39}$/;
    let base = this.latinSlug(label);
    if (!base.length || !keyRe.test(base)) {
      base = this.hashTreasuryKey(label);
    }
    if (!/^[a-z]/.test(base)) {
      base = `t_${base}`;
    }
    base = base.replace(/[^a-z0-9_]/g, '').slice(0, 36);
    if (!base.length) {
      base = this.hashTreasuryKey(label);
    }

    let cand = base;
    let n = 0;
    while (used.has(cand) || !keyRe.test(cand)) {
      n += 1;
      cand = `${base}_${n}`.slice(0, 40);
      if (n > 800) {
        cand = this.hashTreasuryKey(`${label}_${Date.now()}_${n}`).slice(0, 40);
      }
    }
    used.add(cand);
    return cand;
  }

  private normalizeTreasuryForSave(): PurchaseTreasuryMethod[] {
    const keyRe = /^[a-z][a-z0-9_]{0,39}$/;
    const used = new Set<string>();
    const out: PurchaseTreasuryMethod[] = [];

    for (const r of this.purchaseTreasuryRows) {
      const rawLabel = String(r.label ?? '').trim().slice(0, 120);
      let key = String(r.key ?? '')
        .trim()
        .toLowerCase();

      if (key === 'cash') {
        const label = rawLabel || this.translate.instant('tr_treasury_cash').slice(0, 120);
        if (!used.has('cash')) {
          used.add('cash');
          out.push({ key: 'cash', label });
        }
        continue;
      }

      if (!rawLabel) {
        continue;
      }

      if (!key || !keyRe.test(key)) {
        key = this.allocateTreasuryKey(rawLabel, used);
      } else if (used.has(key)) {
        key = this.allocateTreasuryKey(`${rawLabel}_${key}`, used);
      } else {
        used.add(key);
      }

      out.push({ key, label: rawLabel });
    }

    if (!out.some((x) => x.key === 'cash')) {
      out.unshift({
        key: 'cash',
        label: this.translate.instant('tr_treasury_cash').slice(0, 120),
      });
    }
    return out;
  }

  save(): void {
    this.saving = true;
    const treasury = this.normalizeTreasuryForSave();
    this.storeSettingsService
      .update({
        storeName: this.form.storeName?.trim() || '',
        storePhoneNumber: this.form.storePhoneNumber?.trim() || '',
        logoUrl: this.form.logoUrl || '',
        receiptLanguage: this.form.receiptLanguage || 'en',
        purchaseTreasuryMethods: treasury,
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
