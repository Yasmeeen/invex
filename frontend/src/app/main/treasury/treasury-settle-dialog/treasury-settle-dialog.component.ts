import { Component, Inject, OnDestroy, OnInit } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Globals } from '@core/globals';
import { TranslateService } from '@ngx-translate/core';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { StoreSettingsService } from '@shared/services/store-settings.service';
import { TreasuryAccountsService } from '@shared/services/treasury-accounts.service';
import { Subscription } from 'rxjs';

export interface TreasurySettleDialogData {
  methodKey: string;
  label?: string;
  settlementBankAccountKey?: string;
  settlementBankLabel?: string;
}

@Component({
  selector: 'app-treasury-settle-dialog',
  templateUrl: './treasury-settle-dialog.component.html',
  styleUrls: ['./treasury-settle-dialog.component.scss'],
})
export class TreasurySettleDialogComponent implements OnInit, OnDestroy {
  methodKey = '';
  methodLabel = '';
  bankKey = '';
  bankLabel = '';
  amount: number | null = null;
  note = '';
  pendingBalance: number | null = null;
  saving = false;
  loading = false;

  private subscriptions: Subscription[] = [];

  constructor(
    private dialogRef: MatDialogRef<TreasurySettleDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public data: TreasurySettleDialogData,
    private treasury: TreasuryAccountsService,
    private storeSettings: StoreSettingsService,
    private notify: AppNotificationService,
    private translate: TranslateService,
    private globals: Globals
  ) {}

  get fromHasNoBalance(): boolean {
    return this.pendingBalance != null && Math.round(this.pendingBalance * 100) <= 0;
  }

  get amountExceedsBalance(): boolean {
    const amt = Number(this.amount);
    if (this.pendingBalance == null || !Number.isFinite(amt) || amt <= 0) return false;
    return Math.round(amt * 100) > Math.round(this.pendingBalance * 100);
  }

  get cannotSubmit(): boolean {
    return (
      this.saving ||
      this.loading ||
      !this.bankKey ||
      this.fromHasNoBalance ||
      this.amountExceedsBalance
    );
  }

  get pendingBalanceLabel(): string {
    const n = Number(this.pendingBalance);
    if (!Number.isFinite(n)) return '0.00';
    return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  ngOnInit(): void {
    this.methodKey = String(this.data?.methodKey || '')
      .trim()
      .toLowerCase();
    this.methodLabel = String(this.data?.label || this.methodKey).trim() || this.methodKey;
    this.bankKey = String(this.data?.settlementBankAccountKey || '')
      .trim()
      .toLowerCase();
    this.bankLabel = String(this.data?.settlementBankLabel || '').trim();

    this.storeSettings.load();
    this.subscriptions.push(this.storeSettings.settings$.subscribe(() => this.resolveBank()));
    this.loadBalance();
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach((s) => s.unsubscribe());
  }

  submit(): void {
    const uid = this.globals.currentUser?._id;
    const amt = Number(this.amount);
    if (!uid || !this.methodKey) return;
    if (!this.bankKey) {
      this.notify.push(this.translate.instant('tr_payment_settle_need_bank'), 'error');
      return;
    }
    if (!Number.isFinite(amt) || amt <= 0) {
      this.notify.push(this.translate.instant('tr_treasury_amount_invalid'), 'error');
      return;
    }
    if (this.fromHasNoBalance) {
      this.notify.push(this.translate.instant('tr_treasury_transfer_no_balance'), 'error');
      return;
    }
    if (this.amountExceedsBalance) {
      this.notify.push(
        this.translate.instant('tr_treasury_transfer_insufficient', {
          amount: this.pendingBalanceLabel,
        }),
        'error'
      );
      return;
    }

    this.saving = true;
    this.subscriptions.push(
      this.treasury
        .settleAccount(this.methodKey, {
          userId: uid,
          amount: amt,
          note: this.note,
        })
        .subscribe({
          next: () => {
            this.saving = false;
            this.notify.push(this.translate.instant('tr_treasury_transfer_success'), 'success');
            this.dialogRef.close(true);
          },
          error: (err) => {
            this.saving = false;
            const code = String(err?.error?.error || '');
            if (code === 'INSUFFICIENT_FUNDS') {
              this.notify.push(this.translate.instant('tr_treasury_transfer_no_balance'), 'error');
              return;
            }
            if (code === 'AMOUNT_EXCEEDS_BALANCE') {
              const available = Number(err?.error?.available);
              this.notify.push(
                this.translate.instant('tr_treasury_transfer_insufficient', {
                  amount: this.formatMoney(
                    Number.isFinite(available) ? available : this.pendingBalance
                  ),
                }),
                'error'
              );
              return;
            }
            this.notify.push(code || this.translate.instant('tr_unexpected_error_message'), 'error');
          },
        })
    );
  }

  cancel(): void {
    this.dialogRef.close(false);
  }

  private resolveBank(): void {
    const map = this.storeSettings.snapshot.paymentMethodAccountMap || [];
    const row = map.find(
      (r) =>
        (r.method === this.methodKey || r.accountKey === this.methodKey) &&
        r.mode === 'settlement' &&
        r.settlementBankAccountKey
    );
    const key = String(
      this.data?.settlementBankAccountKey || row?.settlementBankAccountKey || this.bankKey || ''
    )
      .trim()
      .toLowerCase();
    this.bankKey = key;
    if (this.data?.settlementBankLabel) {
      this.bankLabel = this.data.settlementBankLabel;
      return;
    }
    if (!key) {
      this.bankLabel = this.translate.instant('tr_payment_settlement_bank_none');
      return;
    }
    const acc = (this.storeSettings.snapshot.moneyAccounts || []).find((a) => a.key === key);
    this.bankLabel = acc?.label || key;
  }

  private loadBalance(): void {
    const uid = this.globals.currentUser?._id;
    if (!uid || !this.methodKey) {
      this.pendingBalance = null;
      return;
    }
    this.loading = true;
    this.subscriptions.push(
      this.treasury.getAccount({ key: this.methodKey, userId: uid }).subscribe({
        next: (res) => {
          this.pendingBalance = Number(res?.expectedBalance);
          if (!Number.isFinite(this.pendingBalance)) this.pendingBalance = 0;
          if (!this.methodLabel) this.methodLabel = res?.account?.label || this.methodKey;
          this.loading = false;
        },
        error: () => {
          this.pendingBalance = null;
          this.loading = false;
        },
      })
    );
  }

  private formatMoney(value: number | null | undefined): string {
    const n = Number(value);
    if (!Number.isFinite(n)) return '0.00';
    return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
}
