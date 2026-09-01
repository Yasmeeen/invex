import { AfterViewInit, Component, Inject, OnInit, ViewChild } from '@angular/core';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { TranslateService } from '@ngx-translate/core';
import { Category } from '@core/models/products.model';
import { NgForm } from '@angular/forms';
import { CategoriesServce } from '@shared/services/categories.service';
import { StoreSettingsService } from '@shared/services/store-settings.service';
import { Globals } from '@core/globals';
import { CloudinaryUploadService } from '@shared/services/cloudinary-upload.service';
import { environment } from 'src/environments/environment';

export interface CategoryAttributeRow {
  key: string;
  showOnInvoice: boolean;
  showInBarcode: boolean;
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
  /** Default: keep product after stock runs out */
  deleteProductWhenOutOfStock = false;
  /** Default: show product code on customer invoice */
  showProductCodeOnInvoice = true;
  sellByWeight = false;
  weightUnit: 'kg' | 'g' = 'kg';
  categoryImageUrl = '';
  isUploadingImage = false;
  private readonly maxImageBytes = 5 * 1024 * 1024;

  constructor(
    private dialogRef: MatDialogRef<CreateEditCategoryComponent>,
    private categoriesServce: CategoriesServce,
    private appNotificationService: AppNotificationService,
    private translateService: TranslateService,
    public storeSettings: StoreSettingsService,
    private globals: Globals,
    private cloudinaryUpload: CloudinaryUploadService,
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
      this.attributeRows = [{ key: '', showOnInvoice: false, showInBarcode: false }];
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
      multiCodePerPiece: !!(c as any).multiCodePerPiece,
    });
    this.deleteProductWhenOutOfStock = !!(c as any).deleteProductWhenOutOfStock;
    // Missing / null → true (legacy categories default to showing product code)
    this.showProductCodeOnInvoice =
      (c as any).showProductCodeOnInvoice == null
        ? true
        : !!(c as any).showProductCodeOnInvoice;
    this.sellByWeight = !!(c as any).sellByWeight;
    this.weightUnit = (c as any).weightUnit === 'g' ? 'g' : 'kg';
    this.categoryImageUrl = String((c as any).imageUrl || '').trim();
    const defs = Array.isArray((c as any).attributeDefs) ? (c as any).attributeDefs : [];
    this.attributeRows = defs.map((x: any) => {
      if (typeof x === 'string') {
        return { key: String(x), showOnInvoice: false, showInBarcode: false };
      }
      return {
        key: String(x?.key ?? ''),
        showOnInvoice: !!x?.showOnInvoice,
        showInBarcode: !!x?.showInBarcode,
      };
    });
    if (!this.attributeRows.length) {
      this.attributeRows = [{ key: '', showOnInvoice: false, showInBarcode: false }];
    }
  }

  addAttributeRow(): void {
    this.attributeRows.push({ key: '', showOnInvoice: false, showInBarcode: false });
  }

  removeAttributeRow(i: number): void {
    this.attributeRows.splice(i, 1);
    if (!this.attributeRows.length) {
      this.attributeRows = [{ key: '', showOnInvoice: false, showInBarcode: false }];
    }
  }

  private normalizeKey(raw: any): string {
    return String(raw || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_');
  }

  private buildAttributeDefsPayload(): Array<{
    key: string;
    showOnInvoice: boolean;
    showInBarcode: boolean;
  }> {
    const out: Array<{
      key: string;
      showOnInvoice: boolean;
      showInBarcode: boolean;
    }> = [];
    const seen = new Set<string>();
    for (const row of this.attributeRows || []) {
      const key = this.normalizeKey(row?.key);
      if (!key) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        key,
        showOnInvoice: !!row?.showOnInvoice,
        showInBarcode: !!row?.showInBarcode,
      });
    }
    return out;
  }

  isCloudinaryConfigured(): boolean {
    return !!environment.cloudinary?.cloudName;
  }

  onCategoryImageSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }
    if (!file.type.startsWith('image/')) {
      this.appNotificationService.push(
        this.translateService.instant('tr_product_image_invalid_type'),
        'error'
      );
      input.value = '';
      return;
    }
    if (file.size > this.maxImageBytes) {
      this.appNotificationService.push(
        this.translateService.instant('tr_product_image_too_large'),
        'error'
      );
      input.value = '';
      return;
    }
    if (!this.isCloudinaryConfigured()) {
      this.appNotificationService.push(
        this.translateService.instant('tr_cloudinary_not_configured'),
        'error'
      );
      input.value = '';
      return;
    }
    this.isUploadingImage = true;
    this.cloudinaryUpload.uploadProductImage(file, 'categories').subscribe({
      next: (url) => {
        this.isUploadingImage = false;
        this.categoryImageUrl = url;
        this.appNotificationService.push(
          this.translateService.instant('tr_product_image_upload_ok'),
          'success'
        );
        input.value = '';
      },
      error: (err) => {
        this.isUploadingImage = false;
        const msg =
          err?.error?.error ||
          err?.error?.message ||
          this.translateService.instant('tr_product_image_upload_failed');
        this.appNotificationService.push(msg, 'error');
        input.value = '';
      },
    });
  }

  clearCategoryImage(): void {
    this.categoryImageUrl = '';
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
    const userId = this.globals.currentUser?._id || this.data?.userId || null;
    const payload = {
      name: this.category.name,
      code: (this.category as any).code,
      imageUrl: String(this.categoryImageUrl || '').trim(),
      attributeDefs: attrPayload,
      multiCodePerPiece: !!(this.category as any).multiCodePerPiece,
      deleteProductWhenOutOfStock: !!this.deleteProductWhenOutOfStock,
      showProductCodeOnInvoice: !!this.showProductCodeOnInvoice,
      sellByWeight: !!this.sellByWeight,
      weightUnit: this.weightUnit,
      ...(userId ? { userId: String(userId) } : {}),
    };

    if (this.isEdit && this.categoryId) {
      this.categoriesServce.updateCategory(payload, this.categoryId, userId || undefined).subscribe({
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
