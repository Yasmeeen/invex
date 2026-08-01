import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Globals } from '@core/globals';
import { TranslateService } from '@ngx-translate/core';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { TreasuryAccountsService } from '@shared/services/treasury-accounts.service';

@Component({
  selector: 'app-treasury-opening-dialog',
  templateUrl: './treasury-opening-dialog.component.html',
  styleUrls: ['./treasury-opening-dialog.component.scss'],
})
export class TreasuryOpeningDialogComponent {
  amount: number;
  note = '';
  saving = false;

  constructor(
    private dialogRef: MatDialogRef<TreasuryOpeningDialogComponent>,
    @Inject(MAT_DIALOG_DATA)
    public data: {
      branchId: string;
      accountKey: string;
      label: string;
      currentOpening: number;
    },
    private treasury: TreasuryAccountsService,
    private notify: AppNotificationService,
    private translate: TranslateService,
    private globals: Globals
  ) {
    this.amount = Number(data.currentOpening) || 0;
  }

  submit(): void {
    const uid = this.globals.currentUser?._id;
    if (!uid) return;
    const amt = Number(this.amount);
    if (!Number.isFinite(amt)) {
      this.notify.push(this.translate.instant('tr_treasury_amount_invalid'), 'error');
      return;
    }
    this.saving = true;
    this.treasury
      .setOpeningBalance(this.data.accountKey, {
        userId: uid,
        branch: this.data.branchId,
        amount: amt,
        note: this.note,
      })
      .subscribe({
        next: () => {
          this.saving = false;
          this.notify.push(this.translate.instant('tr_treasury_opening_saved'), 'success');
          this.dialogRef.close(true);
        },
        error: (err) => {
          this.saving = false;
          this.notify.push(
            err?.error?.error || this.translate.instant('tr_unexpected_error_message'),
            'error'
          );
        },
      });
  }

  cancel(): void {
    this.dialogRef.close(false);
  }
}
