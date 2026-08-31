import { Component, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { NgForm } from '@angular/forms';
import { MatDialogRef } from '@angular/material/dialog';
import { Branch, Product } from '@core/models/products.model';
import { AuthenticationService } from '@core/services/authentication.service';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { BranchesServce } from '@shared/services/branches.service';
import { ProductsSerivce } from '@shared/services/products.service';
import { Subscription } from 'rxjs';
import { TranslateService } from '@ngx-translate/core';

@Component({
  selector: 'app-inventory-transfer-product',
  templateUrl: './create-edit-product.component.html',
  styleUrls: ['./create-edit-product.component.scss']
})
export class CreateEditProductComponent implements OnInit {
  @ViewChild('warehouseForm') warehouseForm: NgForm;
  products: Product[] = [];
  branches: Branch[] = [];
  isSubmitting = false;
  transferPayload = {
    productId: '',
    quantity: 1,
    toBranchId: '',
  };
  private subscriptions: Subscription[] = [];

  constructor(
    private dialogRef: MatDialogRef<CreateEditProductComponent>,
    private productsService: ProductsSerivce,
    private branchesServce: BranchesServce,
    private appNotificationService: AppNotificationService,
    private translateService: TranslateService,
    private authenticationService: AuthenticationService
  ) {}

  ngOnInit(): void {
    this.getProducts();
    this.getBranches();
  }

  private getProducts(): void {
    const params = { page: 1, limit: 1000, warehouseOnly: true };
    this.subscriptions.push(
      this.productsService.getProducts(params).subscribe(
        (response: any) => {
          this.products = response.products || [];
        },
        () => {
          this.appNotificationService.push(
            this.translateService.instant('tr_unexpected_error_message'),
            'error'
          );
        }
      )
    );
  }

  private getBranches(): void {
    const params = { page: 1, limit: 1000 };
    this.subscriptions.push(
      this.branchesServce.getBranchs(params).subscribe(
        (response: any) => {
          this.branches = response.branches || [];
        },
        () => {
          this.appNotificationService.push(
            this.translateService.instant('tr_unexpected_error_message'),
            'error'
          );
        }
      )
    );
  }

  submitForm(): void {
    if (!this.warehouseForm?.valid) {
      return;
    }
    const user = this.authenticationService.getUserFromLocalStorage();
    const userId = user?._id != null ? String(user._id) : '';
    if (!userId) {
      this.appNotificationService.push(
        this.translateService.instant('tr_unexpected_error_message'),
        'error'
      );
      return;
    }
    this.isSubmitting = true;
    this.subscriptions.push(
      this.productsService
        .requestBranchTransfer({
          userId,
          productId: this.transferPayload.productId,
          toBranchId: this.transferPayload.toBranchId,
          quantity: this.transferPayload.quantity,
        })
        .subscribe(
        () => {
          this.isSubmitting = false;
          this.appNotificationService.push(
            this.translateService.instant('tr_branch_transfer_requested'),
            'success'
          );
          this.closeModal(true);
        },
        (error: any) => {
          this.isSubmitting = false;
          const message =
            error?.error?.error ||
            this.translateService.instant('tr_unexpected_error_message');
          this.appNotificationService.push(message, 'error');
        }
      )
    );
  }

  closeModal(isSubmit?: boolean): void {
    this.dialogRef.close(isSubmit);
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach((s) => s && s.unsubscribe());
  }
}
