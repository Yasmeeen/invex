import { Component, Inject, OnInit, ViewChild } from '@angular/core';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { AppNotificationService } from '@shared/services/app-notification.service';
// import { CategoryesServce } from '@shared/services/categoryes.service';
import { TranslateService } from '@ngx-translate/core';
import { Category } from '@core/models/products.model';
import { NgForm } from '@angular/forms';
import { CategoriesServce } from '@shared/services/categories.service';

@Component({
  selector: 'app-create-edit-category',
  templateUrl: './create-edit-category.component.html',
  styleUrls: ['./create-edit-category.component.scss']
})
export class CreateEditCategoryComponent implements OnInit {
  category: Category ;
  categoryId: string;
  isEdit: boolean;
  @ViewChild('categoryForm') categoryForm: NgForm;
  constructor(
    private dialogRef: MatDialogRef<CreateEditCategoryComponent>,
    private categoriesServce: CategoriesServce,
    private appNotificationService: AppNotificationService,
    private translateService: TranslateService,
    @Inject(MAT_DIALOG_DATA) public data: any,
  ) {}

  closeModal(): void {
    this.dialogRef.close();
  }
  ngOnInit() {
    this.categoryId = this.data.productId
    this.isEdit = this.data.isEdit
    if(this.isEdit){
      this.categoryForm.form.patchValue(this.data.category);
    }
  }

  submitForm(): void {
    this.category = this.categoryForm.value;
    if (!this.categoryForm.valid) {
      this.appNotificationService.push('Category name is required.', 'error');
      return;
    }
    this.categoriesServce.createCategory(this.category).subscribe({
      next: () => {
        this.appNotificationService.push('Category created successfully!', 'success');
        this.dialogRef.close(true);
      },
      error: () => {
        this.appNotificationService.push(
          this.translateService.instant('tr_unexpected_error_message'),
          'error'
        );
      }
    });
  }
}
