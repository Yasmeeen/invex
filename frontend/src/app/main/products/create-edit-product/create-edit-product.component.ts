import { BranchesServce } from '@shared/services/branches.service';
// import { category } from '@core/models/products-interface.model';

import { AppNotificationService } from '@shared/services/app-notification.service';
import { UserSerivce } from '@shared/services/user.service';
import { Component, Inject, OnInit } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import {
  ViewChild,
  ElementRef,
  Output,
  EventEmitter,
} from '@angular/core';
import { NgForm } from '@angular/forms';
import { Branch, Category, Product } from '@core/models/products.model';
import { ProductsSerivce } from '@shared/services/products.service';
import { Subscription } from 'rxjs';
import { CategoriesServce } from '@shared/services/categories.service';
import { TranslateService } from '@ngx-translate/core';
import { CloudinaryUploadService } from '@shared/services/cloudinary-upload.service';
import { environment } from 'src/environments/environment';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { Globals } from '@core/globals';
import { isBranchManager } from '@core/utils/role-utils';
// import { BrowserMultiFormatReader } from '@zxing/browser';


@Component({
  selector: 'app-create-edit-product',
  templateUrl: './create-edit-product.component.html',
  styleUrls: ['./create-edit-product.component.scss']
})
export class CreateEditProductComponent implements OnInit {
  branches: Branch [];
  codeReader = new BrowserMultiFormatReader();
  isCameraActive = false;
  codeValue: string;

  product:Product
  productId: string;
  isSubmitting: boolean;
  isEdit: boolean = false;
  /** When true, product is stored in central warehouse (no branch). */
  storeInWarehouse = false;
  categories: Category [];
  /** Stable array for ng-select `[items]` (do not use a getter — new refs break selection). */
  categoryDropdownItems: Category[] = [];
  /** Bound to category ng-select (category must be chosen before product code). */
  selectedCategory: Category | null = null;
  categoryAttributeDefs: Array<{ key: string; label: string; options: Array<{ value: string; label: string }> }> = [];
  attributeValues: Record<string, string> = {};
  private previousCategoryIdForEdit: string | null = null;
  private subscriptions: Subscription[] = [];
  isCodeGenerated = false;
  /** Saved Cloudinary (or other HTTPS) URL */
  productImageUrl = '';
  isUploadingImage = false;
  readonly maxImageBytes = 5 * 1024 * 1024;
  @Output() destroyEmitter: EventEmitter<any> = new EventEmitter();
  @ViewChild('modalContainer') modalContainer: ElementRef;
  @ViewChild('modalContent') modalContent: ElementRef;
  @ViewChild('basicInfoForm') basicInfoForm: NgForm;

  constructor(

    private dialogRef: MatDialogRef<CreateEditProductComponent>,
    private productsSerivce: ProductsSerivce,
    private appNotificationService: AppNotificationService,
    private categoriesServce: CategoriesServce,
    private translateService: TranslateService,
    private branchesServce:BranchesServce ,
    @Inject(MAT_DIALOG_DATA) public data: any,
    private cloudinaryUpload: CloudinaryUploadService,
    public globals: Globals
  ) {}

  /** New product only: Branch Manager adds to assigned branch (no warehouse/branch UI). */
  get isBranchManagerNewProduct(): boolean {
    return !this.isEdit && isBranchManager(this.globals.currentUser?.role);
  }

  hasCategoryCode(c?: Category | null): boolean {
    return !!(c && String(c.code || '').trim());
  }

  private refreshCategoryDropdownItems(): void {
    if (!this.categories?.length) {
      this.categoryDropdownItems = [];
      return;
    }
    if (this.isEdit) {
      const list = [...this.categories];
      const sel = this.selectedCategory;
      if (sel?._id && !list.some((c) => String(c._id) === String(sel._id))) {
        list.unshift(sel);
      }
      this.categoryDropdownItems = list;
      return;
    }
    this.categoryDropdownItems = [...this.categories];
  }

  get hasAnyCategoryWithCode(): boolean {
    return !!(this.categories?.some((c) => this.hasCategoryCode(c)));
  }

