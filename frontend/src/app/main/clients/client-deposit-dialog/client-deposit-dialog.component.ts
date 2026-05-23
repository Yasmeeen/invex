import { Component, Inject, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { Branch } from '@core/models/products.model';
import { Client } from '@core/models/users-interfaces.model';
import { AuthenticationService } from '@core/services/authentication.service';
import { resolveActorBranchContext } from '@core/utils/branch-utils';
import { TranslateService } from '@ngx-translate/core';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { BranchesServce } from '@shared/services/branches.service';
import { UserSerivce } from '@shared/services/user.service';
import {
  PaymentSplitsDialogComponent,
  PaymentSplitsDialogData,
} from '@shared/components/payment-splits-dialog/payment-splits-dialog.component';
import {
  PaymentSplitsResult,
  paymentSplitsNetTotal,
} from '@shared/utils/payment-app-fee.util';

export type ClientDepositDialogData = {
  client: Client;
  forcedBranchId?: string | null;
};

@Component({
  selector: 'app-client-deposit-dialog',
  templateUrl: './client-deposit-dialog.component.html',
  styleUrls: ['./client-deposit-dialog.component.scss'],
})
export class ClientDepositDialogComponent implements OnInit {
  saving = false;
  form: FormGroup;
  readonly client: Client;
  branches: Branch[] = [];
  showBranchPicker = false;
  confirmedPayment: PaymentSplitsResult | null = null;

  constructor(
    private fb: FormBuilder,
    private users: UserSerivce,
    private auth: AuthenticationService,
    private branchesService: BranchesServce,
    private translate: TranslateService,
    private notify: AppNotificationService,
    private dialog: MatDialog,
    private ref: MatDialogRef<ClientDepositDialogComponent>,
    @Inject(MAT_DIALOG_DATA) data: ClientDepositDialogData
  ) {
    this.client = data.client;
    const actor = this.auth.getUserFromLocalStorage();
    const ctx = resolveActorBranchContext(actor, data.forcedBranchId);
    this.showBranchPicker = ctx.showBranchPicker;

    this.form = this.fb.group({
      branchId: [ctx.branchId || '', this.showBranchPicker ? Validators.required : []],
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

  paymentSummaryText(): string {
    if (!this.confirmedPayment) {
      return '';
    }
    const methods = this.confirmedPayment.paymentSplits.filter((s) => s.amount > 0).length;
    const total = paymentSplitsNetTotal(this.confirmedPayment.paymentSplits);
    return this.translate.instant('tr_payment_splits_summary', { count: methods, total });
  }

  openPaymentSplitsDialog(): void {
    const data: PaymentSplitsDialogData = {
      invoiceNetTotal: 0,
      mode: 'deposit',
      initialState: this.confirmedPayment
        ? {
            selectedPayMethods: this.confirmedPayment.paymentSplits.map((s) => s.method),
            payAmounts: this.confirmedPayment.paymentSplits.reduce(
              (acc, s) => {
                acc[s.method] = s.amount;
                return acc;
              },
              {} as Record<string, number>
            ),
            feeSources: this.confirmedPayment.feeAllocations.map((f) => ({
              forMethod: f.forMethod,
              paidVia: f.paidVia === f.forMethod ? 'same' : f.paidVia,
            })),
          }
        : undefined,
    };

    this.dialog
      .open(PaymentSplitsDialogComponent, {
        width: '560px',
        maxWidth: '95vw',
        panelClass: 'payment-splits-dialog-panel',
        backdropClass: 'payment-splits-dialog-backdrop',
        data,
      })
      .afterClosed()
      .subscribe((result: PaymentSplitsResult | null) => {
        if (result) {
          this.confirmedPayment = result;
        }
      });
  }

  submit(): void {
    if (this.saving) return;
    if (this.showBranchPicker) {
      this.form.get('branchId')?.enable();
    }
    this.form.markAllAsTouched();
    if (!this.form.valid) return;

    if (!this.confirmedPayment) {
      this.openPaymentSplitsDialog();
      return;
    }

    const id = this.client._id;
    if (!id) return;

    const v = this.form.getRawValue();
    const branchId = String(v.branchId || '').trim();
    if (!branchId) {
      this.notify.push(this.translate.instant('tr_branch_required'), 'error');
      return;
    }

    const splits = this.confirmedPayment.paymentSplits.filter((s) => s.amount > 0);
    const netTotal = paymentSplitsNetTotal(splits);
    if (netTotal <= 0) {
      this.notify.push(this.translate.instant('tr_vendor_deferred_amount_required'), 'error');
      return;
    }

    this.saving = true;
    const u = this.auth.getUserFromLocalStorage();
    this.users
      .addClientDeposit(String(id), {
        amount: netTotal,
        paymentSplits: splits,
        paymentFeeAllocations: this.confirmedPayment.feeAllocations,
        note: String(v.note || '').trim(),
        userId: u?._id,
        branchId,
      })
      .subscribe({
        next: () => {
          this.saving = false;
          this.notify.push(this.translate.instant('tr_client_deposit_ok'), 'success');
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

  close(): void {
    this.ref.close(false);
  }
}
