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
  settlementAccounts: MoneyAccount[] = [];
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
    this.settlementAccounts = all.filter((a) => a.kind === 'settlement');

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
          m.key === 'cash'
            ? 'cash'
            : prev?.accountKey ||
              (mode === 'settlement' && this.settlementAccounts.some((a) => a.key === m.key)
                ? m.key
                : ''),
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

  accountsForRow(row: MapUiRow): MoneyAccount[] {
    return row.mode === 'settlement' ? this.settlementAccounts : this.accounts;
  }

  onModeChange(row: MapUiRow): void {
    if (row.method === 'cash') {
      row.mode = 'instant';
      row.settlementBankAccountKey = '';
      return;
    }
    if (row.mode === 'settlement') {
      if (!this.settlementAccounts.some((a) => a.key === row.accountKey)) {
        row.accountKey = '';
      }
      if (!row.settlementBankAccountKey) {
        row.settlementBankAccountKey =
          this.bankAccounts.find((a) => a.key === 'bank_misr')?.key ||
          this.bankAccounts[0]?.key ||
          '';
      }
      return;
    }
    if (!this.accounts.some((a) => a.key === row.accountKey)) {
      row.accountKey = '';
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
        accountKey: r.method === 'cash' ? 'cash' : r.accountKey,
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
