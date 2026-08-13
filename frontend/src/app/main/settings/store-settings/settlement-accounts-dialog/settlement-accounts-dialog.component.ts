import { Component, OnInit, Optional } from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { MoneyAccount, StoreSettingsService } from '@shared/services/store-settings.service';

@Component({
  selector: 'app-settlement-accounts-dialog',
  templateUrl: './settlement-accounts-dialog.component.html',
  styleUrls: ['./settlement-accounts-dialog.component.scss'],
})
export class SettlementAccountsDialogComponent implements OnInit {
  rows: { key: string; label: string }[] = [];
  saving = false;

  constructor(
    @Optional() private dialogRef: MatDialogRef<SettlementAccountsDialogComponent>,
    private storeSettingsService: StoreSettingsService,
    private notify: AppNotificationService,
    private translate: TranslateService
  ) {}

  get isDialog(): boolean {
    return !!this.dialogRef;
  }

  ngOnInit(): void {
    const all = this.storeSettingsService.snapshot.moneyAccounts || [];
    this.rows = all
      .filter((a) => a.kind === 'settlement')
      .map((a) => ({ key: a.key, label: a.label }));
    if (!this.rows.length) {
      this.rows = [{ key: '', label: '' }];
    }
  }

  addRow(): void {
    this.rows.push({ key: '', label: '' });
  }

  removeRow(i: number): void {
    this.rows.splice(i, 1);
  }

  cancel(): void {
    this.dialogRef?.close(false);
  }

  save(): void {
    const snap = this.storeSettingsService.snapshot;
    const base: MoneyAccount[] = (snap.moneyAccounts || []).filter(
      (a) => a.kind !== 'settlement'
    );
    const treasuries = snap.purchaseTreasuryMethods || [];
    for (const t of treasuries) {
      if (!base.some((a) => a.key === t.key)) {
        base.push({
          key: t.key,
          label: t.label,
          kind: t.key === 'cash' ? 'cash' : 'treasury',
        });
      }
    }

    const keyRe = /^[a-z][a-z0-9_]{0,39}$/;
    const seen = new Set(base.map((a) => a.key));
    for (const row of this.rows) {
      const key = String(row.key || '')
        .trim()
        .toLowerCase();
      const label = String(row.label || '').trim();
      if (!key || !label || !keyRe.test(key) || seen.has(key)) continue;
      seen.add(key);
      base.push({ key, label, kind: 'settlement' });
    }

    this.saving = true;
    this.storeSettingsService.update({ moneyAccounts: base }).subscribe({
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
