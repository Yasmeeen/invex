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
  readonly maxQuantity: number;

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
    this.maxQuantity = Math.max(1, Math.floor(Number(data.maxQuantity)) || 1);
    this.form = this.fb.group({
      toBranchId: ['', Validators.required],
      quantity: [
        1,
        [Validators.required, Validators.min(1), Validators.max(this.maxQuantity)],
      ],
    });
  }

  ngOnInit(): void {}

  close(): void {
    this.dialogRef.close(false);
  }

  submit(): void {
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
}