  categoryCompare(a: Category | null, b: Category | null): boolean {
    if (a == null || b == null) {
      return a == null && b == null;
    }
    return String(a._id) === String(b._id);
  }

  get isProductCodeEnabled(): boolean {
    return !!(this.selectedCategory && this.hasCategoryCode(this.selectedCategory));
  }

  ngOnInit() {
    this.productId = this.data.productId
    this.isEdit = this.data.isEdit
    this.getCategories();
    this.getBranches();
    if(this.isEdit){
    this.getProductData()
     
    }

  }

  private normalizeAttrKey(raw: any): string {
    return String(raw || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_');
  }

  private setCategoryAttributeDefsFromSelected(): void {
    const defs = Array.isArray((this.selectedCategory as any)?.attributeDefs)
      ? ((this.selectedCategory as any).attributeDefs as any[])
      : [];
    this.categoryAttributeDefs = defs
      .map((d) => {
        const key = this.normalizeAttrKey(d?.key);
        const label = String(d?.label || '').trim();
        return { key, label, options: [] };
      })
      .filter((d) => d.key && d.label);

    // Keep only values that still exist in defs
    const allowed = new Set(this.categoryAttributeDefs.map((d) => d.key));
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(this.attributeValues || {})) {
      const nk = this.normalizeAttrKey(k);
      if (!allowed.has(nk)) continue;
      next[nk] = String(v ?? '');
    }
    this.attributeValues = next;
  }

