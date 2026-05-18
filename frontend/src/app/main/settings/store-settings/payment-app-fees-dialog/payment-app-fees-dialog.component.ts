import { Component, OnInit } from '@angular/core';
import { MatLegacyDialogRef as MatDialogRef } from '@angular/material/legacy-dialog';
import { TranslateService } from '@ngx-translate/core';
import { PAYMENT_APP_FEE_METHOD_IDS } from '@shared/constants/payment-app-fee-methods';
import { PAYMENT_METHOD_OPTIONS } from '@shared/constants/payment-method-options';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { PaymentAppFeePercent, StoreSettingsService } from '@shared/services/store-settings.service';

@Component({
    selector: 'app-payment-app-fees-dialog',
    templateUrl: './payment-app-fees-dialog.component.html',
    styleUrls: ['./payment-app-fees-dialog.component.scss'],
    standalone: false
})
export class PaymentAppFeesDialogComponent implements OnInit {
  readonly rows = PAYMENT_APP_FEE_METHOD_IDS.map((id) => ({
    id,
    labelKey: PAYMENT_METHOD_OPTIONS.find((p) => p.id === id)?.labelKey ?? `tr_pay_${id}`,
  }));

  percents: Record<string, number> = {};
  saving = false;

  constructor(
    private dialogRef: MatDialogRef<PaymentAppFeesDialogComponent>,
    private storeSettingsService: StoreSettingsService,
    private notify: AppNotificationService,
    private translate: TranslateService
  ) {}

  ngOnInit(): void {
    const map = new Map(
      (this.storeSettingsService.snapshot.paymentAppFeePercents || []).map((x: PaymentAppFeePercent) => [
        x.method,
        x.percent,
      ])
    );
    for (const r of this.rows) {
      const v = map.get(r.id);
      this.percents[r.id] = Number.isFinite(Number(v)) ? Number(v) : 0;
    }
  }

  cancel(): void {
    this.dialogRef.close(false);
  }

  save(): void {
    const paymentAppFeePercents = PAYMENT_APP_FEE_METHOD_IDS.map((method) => ({
      method,
      percent: Math.max(
        0,
        Math.min(100, Math.round((Number(this.percents[method]) || 0) * 100) / 100)
      ),
    }));
    this.saving = true;
    this.storeSettingsService.update({ paymentAppFeePercents }).subscribe({
      next: () => {
        this.saving = false;
        this.notify.push(this.translate.instant('tr_settings_saved'), 'success');
        this.dialogRef.close(true);
      },
      error: () => {
        this.saving = false;
        this.notify.push(this.translate.instant('tr_unexpected_error_message'), 'error');
      },
    });
  }
}
