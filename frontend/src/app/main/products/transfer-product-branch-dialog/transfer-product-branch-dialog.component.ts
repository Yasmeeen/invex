import { Component, Inject, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { AuthenticationService } from '@core/services/authentication.service';
import { Branch, Product } from '@core/models/products.model';
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
    private translate: TranslateService
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
    const toId = String(this.form?.get('toBranchId')?.value || '');
    const stock = Math.max(0, Number(this.product.stock) || 0);
    const booked = Math.max(0, Math.floor(Number(this.product.bookedQuantity) || 0));
    const reserved = Math.max(0, Math.floor(Number(this.product.transferReservedQuantity) || 0));
    const free = Math.max(0, stock - booked - reserved);
    const extra = (this.product.remotePickupTransfers || []).find(
      (x) => String(x.branchId) === toId
    );
    return free + Math.max(0, Number(extra?.quantity) || 0);
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
    this.saving = true;
    this.products
      .requestBranchTransfer({
        userId: uid,
        productId: String(this.product._id),
        toBranchId: String(toBranchId),
        quantity: Math.floor(Number(quantity)),
      })
      .subscribe({
        next: () => {
          this.notify.push(this.translate.instant('tr_branch_transfer_requested'), 'success');
          this.dialogRef.close(true);
        },
        error: (err) => {
          this.saving = false;
          const msg =
            err?.error?.error ||
            this.translate.instant('tr_branch_transfer_failed');
          this.notify.push(msg, 'error');
        },
      });
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

  private syncQuantityMax(): void {
    const max = Math.max(1, this.maxForSelectedBranch());
    const qty = this.form.get('quantity');
    qty?.setValidators([Validators.required, Validators.min(1), Validators.max(max)]);
    const current = Math.floor(Number(qty?.value) || 1);
    if (current > max) {
      qty?.setValue(max);
    }
    qty?.updateValueAndValidity({ emitEvent: false });
  }
}
