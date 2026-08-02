import { Component, OnInit, Optional } from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { AppNotificationService } from '@shared/services/app-notification.service';
import {
  MoneyAccount,
  MoneyAccountChannel,
  StoreSettingsService,
} from '@shared/services/store-settings.service';
import { allocateSettingsSlugKey } from '../store-settings-dialog.util';

interface AccountUiRow {
  key: string;
  label: string;
  channel: MoneyAccountChannel | '';
  accountNumber: string;
  phone: string;
}

@Component({
  selector: 'app-purchase-treasury-dialog',
  templateUrl: './purchase-treasury-dialog.component.html',
  styleUrls: ['./purchase-treasury-dialog.component.scss'],
})
export class PurchaseTreasuryDialogComponent implements OnInit {
  treasuryRows: AccountUiRow[] = [];
  saving = false;

  readonly channelOptions: { value: MoneyAccountChannel; labelKey: string }[] = [
    { value: 'bank', labelKey: 'tr_money_account_channel_bank' },
    { value: 'wallet', labelKey: 'tr_money_account_channel_wallet' },
  ];

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
    const money = this.storeSettingsService.snapshot.moneyAccounts || [];
    const editable = money.filter((a) => a.kind === 'cash' || a.kind === 'treasury');
    if (editable.length) {
      this.treasuryRows = editable.map((a) => this.toUiRow(a));
      return;
    }
    const methods = this.storeSettingsService.snapshot.purchaseTreasuryMethods?.length
      ? this.storeSettingsService.snapshot.purchaseTreasuryMethods
      : [{ key: 'cash', label: this.translate.instant('tr_treasury_cash') }];
    this.treasuryRows = methods.map((m) =>
      this.toUiRow({
        key: m.key,
        label: m.label,
        kind: m.key === 'cash' ? 'cash' : 'treasury',
        channel: m.key === 'cash' ? '' : this.guessChannel(m.key),
        accountNumber: '',
        phone: '',
      })
    );
  }

  private guessChannel(key: string): MoneyAccountChannel {
    const k = String(key || '').toLowerCase();
    if (
      k.includes('vodafone') ||
      k.includes('etisalat') ||
      k.includes('orange') ||
      k.includes('wallet') ||
      k.includes('_cash') ||
      (k.endsWith('cash') && k !== 'cash')
    ) {
      return 'wallet';
    }
    return 'bank';
  }

  private toUiRow(a: MoneyAccount): AccountUiRow {
    const key = String(a.key || '').toLowerCase();
    let channel: MoneyAccountChannel | '' =
      a.channel === 'bank' || a.channel === 'wallet' ? a.channel : '';
    if (key !== 'cash' && !channel) {
      channel = this.guessChannel(key);
    }
    if (key === 'cash') channel = '';
    return {
      key,
      label: a.label || '',
      channel,
      accountNumber: a.accountNumber || '',
      phone: a.phone || '',
    };
  }

  addRow(): void {
    this.treasuryRows.push({
      key: '',
      label: '',
      channel: 'bank',
      accountNumber: '',
      phone: '',
    });
  }

  removeRow(index: number): void {
    if (this.treasuryRows[index]?.key === 'cash') {
      return;
    }
    this.treasuryRows.splice(index, 1);
  }

  onChannelChange(row: AccountUiRow): void {
    if (row.key === 'cash') {
      row.channel = '';
      row.accountNumber = '';
      row.phone = '';
      return;
    }
    if (row.channel === 'bank') {
      row.phone = '';
    } else if (row.channel === 'wallet') {
      row.accountNumber = '';
    }
  }

  cancel(): void {
    this.dialogRef?.close(false);
  }

  save(): void {
    const used = new Set<string>();
    const cashTreasury: MoneyAccount[] = [];
    const cashLabelFallback = this.translate.instant('tr_treasury_cash');

    for (const r of this.treasuryRows) {
      const label = String(r.label || '').trim().slice(0, 120);
      let key = String(r.key || '')
        .trim()
        .toLowerCase();

      if (key === 'cash') {
        if (!used.has('cash')) {
          used.add('cash');
          cashTreasury.push({
            key: 'cash',
            label: label || cashLabelFallback,
            kind: 'cash',
            channel: '',
            accountNumber: '',
            phone: '',
          });
        }
        continue;
      }

      if (!label) continue;

      if (!key || !/^[a-z][a-z0-9_]{0,39}$/.test(key)) {
        key = allocateSettingsSlugKey(label, used);
      } else if (used.has(key)) {
        key = allocateSettingsSlugKey(`${label}_${key}`, used);
      } else {
        used.add(key);
      }

      const channel: MoneyAccountChannel =
        r.channel === 'wallet' || r.channel === 'bank' ? r.channel : 'bank';

      cashTreasury.push({
        key,
        label,
        kind: 'treasury',
        channel,
        accountNumber: channel === 'bank' ? String(r.accountNumber || '').trim().slice(0, 80) : '',
        phone: channel === 'wallet' ? String(r.phone || '').trim().slice(0, 40) : '',
      });
    }

    if (!cashTreasury.some((x) => x.key === 'cash')) {
      cashTreasury.unshift({
        key: 'cash',
        label: cashLabelFallback,
        kind: 'cash',
        channel: '',
        accountNumber: '',
        phone: '',
      });
    }

    const existing = this.storeSettingsService.snapshot.moneyAccounts || [];
    const settlement = existing.filter((a) => a.kind === 'settlement');
    const moneyAccounts: MoneyAccount[] = [...cashTreasury, ...settlement];

    this.saving = true;
    this.storeSettingsService.update({ moneyAccounts }).subscribe({
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
