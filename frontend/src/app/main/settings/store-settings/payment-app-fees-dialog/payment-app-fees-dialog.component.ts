import { Component, OnInit, Optional } from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { AppNotificationService } from '@shared/services/app-notification.service';
import {
  PaymentMethodCatalogRow,
  PaymentMethodEffectMode,
  PaymentMethodShowIn,
  StoreSettingsService,
} from '@shared/services/store-settings.service';
import { allocateSettingsSlugKey } from '../store-settings-dialog.util';

interface CatalogUiRow {
  key: string;
  label: string;
  showIn: PaymentMethodShowIn;
  effectMode: PaymentMethodEffectMode;
  feePercent: number;
  lockedKey: boolean;
}

@Component({
  selector: 'app-payment-app-fees-dialog',
  templateUrl: './payment-app-fees-dialog.component.html',
  styleUrls: ['./payment-app-fees-dialog.component.scss'],
})
export class PaymentAppFeesDialogComponent implements OnInit {
  rows: CatalogUiRow[] = [];
  saving = false;

  readonly showInOptions: { value: PaymentMethodShowIn; labelKey: string }[] = [
    { value: 'sale', labelKey: 'tr_pay_show_in_sale' },
    { value: 'purchase', labelKey: 'tr_pay_show_in_purchase' },
    { value: 'both', labelKey: 'tr_pay_show_in_both' },
  ];

  readonly effectOptions: { value: PaymentMethodEffectMode; labelKey: string }[] = [
    { value: 'instant', labelKey: 'tr_pay_effect_instant' },
    { value: 'settlement', labelKey: 'tr_pay_effect_settlement' },
    { value: 'none', labelKey: 'tr_pay_effect_none' },
  ];

  constructor(
    @Optional() private dialogRef: MatDialogRef<PaymentAppFeesDialogComponent>,
    private storeSettingsService: StoreSettingsService,
    private notify: AppNotificationService,
    private translate: TranslateService
  ) {}

  get isDialog(): boolean {
    return !!this.dialogRef;
  }

  ngOnInit(): void {
    const saved = this.storeSettingsService.snapshot.paymentMethodsCatalog || [];
    if (saved.length) {
      this.rows = saved.map((r) => this.toUiRow(r));
      return;
    }
    // Fallback migrate client-side if API older
    const fees = this.storeSettingsService.snapshot.paymentAppFeePercents || [];
    this.rows = [
      {
        key: 'cash',
        label: this.translate.instant('tr_pay_cash'),
        showIn: 'both',
        effectMode: 'instant',
        feePercent: 0,
        lockedKey: true,
      },
      {
        key: 'credit',
        label: this.translate.instant('tr_pay_credit'),
        showIn: 'both',
        effectMode: 'none',
        feePercent: 0,
        lockedKey: true,
      },
      ...fees.map((f) => ({
        key: f.method,
        label: f.label || f.method,
        showIn: 'sale' as PaymentMethodShowIn,
        effectMode: 'instant' as PaymentMethodEffectMode,
        feePercent: f.percent || 0,
        lockedKey: true,
      })),
    ];
  }

  private toUiRow(r: PaymentMethodCatalogRow): CatalogUiRow {
    const key = String(r.key || '').toLowerCase();
    return {
      key,
      label: r.label,
      showIn: r.showIn || 'sale',
      effectMode: key === 'credit' ? 'none' : key === 'cash' ? 'instant' : r.effectMode || 'instant',
      feePercent: key === 'cash' || key === 'credit' ? 0 : Number(r.feePercent) || 0,
      lockedKey: key === 'cash' || key === 'credit' || !!key,
    };
  }

  isFeeEditable(row: CatalogUiRow): boolean {
    return row.key !== 'cash' && row.key !== 'credit' && row.effectMode !== 'none';
  }

  onEffectChange(row: CatalogUiRow): void {
    if (row.key === 'credit') {
      row.effectMode = 'none';
      row.feePercent = 0;
      return;
    }
    if (row.key === 'cash') {
      row.effectMode = 'instant';
      row.feePercent = 0;
      return;
    }
    if (row.effectMode === 'none') {
      row.feePercent = 0;
    }
  }

  addRow(): void {
    this.rows.push({
      key: '',
      label: '',
      showIn: 'sale',
      effectMode: 'instant',
      feePercent: 0,
      lockedKey: false,
    });
  }

  removeRow(index: number): void {
    const row = this.rows[index];
    if (row?.key === 'cash' || row?.key === 'credit') return;
    this.rows.splice(index, 1);
  }

  cancel(): void {
    this.dialogRef?.close(false);
  }

  save(): void {
    const used = new Set<string>();
    const paymentMethodsCatalog: PaymentMethodCatalogRow[] = [];

    for (const r of this.rows) {
      const label = String(r.label || '').trim().slice(0, 120);
      if (!label) continue;
      let key = String(r.key || '')
        .trim()
        .toLowerCase();
      if (!key || !/^[a-z][a-z0-9_]{0,39}$/.test(key)) {
        key = allocateSettingsSlugKey(label, used);
      } else if (used.has(key)) {
        key = allocateSettingsSlugKey(`${label}_${key}`, used);
      } else {
        used.add(key);
      }

      let effectMode: PaymentMethodEffectMode = r.effectMode || 'instant';
      if (key === 'credit') effectMode = 'none';
      if (key === 'cash') effectMode = 'instant';

      paymentMethodsCatalog.push({
        key,
        label,
        showIn: r.showIn || 'sale',
        effectMode,
        feePercent:
          key === 'cash' || key === 'credit' || effectMode === 'none'
            ? 0
            : Math.max(0, Math.min(100, Number(r.feePercent) || 0)),
      });
    }

    if (!paymentMethodsCatalog.some((x) => x.key === 'cash')) {
      this.notify.push(this.translate.instant('tr_unexpected_error_message'), 'error');
      return;
    }

    this.saving = true;
    this.storeSettingsService.update({ paymentMethodsCatalog }).subscribe({
      next: () => {
        this.saving = false;
        this.notify.push(this.translate.instant('tr_settings_saved'), 'success');
        this.dialogRef?.close(true);
      },
      error: () => {
        this.saving = false;
        this.notify.push(this.translate.instant('tr_unexpected_error_message'), 'error');
      },
    });
  }
}
