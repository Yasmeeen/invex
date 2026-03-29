import { AfterViewInit, Component, Inject, OnInit, ViewChild } from '@angular/core';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { TranslateService } from '@ngx-translate/core';
import { Category } from '@core/models/products.model';
import { NgForm } from '@angular/forms';
import { CategoriesServce } from '@shared/services/categories.service';

@Component({
  selector: 'app-create-edit-category',
  templateUrl: './create-edit-category.component.html',
  styleUrls: ['./create-edit-category.component.scss'],
})
export class CreateEditCategoryComponent implements OnInit, AfterViewInit {
  category: Category;
  categoryId: string;
  isEdit: boolean;
  @ViewChild('categoryForm') categoryForm: NgForm;

  constructor(
    private dialogRef: MatDialogRef<CreateEditCategoryComponent>,
    private categoriesServce: CategoriesServce,
    private appNotificationService: AppNotificationService,
    private translateService: TranslateService,
    @Inject(MAT_DIALOG_DATA) public data: any
  ) {}

  closeModal(): void {
    this.dialogRef.close();
  }

  ngOnInit(): void {
    this.categoryId = this.data.categoryId;
    this.isEdit = this.data.isEdit;
  }

  ngAfterViewInit(): void {
    if (this.isEdit && this.data.category && this.categoryForm?.form) {
      const c = this.data.category;
      this.categoryForm.form.patchValue({
        name: c.name,
        code: c.code || '',
      });
    }
  }

  submitForm(): void {
    this.category = this.categoryForm.value;
    if (!this.categoryForm.valid) {
      this.appNotificationService.push(
        this.translateService.instant('tr_fill_required_fields'),
        'error'
      );
      return;
    }
    const payload = {
      name: this.category.name,
      code: (this.category as any).code,
    };

    if (this.isEdit && this.categoryId) {
      this.categoriesServce.updateCategory(payload, this.categoryId).subscribe({
        next: () => {
          this.appNotificationService.push(
            this.translateService.instant('tr_category_updated_ok'),
            'success'
          );
          this.dialogRef.close(true);
        },
        error: (err) => {
          const msg =
            err?.error?.error ||
            this.translateService.instant('tr_unexpected_error_message');
          this.appNotificationService.push(msg, 'error');
        },
      });
      return;
    }

    this.categoriesServce.createCategory(payload).subscribe({
      next: () => {
        this.appNotificationService.push(
          this.translateService.instant('tr_category_created_ok'),
          'success'
        );
        this.dialogRef.close(true);
      },
      error: (err) => {
        const msg =
          err?.error?.error ||
          this.translateService.instant('tr_unexpected_error_message');
        this.appNotificationService.push(msg, 'error');
      },
    });
  }
}
