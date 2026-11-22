import { Component, Inject, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { AuthenticationService } from '@core/services/authentication.service';
import { Branch, Product } from '@core/models/products.model';
import { ConfirmationDialogComponent } from '@shared/components/confirmation-dialog/confirmation-dialog.component';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { ProductsSerivce } from '@shared/services/products.service';

@Component({
  selector: 'app-transfer-product-branch-dialog',
  templateUrl: './transfer-product-branch-dialog.component.html',
  styleUrls: ['./transfer-product-branch-dialog.component.scss'],
})
export class TransferProductBranchDialogComponent implements OnInit {
  form: FormGroup;
  saving = false;
  product: Product;
  branches: Branch[];

  constructor(
    private fb: FormBuilder,
    private dialogRef: MatDialogRef<TransferProductBranchDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA)
    public data: { product: Product; branches: Branch[]; maxQuantity: number },
    private auth: AuthenticationService,
    private products: ProductsSerivce,
    private notify: AppNotificationService,
    private translate: TranslateService,
    private dialog: MatDialog
  ) {
    this.product = data.product;
    this.branches = data.branches || [];
    const preferred = this.preferredDestinationId();
    this.form = this.fb.group({
      toBranchId: [preferred, Validators.required],
      quantity: [1, [Validators.required, Validators.min(1)]],
    });
  }

  ngOnInit(): void {
    this.syncQuantityMax();
    this.form.get('toBranchId')?.valueChanges.subscribe(() => this.syncQuantityMax());
  }

  maxForSelectedBranch(): number {
    return this.capacityForSelectedBranch(false);
  }

  /** Capacity if the pending transfer on this device is cancelled first. */
  maxIfPendingReleased(): number {
    return this.capacityForSelectedBranch(true);
  }

  hasPendingTransfer(): boolean {
    return Math.max(0, Math.floor(Number(this.product.transferReservedQuantity) || 0)) > 0;
  }

  pickupHintForSelected(): string {
    const toId = String(this.form?.get('toBranchId')?.value || '');
    const extra = (this.product.remotePickupTransfers || []).find(
      (x) => String(x.branchId) === toId
    );
    if (!extra || !(extra.quantity > 0)) {
      return '';
    }
    return this.translate.instant('tr_branch_transfer_includes_pickup', {
      n: extra.quantity,
      branch: extra.branchName || '',
    });
  }

  close(): void {
    this.dialogRef.close(false);
  }

  submit(): void {
    this.syncQuantityMax();
    if (this.form.invalid || this.saving) {
      this.form.markAllAsTouched();
      return;
    }
    const user = this.auth.getUserFromLocalStorage();
    const uid = user?._id != null ? String(user._id) : '';
    if (!uid) {
      this.notify.push(this.translate.instant('tr_unexpected_error_message'), 'error');
      return;
    }
    const { toBranchId, quantity } = this.form.value;
    this.sendRequest(uid, String(toBranchId), Math.floor(Number(quantity)), false);
  }

  private preferredDestinationId(): string {
    const remotes = this.product.remotePickupTransfers || [];
    if (remotes.length === 1) {
      const id = String(remotes[0].branchId || '');
      if (this.branches.some((b) => String(b._id) === id)) {
        return id;
      }
    }
    return this.branches[0]?._id ? String(this.branches[0]._id) : '';
  }

  private capacityForSelectedBranch(ignorePending: boolean): number {
    const toId = String(this.form?.get('toBranchId')?.value || '');
    const stock = Math.max(0, Number(this.product.stock) || 0);
    const booked = Math.max(0, Math.floor(Number(this.product.bookedQuantity) || 0));
    const reserved = ignorePending
      ? 0
      : Math.max(0, Math.floor(Number(this.product.transferReservedQuantity) || 0));
    const hold = Math.max(0, Number(this.product.serviceHoldQuantity) || 0);
    const extra = (this.product.remotePickupTransfers || []).find(
      (x) => String(x.branchId) === toId
    );
    const movable = Math.min(booked, Math.max(0, Number(extra?.quantity) || 0));
    return Math.max(0, stock - (booked - movable) - reserved - hold);
  }

  private sendRequest(userId: string, toBranchId: string, quantity: number, replacePending: boolean): void {
    this.saving = true;
    this.products
      .requestBranchTransfer({
        userId,
        productId: String(this.product._id),
        toBranchId,
        quantity,
        replacePending,
      })
      .subscribe({
        next: () => {
          this.notify.push(this.translate.instant('tr_branch_transfer_requested'), 'success');
          this.dialogRef.close(true);
        },
        error: (err) => {
          this.saving = false;
          const pending = err?.error?.pendingTransfers;
          if (!replacePending && err?.status === 409 && err?.error?.code === 'PENDING_TRANSFER_EXISTS') {
            this.confirmReplacePending(Array.isArray(pending) ? pending : [], () =>
              this.sendRequest(userId, toBranchId, quantity, true)
            );
            return;
          }
          const msg = err?.error?.error || this.translate.instant('tr_branch_transfer_failed');
          this.notify.push(msg, 'error');
        },
      });
  }

  private confirmReplacePending(
    pending: Array<{ quantity?: number; toBranchName?: string }>,
    onConfirm: () => void
  ): void {
    const details = pending.map((row) =>
      this.translate.instant('tr_branch_transfer_pending_exists_line', {
        qty: Math.max(1, Math.floor(Number(row.quantity) || 1)),
        branch: row.toBranchName || '—',
      })
    );
    const ref = this.dialog.open(ConfirmationDialogComponent, {
      width: '480px',
      maxWidth: '95vw',
      panelClass: 'replace-pending-transfer-dialog-panel',
      backdropClass: 'replace-pending-transfer-dialog-backdrop',
      data: {
        title: this.translate.instant('tr_branch_transfer_pending_exists_title'),
        message: this.translate.instant('tr_branch_transfer_pending_exists_message'),
        details,
        buttons: [
          {
            label: this.translate.instant('tr_action.cancel'),
            actionCallback: 'cancel',
            type: 'btn-secondary',
          },
          {
            label: this.translate.instant('tr_branch_transfer_replace_pending'),
            actionCallback: 'replace',
            type: 'btn-primary',
          },
        ],
      },
      disableClose: true,
    });
    ref.afterClosed().subscribe((result) => {
      if (result === 'replace') {
        onConfirm();
      }
    });
  }

  private syncQuantityMax(): void {
    const max = Math.max(0, this.maxIfPendingReleased());
    const qty = this.form.get('quantity');
    qty?.setValidators([Validators.required, Validators.min(1), Validators.max(max)]);
    const current = Math.floor(Number(qty?.value) || 1);
    if (current > max) {
      qty?.setValue(max);
    }
    qty?.updateValueAndValidity({ emitEvent: false });
  }
}
