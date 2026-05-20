import { Component, Inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Vendor } from '@core/models/products.model';
import { AuthenticationService } from '@core/services/authentication.service';
import { TranslateService } from '@ngx-translate/core';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { VendorsSerivce } from '@shared/services/vendors.service';

export type VendorDepositDialogData = { vendor: Vendor };

@Component({
  selector: 'app-vendor-deposit-dialog',
  templateUrl: './vendor-deposit-dialog.component.html',
  styleUrls: ['./vendor-deposit-dialog.component.scss'],
})
export class VendorDepositDialogComponent {
  saving = false;
  form: FormGroup;
  readonly vendor: Vendor;

  constructor(
    private fb: FormBuilder,
    private vendors: VendorsSerivce,
    private auth: AuthenticationService,
    private translate: TranslateService,
    private notify: AppNotificationService,
    private ref: MatDialogRef<VendorDepositDialogComponent>,
    @Inject(MAT_DIALOG_DATA) data: VendorDepositDialogData
  ) {
    this.vendor = data.vendor;
    this.form = this.fb.group({
      amount: [0, [Validators.required, Validators.min(0.01)]],
      note: [''],
    });
  }

  submit(): void {
    if (this.saving) return;
    this.form.markAllAsTouched();
    if (!this.form.valid) return;

    const id = this.vendor._id;
    if (!id) return;

    const v = this.form.getRawValue();
    this.saving = true;
    const u = this.auth.getUserFromLocalStorage();
    this.vendors
      .addVendorDeposit(String(id), {
        amount: Number(v.amount),
        note: String(v.note || '').trim(),
        userId: u?._id,
      })
      .subscribe({
        next: () => {
          this.saving = false;
          this.notify.push(this.translate.instant('tr_vendor_deposit_ok'), 'success');
          this.ref.close(true);
        },
        error: (err) => {
          this.saving = false;
          const msg =
            err?.error?.message ||
            this.translate.instant('tr_unexpected_error_message');
          this.notify.push(msg, 'error');
        },
      });
  }

  close(): void {
    this.ref.close(false);
  }
}