  private buildAttributesPayload(): Record<string, string> {
    const allowed = new Set(this.categoryAttributeDefs.map((d) => d.key));
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(this.attributeValues || {})) {
      const key = this.normalizeAttrKey(k);
      if (!allowed.has(key)) continue;
      const val = String(v ?? '').trim();
      if (!val) continue;
      out[key] = val;
    }
    return out;
  }

  setStorageMode(warehouse: boolean) {
    this.storeInWarehouse = warehouse;
    if (warehouse && this.basicInfoForm?.form) {
      this.basicInfoForm.form.patchValue({ branch: null });
    }
  }

  getCategories() {
    let params = {
      'page': 1,
      'limit': 1000
    }
    this.subscriptions.push(this.categoriesServce.getCategorys(params).subscribe((response: any) => {
      this.categories = response.categories;
      this.refreshCategoryDropdownItems();
    },(error:any)=> {

      this.appNotificationService.push( this.translateService.instant('tr_unexpected_error_message'), 'error');
    }))
  }
  getBranches() {
    let params = {
      'page': 1,
     'limit': 1000
    }
    this.subscriptions.push(this.branchesServce.getBranchs(params).subscribe((response: any) => {
      this.branches = response.branches
    },(error:any)=> {

      this.appNotificationService.push( this.translateService.instant('tr_unexpected_error_message'), 'error');
    }))
  }

  getProductData() {
    this.productsSerivce.getProduct(this.productId).subscribe((response: any) => {
      this.productId = response._id;
      this.storeInWarehouse = !!response.inWarehouse;
      this.codeValue = response.code;
      this.selectedCategory = response.category || null;
      this.setCategoryAttributeDefsFromSelected();
      const attrsRaw = response?.attributes;
      if (attrsRaw && typeof attrsRaw === 'object' && !Array.isArray(attrsRaw)) {
        const next: Record<string, string> = {};
        for (const [k, v] of Object.entries(attrsRaw)) {
          next[this.normalizeAttrKey(k)] = String(v ?? '');
        }
        this.attributeValues = next;
      } else {
        this.attributeValues = {};
      }
      this.previousCategoryIdForEdit = this.selectedCategory?._id
        ? String(this.selectedCategory._id)
        : null;
      this.basicInfoForm.form.patchValue({
        name: response.name,
        code: response.code,
        price: response.price,
        netPrice: response.netPrice,
        stock: response.stock,
        discount: response.discount,
        category: response.category,
        branch: response.branch || null,
      });
      this.productImageUrl = response.imageUrl || '';
      this.refreshCategoryDropdownItems();
    });
  }

  onProductCategoryChange(cat: Category | null): void {
    this.selectedCategory = cat;
    this.setCategoryAttributeDefsFromSelected();
    if (!cat) {
      if (!this.isEdit) {
        this.codeValue = '';
        this.isCodeGenerated = false;
      }
      return;
    }
    if (!this.hasCategoryCode(cat)) {
      if (!this.isEdit) {
        this.codeValue = '';
        this.isCodeGenerated = false;
      }
      return;
    }
    if (!this.isEdit) {
      this.codeValue = '';
      this.isCodeGenerated = false;
      this.regenerateCodeFromCategory();
      return;
    }
    const newId = String(cat._id);
    if (this.previousCategoryIdForEdit && this.previousCategoryIdForEdit !== newId) {
      this.regenerateCodeFromCategory();
    }
    this.previousCategoryIdForEdit = newId;
  }

  private regenerateCodeFromCategory(): void {
    const cat = this.selectedCategory;
    if (!cat?._id || !this.hasCategoryCode(cat)) {
      return;
    }
    this.productsSerivce.generateBarcode(String(cat._id)).subscribe({
      next: (res: { code: string }) => {
        this.codeValue = res.code;
        this.isCodeGenerated = true;
        this.basicInfoForm?.form?.patchValue({ code: res.code });
      },
      error: (err: any) => {
        const msg =
          err?.error?.error ||
          this.translateService.instant('tr_barcode_generate_failed');
        this.appNotificationService.push(msg, 'error');
      },
    });
  }

  enforceProductCodePrefix(): void {
    const cat = this.selectedCategory;
    if (!cat || !this.hasCategoryCode(cat)) {
      return;
    }
    const prefix = String(cat.code).trim();
    let v = (this.codeValue || '').trim();
    if (!v) {
      return;
    }
    const pu = prefix.toUpperCase();
    if (!v.toUpperCase().startsWith(pu)) {
      const join = prefix.endsWith('-') ? '' : '-';
      this.codeValue = `${prefix}${join}${v}`.replace(/-+/g, '-');
    }
  }

  isCloudinaryConfigured(): boolean {
    return !!environment.cloudinary?.cloudName;
  }

  onProductImageSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }
    if (!file.type.startsWith('image/')) {
      this.appNotificationService.push(this.translateService.instant('tr_product_image_invalid_type'), 'error');
      input.value = '';
      return;
    }
    if (file.size > this.maxImageBytes) {
      this.appNotificationService.push(this.translateService.instant('tr_product_image_too_large'), 'error');
      input.value = '';
      return;
    }
    if (!this.isCloudinaryConfigured()) {
      this.appNotificationService.push(this.translateService.instant('tr_cloudinary_not_configured'), 'error');
      input.value = '';
      return;
    }
    this.isUploadingImage = true;
    this.subscriptions.push(
      this.cloudinaryUpload.uploadProductImage(file).subscribe(
        (url) => {
          this.isUploadingImage = false;
          this.productImageUrl = url;
          this.appNotificationService.push(this.translateService.instant('tr_product_image_upload_ok'), 'success');
          input.value = '';
        },
        () => {
          this.isUploadingImage = false;
          this.appNotificationService.push(this.translateService.instant('tr_product_image_upload_failed'), 'error');
          input.value = '';
        }
      )
    );
  }

  clearProductImage(): void {
    this.productImageUrl = '';
  }






generateBarcode() {
  const cat = this.selectedCategory;
  if (!cat?._id || !this.hasCategoryCode(cat)) {
    this.appNotificationService.push(
      this.translateService.instant('tr_select_category_first_code'),
      'error'
    );
    return;
  }
  this.productsSerivce.generateBarcode(String(cat._id)).subscribe({
    next: (res: { code: string }) => {
      this.codeValue = res.code;
      this.isCodeGenerated = true;
      this.basicInfoForm?.form?.patchValue({ code: res.code });
      this.appNotificationService.push(
        this.translateService.instant('tr_product_code_generated'),
        'success'
      );
    },
    error: (err: any) => {
      const msg =
        err?.error?.error ||
        this.translateService.instant('tr_barcode_generate_failed');
      this.appNotificationService.push(msg, 'error');
    },
  });
}

