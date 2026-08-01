import { Component, OnInit, Optional } from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { StoreSettingsService } from '@shared/services/store-settings.service';
import {
  TreasuryUiRow,
  normalizeTreasuryRowsForSave,
  treasuryRowsFromSaved,
} from '../store-settings-dialog.util';

@Component({
  selector: 'app-purchase-treasury-dialog',
  templateUrl: './purchase-treasury-dialog.component.html',
  styleUrls: ['./purchase-treasury-dialog.component.scss'],
})
export class PurchaseTreasuryDialogComponent implements OnInit {
  treasuryRows: TreasuryUiRow[] = [{ key: 'cash', label: '' }];
  saving = false;

  constructor(
    @Optional() private dialogRef: MatDialogRef<PurchaseTreasuryDialogComponent>,
    private storeSettingsService: StoreSettingsService,
    private notify: AppNotificationService,
    private translate: TranslateService
  ) {}

  get isDialog(): boolean {
    return !!this.dialogRef;
  }

  ngOnInit(): void {
    const methods = this.storeSettingsService.snapshot.purchaseTreasuryMethods?.length
      ? this.storeSettingsService.snapshot.purchaseTreasuryMethods
      : [{ key: 'cash', label: 'Cash' }];
    this.treasuryRows = treasuryRowsFromSaved(
      methods,
      this.translate.instant('tr_treasury_cash')
    );
  }

  addRow(): void {
    this.treasuryRows.push({ key: '', label: '' });
  }

  removeRow(index: number): void {
    if (this.treasuryRows[index]?.key === 'cash') {
      return;
    }
    this.treasuryRows.splice(index, 1);
  }

  cancel(): void {
    this.dialogRef?.close(false);
  }

  save(): void {
    const purchaseTreasuryMethods = normalizeTreasuryRowsForSave(
      this.treasuryRows,
      this.translate.instant('tr_treasury_cash')
    );
    this.saving = true;
    this.storeSettingsService.update({ purchaseTreasuryMethods }).subscribe({
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
