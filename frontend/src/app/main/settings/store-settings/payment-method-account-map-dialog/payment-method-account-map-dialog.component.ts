import { Component, OnInit, Optional } from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { PAYMENT_METHOD_OPTIONS } from '@shared/constants/payment-method-options';
import { AppNotificationService } from '@shared/services/app-notification.service';
import {
  MoneyAccount,
  PaymentMethodAccountMapRow,
  StoreSettingsService,
} from '@shared/services/store-settings.service';

interface MapUiRow {
  method: string;
  label: string;
  accountKey: string;
}

@Component({
  selector: 'app-payment-method-account-map-dialog',
  templateUrl: './payment-method-account-map-dialog.component.html',
  styleUrls: ['./payment-method-account-map-dialog.component.scss'],
})
export class PaymentMethodAccountMapDialogComponent implements OnInit {
  rows: MapUiRow[] = [];
  accounts: MoneyAccount[] = [];
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
    this.accounts = this.storeSettingsService.snapshot.moneyAccounts?.length
      ? [...this.storeSettingsService.snapshot.moneyAccounts]
      : [{ key: 'cash', label: 'Cash', kind: 'cash' }];

    const saved = this.storeSettingsService.snapshot.paymentMethodAccountMap || [];
    const savedMap = new Map(saved.map((r) => [r.method, r.accountKey]));

    const methods = PAYMENT_METHOD_OPTIONS.filter(
      (m) => m.id !== 'mixed' && m.id !== 'credit'
    );

    this.rows = methods.map((m) => ({
      method: m.id,
      label: this.translate.instant(m.labelKey),
      accountKey: savedMap.get(m.id) || (m.id === 'cash' ? 'cash' : ''),
    }));
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
