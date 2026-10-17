import { Component, Inject, OnDestroy, OnInit } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Globals } from '@core/globals';
import { TranslateService } from '@ngx-translate/core';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { TreasuryAccountsService } from '@shared/services/treasury-accounts.service';
import { Subscription } from 'rxjs';

export interface TreasuryWithdrawBranchOption {
  _id: string;
  name?: string;
}

export interface TreasuryWithdrawDialogData {
  branchId?: string;
  branches?: TreasuryWithdrawBranchOption[];
  accountKey: string;
  label?: string;
}

@Component({
  selector: 'app-treasury-withdraw-dialog',
  templateUrl: './treasury-withdraw-dialog.component.html',
  styleUrls: ['./treasury-withdraw-dialog.component.scss'],
})
export class TreasuryWithdrawDialogComponent implements OnInit, OnDestroy {
  amount: number | null = null;
  note = '';
  saving = false;
  loadingBalance = false;
  selectedBranchId = '';
  branches: TreasuryWithdrawBranchOption[] = [];
  availableBalance: number | null = null;
  private subscriptions: Subscription[] = [];

  constructor(
    private dialogRef: MatDialogRef<TreasuryWithdrawDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: TreasuryWithdrawDialogData,
    private treasury: TreasuryAccountsService,
    private notify: AppNotificationService,
    private translate: TranslateService,
    private globals: Globals
  ) {}

  ngOnInit(): void {
    this.branches = this.data.branches || [];
    this.selectedBranchId = String(this.data.branchId || '');
    if (!this.selectedBranchId && this.branches.length === 1) {
      this.selectedBranchId = String(this.branches[0]._id || '');
    }
    this.loadBalance();
  }

  get showBranchPicker(): boolean {
    // Prefer a pre-resolved branch from the statement page; picker only as last resort.
    return !String(this.data.branchId || '').trim() && this.branches.length > 1;
  }

  get accountLabel(): string {
    return String(this.data.label || this.data.accountKey || '').trim();
  }

  get cannotSubmit(): boolean {
    const amt = Number(this.amount);
    const bal = this.availableBalance;
    if (!this.selectedBranchId || this.saving || this.loadingBalance) return true;
    if (!Number.isFinite(amt) || amt <= 0) return true;
    if (bal != null && Math.round(amt * 100) > Math.round(bal * 100)) return true;
    return false;
  }

  onBranchChange(): void {
    this.availableBalance = null;
    this.loadBalance();
  }

  submit(): void {
    const uid = this.globals.currentUser?._id;
    const amt = Number(this.amount);
    if (!uid) return;
    if (!this.selectedBranchId) {
      this.notify.push(this.translate.instant('tr_treasury_pick_one_branch'), 'error');
      return;
    }
    if (!Number.isFinite(amt) || amt <= 0) {
      this.notify.push(this.translate.instant('tr_treasury_amount_invalid'), 'error');
      return;
    }
    if (
      this.availableBalance != null &&
      Math.round(amt * 100) > Math.round(this.availableBalance * 100)
    ) {
      this.notify.push(
        this.translate.instant('tr_treasury_transfer_insufficient', {
          amount: Number(this.availableBalance).toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          }),
        }),
        'error'
      );
      return;
    }
    this.saving = true;
    this.subscriptions.push(
      this.treasury
        .createWithdraw({
          userId: uid,
          branch: this.selectedBranchId,
          accountKey: String(this.data.accountKey || '').toLowerCase(),
          amount: amt,
          note: this.note,
        })
        .subscribe({
          next: () => {
            this.saving = false;
            this.notify.push(this.translate.instant('tr_treasury_withdraw_success'), 'success');
            this.dialogRef.close(true);
          },
          error: (err) => {
            this.saving = false;
            this.notify.push(
              err?.error?.error || this.translate.instant('tr_unexpected_error_message'),
              'error'
            );
          },
        })
    );
  }

  cancel(): void {
    this.dialogRef.close(false);
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach((s) => s.unsubscribe());
  }

  private loadBalance(): void {
    const uid = this.globals.currentUser?._id;
    const key = String(this.data.accountKey || '').toLowerCase();
    if (!uid || !key || !this.selectedBranchId) return;
    this.loadingBalance = true;
    this.subscriptions.push(
      this.treasury.getAccount({ key, userId: uid, branch: this.selectedBranchId }).subscribe({
        next: (res) => {
          this.availableBalance = Number(res?.expectedBalance) || 0;
          this.loadingBalance = false;
        },
        error: () => {
          this.loadingBalance = false;
        },
      })
    );
  }
}
