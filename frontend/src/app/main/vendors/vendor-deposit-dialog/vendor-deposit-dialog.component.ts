import { Component, Inject, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Branch, Vendor } from '@core/models/products.model';
import { AuthenticationService } from '@core/services/authentication.service';
import { resolveActorBranchContext } from '@core/utils/branch-utils';
import { TranslateService } from '@ngx-translate/core';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { BranchesServce } from '@shared/services/branches.service';
import { VendorsSerivce } from '@shared/services/vendors.service';

export type VendorDepositDialogData = {
  vendor: Vendor;
  forcedBranchId?: string | null;
};

@Component({
  selector: 'app-vendor-deposit-dialog',
  templateUrl: './vendor-deposit-dialog.component.html',
  styleUrls: ['./vendor-deposit-dialog.component.scss'],
})
export class VendorDepositDialogComponent implements OnInit {
  saving = false;
  form: FormGroup;
  readonly vendor: Vendor;
  branches: Branch[] = [];
  showBranchPicker = false;

  constructor(
    private fb: FormBuilder,
    private vendors: VendorsSerivce,
    private auth: AuthenticationService,
    private branchesService: BranchesServce,
    private translate: TranslateService,
    private notify: AppNotificationService,
    private ref: MatDialogRef<VendorDepositDialogComponent>,
    @Inject(MAT_DIALOG_DATA) data: VendorDepositDialogData
  ) {
    this.vendor = data.vendor;
    const actor = this.auth.getUserFromLocalStorage();
    const ctx = resolveActorBranchContext(actor, data.forcedBranchId);
    this.showBranchPicker = ctx.showBranchPicker;

    this.form = this.fb.group({
      branchId: [ctx.branchId || '', this.showBranchPicker ? Validators.required : []],
      amount: [0, [Validators.required, Validators.min(0.01)]],
      note: [''],
    });
  }

  ngOnInit(): void {
    if (this.showBranchPicker) {
      this.branchesService.getBranchs({ page: 1, limit: 1000 }).subscribe({
        next: (res: any) => {
          this.branches = res?.branches || [];
          const first = this.branches[0]?._id;
          if (first && !this.form.get('branchId')?.value) {
            this.form.patchValue({ branchId: first });
          }
        },
        error: () => {
          this.notify.push(this.translate.instant('tr_unexpected_error_message'), 'error');
        },
      });
    }
  }

  submit(): void {
    if (this.saving) return;
    if (this.showBranchPicker) {
      this.form.get('branchId')?.enable();
    }
    this.form.markAllAsTouched();
    if (!this.form.valid) return;

    const id = this.vendor._id;
    if (!id) return;

    const v = this.form.getRawValue();
    const branchId = String(v.branchId || '').trim();
    if (!branchId) {
      this.notify.push(this.translate.instant('tr_branch_required'), 'error');
      return;
    }

    this.saving = true;
    const u = this.auth.getUserFromLocalStorage();
    this.vendors
      .addVendorDeposit(String(id), {
        amount: Number(v.amount),
        note: String(v.note || '').trim(),
        userId: u?._id,
        branchId,
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
