import { Component, Inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Client } from '@core/models/users-interfaces.model';
import { AuthenticationService } from '@core/services/authentication.service';
import { TranslateService } from '@ngx-translate/core';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { UserSerivce } from '@shared/services/user.service';

export type ClientOpeningDebitDialogData = {
  client: Client;
};

@Component({
  selector: 'app-client-opening-debit-dialog',
  templateUrl: './client-opening-debit-dialog.component.html',
  styleUrls: ['./client-opening-debit-dialog.component.scss'],
})
export class ClientOpeningDebitDialogComponent {
  saving = false;
  form: FormGroup;
  readonly client: Client;

  constructor(
    private fb: FormBuilder,
    private userService: UserSerivce,
    private auth: AuthenticationService,
    private translate: TranslateService,
    private notify: AppNotificationService,
    private ref: MatDialogRef<ClientOpeningDebitDialogComponent>,
    @Inject(MAT_DIALOG_DATA) data: ClientOpeningDebitDialogData
  ) {
    this.client = data.client;
    this.form = this.fb.group({
      amount: ['', [Validators.required, Validators.min(0.01)]],
      note: [''],
    });
  }

  submit(): void {
    if (this.form.invalid || this.saving) {
      this.form.markAllAsTouched();
      return;
    }

    const clientId = this.client._id;
    if (!clientId) return;

    const amount = Math.round((Number(this.form.value.amount) || 0) * 100) / 100;
    if (amount <= 0) {
      this.notify.push(this.translate.instant('tr_vendor_deferred_amount_required'), 'error');
      return;
    }

    const u = this.auth.getUserFromLocalStorage();
    const note = String(this.form.value.note || '').trim();

    this.saving = true;
    this.userService
      .setClientOpeningDebitBalance(String(clientId), {
        amount,
        note,
        userId: u?._id,
      })
      .subscribe({
        next: () => {
          this.saving = false;
          this.notify.push(
            this.translate.instant('tr_client_opening_debit_set_ok'),
            'success'
          );
          this.ref.close(true);
        },
        error: (err) => {
          this.saving = false;
          const msg =
            err?.error?.error ||
            err?.error?.message ||
            this.translate.instant('tr_unexpected_error_message');
          this.notify.push(msg, 'error');
        },
      });
  }

  cancel(): void {
    this.ref.close(false);
  }
}
