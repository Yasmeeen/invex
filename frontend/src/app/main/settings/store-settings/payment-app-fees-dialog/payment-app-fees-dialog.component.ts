import { Component, OnInit } from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { PAYMENT_METHOD_OPTIONS } from '@shared/constants/payment-method-options';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { StoreSettingsService } from '@shared/services/store-settings.service';
import {
  PaymentFeeUiRow,
  normalizePaymentFeeRowsForSave,
  paymentFeeRowsFromSaved,
} from '../store-settings-dialog.util';

@Component({
  selector: 'app-payment-app-fees-dialog',
  templateUrl: './payment-app-fees-dialog.component.html',
  styleUrls: ['./payment-app-fees-dialog.component.scss'],
})
export class PaymentAppFeesDialogComponent implements OnInit {
  feeRows: PaymentFeeUiRow[] = [];
  saving = false;

  constructor(
    private dialogRef: MatDialogRef<PaymentAppFeesDialogComponent>,
    private storeSettingsService: StoreSettingsService,
    private notify: AppNotificationService,
    private translate: TranslateService
  ) {}

  ngOnInit(): void {
    this.feeRows = paymentFeeRowsFromSaved(
      this.storeSettingsService.snapshot.paymentAppFeePercents || [],
      (method) => this.defaultLabelForPaymentMethod(method)
    );
  }

  private defaultLabelForPaymentMethod(method: string): string {
    const id = String(method || '').trim().toLowerCase();
    const opt = PAYMENT_METHOD_OPTIONS.find((p) => p.id === id);
    if (opt?.labelKey) {
      return this.translate.instant(opt.labelKey);
    }
    return id.replace(/_/g, ' ');
  }

  addRow(): void {
    this.feeRows.push({ key: '', label: '', percent: 0 });
  }

  removeRow(index: number): void {
    this.feeRows.splice(index, 1);
  }

  cancel(): void {
    this.dialogRef.close(false);
  }

  save(): void {
    const paymentAppFeePercents = normalizePaymentFeeRowsForSave(this.feeRows);
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
