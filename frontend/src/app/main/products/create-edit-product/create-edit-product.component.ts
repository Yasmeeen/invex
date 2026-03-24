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
    private cloudinaryUpload: CloudinaryUploadService

  ) {}

  ngOnInit() {
    this.productId = this.data.productId
    this.isEdit = this.data.isEdit
    this.getCategories();
    this.getBranches();
    if(this.isEdit){
    this.getProductData()
     
    }

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
      this.categories = response.categories
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
    });
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
  this.productsSerivce.generateBarcode().subscribe({
    next: (res: any) => {
      this.codeValue = res.code; // ضع الكود في الحقل
      this.isCodeGenerated = true;  // قفل الحقل
      this.basicInfoForm.form.patchValue({ code: res.code });
      this.appNotificationService.push('✅ الكود تم توليده تلقائياً', 'success');
    },
    error: (err:any) => {
      console.error(err);
      this.appNotificationService.push('❌ خطأ في توليد الكود', 'error');
    }
  });
}

createProduct() {
  if (this.isUploadingImage) {
    return;
  }
  if (!this.basicInfoForm.valid) return;
  if (!this.storeInWarehouse && !this.basicInfoForm.value.branch?._id) {
    this.appNotificationService.push(
      this.translateService.instant('tr_branch_required'),
      'error'
    );
    return;
  }

  const payload: any = {
    ...this.basicInfoForm.value,
    code: this.codeValue,
    inWarehouse: this.storeInWarehouse,
    imageUrl: this.productImageUrl || '',
  };
  if (this.storeInWarehouse) {
    delete payload.branch;
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
  };
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
      this.appNotificationService.push(error.error.error, 'error');
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

    this.basicInfoForm.form.patchValue({ code: code });
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