createProduct() {
  if (this.isUploadingImage) {
    return;
  }
  if (!this.basicInfoForm.valid) return;
  if (!this.selectedCategory || !this.hasCategoryCode(this.selectedCategory)) {
    this.appNotificationService.push(
      this.translateService.instant('tr_select_category_first_code'),
      'error'
    );
    return;
  }
  const codeTrim = String(this.codeValue || '').trim();
  const prefix = String(this.selectedCategory.code || '').trim();
  if (!codeTrim.toUpperCase().startsWith(prefix.toUpperCase())) {
    this.appNotificationService.push(
      this.translateService.instant('tr_product_code_prefix_mismatch'),
      'error'
    );
    return;
  }

  const inWarehouse = this.isBranchManagerNewProduct ? false : this.storeInWarehouse;
  let branchForPayload = this.basicInfoForm.value.branch;
  if (this.isBranchManagerNewProduct) {
    const ub = this.globals.currentUser?.branch;
    branchForPayload =
      (ub && this.branches?.find((b: Branch) => String(b._id) === String(ub._id))) || ub;
    if (!branchForPayload?._id) {
      this.appNotificationService.push(
        this.translateService.instant('tr_branch_required'),
        'error'
      );
      return;
    }
  } else if (!inWarehouse && !branchForPayload?._id) {
    this.appNotificationService.push(
      this.translateService.instant('tr_branch_required'),
      'error'
    );
    return;
  }

  const payload: any = {
    ...this.basicInfoForm.value,
    code: this.codeValue,
    inWarehouse,
    imageUrl: this.productImageUrl || '',
    attributes: this.buildAttributesPayload(),
  };
  // Let backend compute netPrice when left empty.
  if (payload.netPrice === '' || payload.netPrice == null) {
    delete payload.netPrice;
  }
  // Ensure numeric discount payload (discount is a percentage 0..100).
  if (payload.discount === '' || payload.discount == null) {
    payload.discount = 0;
  }
  if (inWarehouse) {
    delete payload.branch;
  } else if (this.isBranchManagerNewProduct) {
    payload.branch = branchForPayload;
  }

  this.productsSerivce.createProduct(payload).subscribe(
    (res: any) => {
      this.appNotificationService.push('✅ المنتج تم إضافته', 'success');

      this.productsSerivce
        .getBarcodeImage(res.createdProduct.code, payload.name)
        .subscribe((html: any) => {
          this.printHtml(html);
          this.closeModal();

        });
    },
    (error) => {
      this.appNotificationService.push(error.error.error, 'error');
    }
  );
}

printHtml(html: string) {
  const printWindow = window.open('', '_blank', 'width=600,height=400');
  
  if (!printWindow) return;

  printWindow.document.open();
  printWindow.document.write(html);


  printWindow.document.write(`
    <script>
      window.onload = function() {
        window.print();
      };
      window.onafterprint = function() {
        window.close();
      };
    </script>
  `);

  printWindow.document.close();
}




