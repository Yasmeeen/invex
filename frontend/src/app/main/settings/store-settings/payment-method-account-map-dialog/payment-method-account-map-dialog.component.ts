import { Component, OnInit, Optional } from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { AppNotificationService } from '@shared/services/app-notification.service';
import {
  MoneyAccount,
  PaymentMethodAccountMapRow,
  PaymentMethodCatalogRow,
  PaymentMethodMapMode,
  StoreSettingsService,
} from '@shared/services/store-settings.service';

interface MapUiRow {
  method: string;
  label: string;
  accountKey: string;
  mode: PaymentMethodMapMode;
  settlementBankAccountKey: string;
  effectMode: string;
}

@Component({
  selector: 'app-payment-method-account-map-dialog',
  templateUrl: './payment-method-account-map-dialog.component.html',
  styleUrls: ['./payment-method-account-map-dialog.component.scss'],
})
export class PaymentMethodAccountMapDialogComponent implements OnInit {
  rows: MapUiRow[] = [];
  accounts: MoneyAccount[] = [];
  bankAccounts: MoneyAccount[] = [];
  saving = false;

  constructor(
    @Optional() private dialogRef: MatDialogRef<PaymentMethodAccountMapDialogComponent>,
    private storeSettingsService: StoreSettingsService,
    private notify: AppNotificationService,
    private translate: TranslateService
  ) {}

  get isDialog(): boolean {
    return !!this.dialogRef;
  }

  ngOnInit(): void {
    const all: MoneyAccount[] = this.storeSettingsService.snapshot.moneyAccounts?.length
      ? [...this.storeSettingsService.snapshot.moneyAccounts]
      : [{ key: 'cash', label: 'Cash', kind: 'cash' }];
    this.accounts = all.filter((a) => a.kind === 'cash' || a.kind === 'treasury');
    this.bankAccounts = this.accounts.filter((a) => a.kind === 'treasury' || a.kind === 'cash');

    const saved = this.storeSettingsService.snapshot.paymentMethodAccountMap || [];
    const savedMap = new Map(saved.map((r) => [r.method, r]));

    const catalog = (this.storeSettingsService.snapshot.paymentMethodsCatalog || []).filter(
      (m) => m.key !== 'mixed' && m.key !== 'credit' && m.effectMode !== 'none'
    );

    const methods: PaymentMethodCatalogRow[] = catalog.length
      ? catalog
      : [{ key: 'cash', label: 'Cash', showIn: 'both', effectMode: 'instant', feePercent: 0 }];

    this.rows = methods.map((m) => {
      const prev = savedMap.get(m.key);
      const defaultMode: PaymentMethodMapMode =
        m.effectMode === 'settlement' || prev?.mode === 'settlement' ? 'settlement' : 'instant';
      const mode: PaymentMethodMapMode = m.key === 'cash' ? 'instant' : defaultMode;
      return {
        method: m.key,
        label: m.label || m.key,
        accountKey:
          mode === 'settlement' || m.key === 'cash'
            ? m.key === 'cash'
              ? 'cash'
              : m.key
            : prev?.accountKey || '',
        mode,
        settlementBankAccountKey:
          mode === 'settlement'
            ? prev?.settlementBankAccountKey ||
              (this.bankAccounts.find((a) => a.key === 'bank_misr')?.key || '')
            : '',
        effectMode: m.effectMode,
      };
    });
  }

  onModeChange(row: MapUiRow): void {
    if (row.method === 'cash') {
      row.mode = 'instant';
      row.settlementBankAccountKey = '';
      return;
    }
    if (row.mode === 'settlement') {
      row.accountKey = row.method;
      if (!row.settlementBankAccountKey) {
        row.settlementBankAccountKey =
          this.bankAccounts.find((a) => a.key === 'bank_misr')?.key ||
          this.bankAccounts[0]?.key ||
          '';
      }
      return;
    }
    row.settlementBankAccountKey = '';
  }

  cancel(): void {
    this.dialogRef?.close(false);
  }

  save(): void {
    const paymentMethodAccountMap: PaymentMethodAccountMapRow[] = this.rows
      .filter((r) => r.accountKey)
      .map((r) => ({
        method: r.method,
        accountKey: r.method === 'cash' || r.mode === 'settlement' ? r.method : r.accountKey,
        mode: r.method === 'cash' ? 'instant' : r.mode,
        settlementBankAccountKey:
          r.mode === 'settlement' ? r.settlementBankAccountKey || '' : '',
      }));
    this.saving = true;
    this.storeSettingsService.update({ paymentMethodAccountMap }).subscribe({
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
