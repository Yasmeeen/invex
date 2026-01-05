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
  categories: Category [];
  private subscriptions: Subscription[] = [];

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
    this.productsSerivce.getProduct(this.productId).subscribe((response:any)=> {
      this.productId = response._id
      this.basicInfoForm.form.patchValue(response);
    })
  }

  basicInfoFormSubmitted() {}

  createProduct() {
    this.product = this.basicInfoForm.value;
    if (!this.basicInfoForm.valid) {
      return;
    }

    this.productsSerivce.createProduct(this.product).subscribe(() => {
      this.appNotificationService.push('product created successfully', 'sucess');
      this.closeModal(true);
    }, error=> {
      this.appNotificationService.push(error.error.error, 'error');
    });

  }

  updateProduct() {
    this.product = this.basicInfoForm.value;
    if (!this.basicInfoForm.valid) {
      return;
    }

    this.productsSerivce.updateProduct(this.product,this.productId).subscribe(() => {
      this.appNotificationService.push('product updated successfully', 'sucess');
      this.closeModal(true);
    }, error=> {
      this.appNotificationService.push(error.error.error, 'error');
    });

  }

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
