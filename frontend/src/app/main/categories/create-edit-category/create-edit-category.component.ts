import { AfterViewInit, Component, Inject, OnInit, ViewChild } from '@angular/core';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { TranslateService } from '@ngx-translate/core';
import { Category } from '@core/models/products.model';
import { NgForm } from '@angular/forms';
import { CategoriesServce } from '@shared/services/categories.service';

export interface CategoryAttributeRow {
  key: string;
  showOnInvoice: boolean;
}

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
  attributeRows: CategoryAttributeRow[] = [];
  loadingCategory = false;

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

    if (this.isEdit && this.categoryId) {
      this.loadingCategory = true;
      this.categoriesServce.getCategory(this.categoryId).subscribe({
        next: (c: any) => {
          this.loadingCategory = false;
          this.applyCategoryToForm(c as Category);
        },
        error: () => {
          this.loadingCategory = false;
          // fallback to passed data if available
          if (this.data.category) {
            this.applyCategoryToForm(this.data.category as Category);
          }
        },
      });
    }
  }

  ngAfterViewInit(): void {
    if (this.isEdit && this.data.category && this.categoryForm?.form) {
      // initial fast patch while API loads
      this.applyCategoryToForm(this.data.category as Category);
    }
    if (!this.isEdit && !this.attributeRows.length) {
      this.attributeRows = [{ key: '', showOnInvoice: false }];
    }
  }

  trackByIndex(i: number): number {
    return i;
  }

  private applyCategoryToForm(c: Category): void {
    if (!c || !this.categoryForm?.form) {
      return;
    }
    this.categoryForm.form.patchValue({
      name: (c as any).name,
      code: (c as any).code || '',
    });
    const defs = Array.isArray((c as any).attributeDefs) ? (c as any).attributeDefs : [];
    this.attributeRows = defs.map((x: any) => {
      if (typeof x === 'string') {
        return { key: String(x), showOnInvoice: false };
      }
      return {
        key: String(x?.key ?? ''),
        showOnInvoice: !!x?.showOnInvoice,
      };
    });
    if (!this.attributeRows.length) {
      this.attributeRows = [{ key: '', showOnInvoice: false }];
    }
  }

  addAttributeRow(): void {
    this.attributeRows.push({ key: '', showOnInvoice: false });
  }

  removeAttributeRow(i: number): void {
    this.attributeRows.splice(i, 1);
    if (!this.attributeRows.length) {
      this.attributeRows = [{ key: '', showOnInvoice: false }];
    }
  }

  private normalizeKey(raw: any): string {
    return String(raw || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_');
  }

  private buildAttributeDefsPayload(): Array<{ key: string; showOnInvoice: boolean }> {
    const out: Array<{ key: string; showOnInvoice: boolean }> = [];
    const seen = new Set<string>();
    for (const row of this.attributeRows || []) {
      const key = this.normalizeKey(row?.key);
      if (!key) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ key, showOnInvoice: !!row?.showOnInvoice });
    }
    return out;
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
    const attrPayload = this.buildAttributeDefsPayload();
    const payload = {
      name: this.category.name,
      code: (this.category as any).code,
      attributeDefs: attrPayload,
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
