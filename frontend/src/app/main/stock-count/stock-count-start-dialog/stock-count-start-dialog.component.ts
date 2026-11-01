import { Component, Inject, OnDestroy, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Branch, Category } from '@core/models/products.model';
import { AuthenticationService } from '@core/services/authentication.service';
import { canPickBranchRole, isWarehouse } from '@core/utils/role-utils';
import { TranslateService } from '@ngx-translate/core';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { BranchesServce } from '@shared/services/branches.service';
import { CategoriesServce } from '@shared/services/categories.service';
import { StockCountService, stockCountErrorMessage } from '@shared/services/stock-count.service';
import { Subscription } from 'rxjs';

export interface StockCountStartDialogData {
  userId: string;
}

@Component({
  selector: 'app-stock-count-start-dialog',
  templateUrl: './stock-count-start-dialog.component.html',
  styleUrls: ['./stock-count-start-dialog.component.scss'],
})
export class StockCountStartDialogComponent implements OnInit, OnDestroy {
  form: FormGroup;
  saving = false;
  loading = true;
  branches: Branch[] = [];
  categories: Category[] = [];
  showLocationPicker = false;
  hiddenWeight = false;
  fixedBranchName = '';
  private subscriptions: Subscription[] = [];

  constructor(
    private fb: FormBuilder,
    private dialogRef: MatDialogRef<StockCountStartDialogComponent, string | undefined>,
    @Inject(MAT_DIALOG_DATA) public data: StockCountStartDialogData,
    private auth: AuthenticationService,
    private stockCounts: StockCountService,
    private branchesService: BranchesServce,
    private categoriesService: CategoriesServce,
    private notify: AppNotificationService,
    private translate: TranslateService
  ) {
    const actor = this.auth.getUserFromLocalStorage();
    const role = actor?.role;
    this.showLocationPicker = canPickBranchRole(role) || isWarehouse(role);
    const branch = actor?.branch as { _id?: string; name?: string } | string | undefined;
    this.fixedBranchName =
      branch && typeof branch === 'object' ? String(branch.name || '').trim() : '';
    const defaultLocation = isWarehouse(role) && !canPickBranchRole(role) ? 'warehouse' : 'branch';
    this.form = this.fb.group({
      locationType: [defaultLocation],
      branchId: [''],
      categoryIds: [[], Validators.required],
      note: ['', Validators.maxLength(500)],
    });
  }

  ngOnInit(): void {
    if (this.showLocationPicker) {
      this.subscriptions.push(
        this.branchesService.getBranchs({ page: 1, limit: 1000 }).subscribe({
          next: (res: any) => {
            this.branches = res?.branches || [];
          },
          error: () => {
            this.notify.push(this.translate.instant('tr_unexpected_error_message'), 'error');
          },
        })
      );
    }
    this.subscriptions.push(
      this.categoriesService.getCategorys({ page: 1, limit: 1000, lite: '1' }).subscribe({
        next: (res: any) => {
          const all = res?.categories || [];
          this.hiddenWeight = all.some((category: Category) => !!category.sellByWeight);
          this.categories = all.filter((category: Category) => !category.sellByWeight);
          this.loading = false;
        },
        error: () => {
          this.loading = false;
          this.notify.push(this.translate.instant('tr_unexpected_error_message'), 'error');
        },
      })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach((sub) => sub.unsubscribe());
  }

  get showBranchPicker(): boolean {
    return this.showLocationPicker && this.form.get('locationType')?.value !== 'warehouse';
  }

  close(): void {
    this.dialogRef.close();
  }

  submit(): void {
    if (this.saving) return;
    const categoryIds = (this.form.get('categoryIds')?.value || []) as string[];
    if (!categoryIds.length) {
      this.notify.push(this.translate.instant('tr_stock_count_categories_required'), 'error');
      return;
    }
    const locationType = this.form.get('locationType')?.value === 'warehouse' ? 'warehouse' : 'branch';
    const branchId = String(this.form.get('branchId')?.value || '').trim();
    if (this.showBranchPicker && locationType === 'branch' && !branchId) {
      this.notify.push(this.translate.instant('tr_stock_count_branch_required'), 'error');
      return;
    }

    this.saving = true;
    this.subscriptions.push(
      this.stockCounts
        .create({
          userId: this.data.userId,
          categoryIds,
          locationType: this.showLocationPicker ? locationType : 'branch',
          branchId: this.showBranchPicker ? branchId : undefined,
          note: String(this.form.get('note')?.value || '').trim(),
        })
        .subscribe({
          next: (res) => {
            this.saving = false;
            this.dialogRef.close(res.count?._id);
          },
          error: (err) => {
            this.saving = false;
            this.notify.push(stockCountErrorMessage(this.translate, err), 'error');
          },
        })
    );
  }
}
