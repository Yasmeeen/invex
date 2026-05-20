import { map } from 'rxjs/operators';
import { Component, OnInit, ViewChild, ElementRef, Inject, Output, EventEmitter } from '@angular/core';
import { NgForm } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Subscription } from 'rxjs';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { TranslateService } from '@ngx-translate/core';
import { CategoriesServce } from '@shared/services/categories.service';
import { VendorsSerivce } from '@shared/services/vendors.service';
import { Vendor } from '@core/models/products.model';


@Component({
  selector: 'app-create-edit-vendor',
  templateUrl: './create-edit-vendor.component.html',
  styleUrls: ['./create-edit-vendor.component.scss']
})
export class CreateEditVendorComponent implements OnInit {
  @ViewChild('vendorForm') vendorForm: NgForm;
  @Output() destroyEmitter: EventEmitter<any> = new EventEmitter();

  vendorId: string;
  isEdit = false;
  isSubmitting = false;
  selectedPaymentTerm = 'cash';
  installments: { date: string; paid: boolean }[] = [];
  categoriesList: any[] = [];

  paymentOptions: { label: string; value: string }[] = [];

  private subscriptions: Subscription[] = [];

  constructor(
    private dialogRef: MatDialogRef<CreateEditVendorComponent>,
    private vendorsService: VendorsSerivce,
    private categoriesService: CategoriesServce,
    private appNotificationService: AppNotificationService,
    private translateService: TranslateService,
    @Inject(MAT_DIALOG_DATA) public data: any
  ) {}

  ngOnInit(): void {
    this.paymentOptions = [
      { label: this.translateService.instant('tr_payment_cash'), value: 'cash' },
      { label: this.translateService.instant('tr_payment_installments'), value: 'Installments' },
      { label: this.translateService.instant('tr_payment_deferred'), value: 'Deferred' },
    ];
    this.vendorId = this.data?.vendorId;
    this.isEdit = this.data?.isEdit || false;
    this.getCategories();

    if (this.isEdit) {
      this.getVendorData();
    }
  }

  getCategories() {
    const params = { page: 1, limit: 1000 };
    this.subscriptions.push(
      this.categoriesService.getCategorys(params).subscribe({
        next: (response: any) => (this.categoriesList = response.categories),
        error: () =>
          this.appNotificationService.push(
            this.translateService.instant('tr_unexpected_error_message'),
            'error'
          ),
      })
    );
  }

  getVendorData() {
    this.vendorsService.getVendor(this.vendorId).subscribe((response: any) => {
      this.vendorId = response._id!;
      response.categories = response.categories.map((category: any) => category._id);
      console.log("response",response);
      
      this.vendorForm.form.patchValue(response);
    });
  }



  createVendor() {
    const vendor: Vendor = { ...this.vendorForm.value, installments: this.installments };

    if (!this.vendorForm.valid) return;

    this.vendorsService.createVendor(vendor).subscribe({
      next: () => {
        this.appNotificationService.push('Vendor created successfully', 'success');
        this.closeModal(true);
      },
      error: (error) => this.appNotificationService.push(error.error.error, 'error'),
    });
  }

  updateVendor() {
    const vendor: Vendor = { ...this.vendorForm.value, installments: this.installments };

    if (!this.vendorForm.valid) return;

    this.vendorsService.updateVendor(vendor, this.vendorId).subscribe({
      next: () => {
        this.appNotificationService.push('Vendor updated successfully', 'success');
        this.closeModal(true);
      },
      error: (error) => this.appNotificationService.push(error.error.error, 'error'),
    });
  }

  submitForm() {
    this.isEdit ? this.updateVendor() : this.createVendor();
  }

  closeModal(isSubmit?: boolean) {
    this.dialogRef.close(isSubmit);
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach((sub) => sub.unsubscribe());
  }
}