updateProduct() {
  if (this.isUploadingImage) {
    return;
  }
  this.product = this.basicInfoForm.value;
  if (!this.basicInfoForm.valid) return;
  if (!this.selectedCategory || !this.hasCategoryCode(this.selectedCategory)) {
    this.appNotificationService.push(
      this.translateService.instant('tr_category_code_missing_on_category'),
      'error'
    );
    return;
  }
  const codeTrim = String(this.codeValue || '').trim();
  const prefix = String(this.selectedCategory.code || '').trim();
  if (!codeTrim.toUpperCase().startsWith(prefix.toUpperCase())) {
    this.appNotificationService.push(
      this.translateService.instant('tr_product_code_prefix_mismatch'),
      'error'
    );
    return;
  }
  if (!this.storeInWarehouse && !this.basicInfoForm.value.branch?._id) {
    this.appNotificationService.push(
      this.translateService.instant('tr_branch_required'),
      'error'
    );
    return;
  }
  this.product = this.basicInfoForm.value;
  const payload: any = {
    ...this.basicInfoForm.value,
    code: this.codeValue,
    inWarehouse: this.storeInWarehouse,
    imageUrl: this.productImageUrl,
    attributes: this.buildAttributesPayload(),
  };
  // Let backend compute netPrice when left empty.
  if (payload.netPrice === '' || payload.netPrice == null) {
    delete payload.netPrice;
  }
  // Ensure numeric discount payload (discount is a percentage 0..100).
  if (payload.discount === '' || payload.discount == null) {
    payload.discount = 0;
  }
  if (this.storeInWarehouse) {
    delete payload.branch;
  }

  this.productsSerivce.updateProduct(payload, this.productId).subscribe(
    (res: any) => {
      this.appNotificationService.push('✅ المنتج تم تحديثه', 'success');
      // فتح نافذة الطباعة تلقائيًا لو الكود اتولد تلقائي
  
      this.closeModal(true);
    },
    (error) => {
      const code = error?.error?.code;
      const msg =
        code === 'ACTIVE_BOOKING_BLOCKS_WAREHOUSE'
          ? this.translateService.instant('tr_product_warehouse_blocked_active_booking')
          : error?.error?.error || this.translateService.instant('tr_unexpected_error_message');
      this.appNotificationService.push(msg, 'error');
    }
  );
}


  // createProduct() {
  //   this.product = this.basicInfoForm.value;
  //   if (!this.basicInfoForm.valid) {
  //     return;
  //   }

  //   this.productsSerivce.createProduct(this.product).subscribe(() => {
  //     this.appNotificationService.push('product created successfully', 'sucess');
  //     this.closeModal(true);
  //   }, error=> {
  //     this.appNotificationService.push(error.error.error, 'error');
  //   });

  // }

  // updateProduct() {
  //   this.product = this.basicInfoForm.value;
  //   if (!this.basicInfoForm.valid) {
  //     return;
  //   }

  //   this.productsSerivce.updateProduct(this.product,this.productId).subscribe(() => {
  //     this.appNotificationService.push('product updated successfully', 'sucess');
  //     this.closeModal(true);
  //   }, error=> {
  //     this.appNotificationService.push(error.error.error, 'error');
  //   });

  // }

  submitForm(){
    if(this.isEdit){
      this.updateProduct();
    }
    else{
      this.createProduct();
    }
  }

  toggleCamera() {
    if (!this.isProductCodeEnabled) {
      this.appNotificationService.push(
        this.translateService.instant('tr_select_category_first_code'),
        'error'
      );
      return;
    }
    this.isCameraActive = !this.isCameraActive;
    if (this.isCameraActive) {
      this.startCameraScan();
    }
  }

  startCameraScan() {
    this.codeReader
      .decodeOnceFromVideoDevice(undefined, 'video')
      .then(result => {
        if (result) {
          this.onCodeScanned(result.getText());
          // أقفل الكاميرا بعد أول Scan
          this.isCameraActive = false;
        }
      })
      .catch(err => {
        console.error('Scan error', err);
        this.appNotificationService.push('Unable to scan code', 'error');
        this.isCameraActive = false;
      });
  }

  onCodeScanned(code: string) {
    if (!code) return;

    if (code.length < 3) {
      this.appNotificationService.push('Invalid code', 'error');
      return;
    }

    if (this.selectedCategory && this.hasCategoryCode(this.selectedCategory)) {
      const p = String(this.selectedCategory.code).trim();
      if (!code.toUpperCase().startsWith(p.toUpperCase())) {
        this.appNotificationService.push(
          this.translateService.instant('tr_scan_code_wrong_prefix'),
          'error'
        );
        return;
      }
    }

    this.codeValue = code;
    this.basicInfoForm?.form?.patchValue({ code });
    this.appNotificationService.push('Code scanned successfully', 'success');
  }

  ngOnDestroy() {
    this.codeReader.decodeOnceFromVideoDevice();
    this.subscriptions.forEach(s => s.unsubscribe());
  }
  

  destroyComponent() {
    this.destroyEmitter.emit();
  }
  closeModal(isSubmit?: boolean) {
    this.dialogRef.close(isSubmit);
  }
}
