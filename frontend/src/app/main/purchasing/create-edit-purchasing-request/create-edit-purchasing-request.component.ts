import { Component, OnInit, ViewChild, Inject, Output, EventEmitter } from '@angular/core';
import { NgForm } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Subscription } from 'rxjs';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { TranslateService } from '@ngx-translate/core';
import { VendorsSerivce } from '@shared/services/vendors.service';
import { PurchasingRequestsService } from '@shared/services/purchasing.service';
import { Vendor } from '@core/models/products.model';

@Component({
  selector: 'app-create-edit-purchasing-request',
  templateUrl: './create-edit-purchasing-request.component.html',
  styleUrls: ['./create-edit-purchasing-request.component.scss']
})
export class CreateEditPurchasingRequestComponent implements OnInit {
  @ViewChild('purchasingForm') purchasingForm: NgForm;
  @Output() destroyEmitter: EventEmitter<any> = new EventEmitter();

  purchasingRequestId: string;
  isEdit = false;
  vendorsList: any[] = [];
  installments: any[] = [];
  selectedPaymentTerm: string;
  private subscriptions: Subscription[] = [];
  selectedVendor: Vendor;

  purchasingStatusList = [
    { label: this.translateService.instant('tr_received'), value: 'Received' },
    { label: this.translateService.instant('tr_pending'), value: 'Pending' },
    { label: this.translateService.instant('tr_ordered'), value: 'Ordered' },
  ];

  constructor(
    private dialogRef: MatDialogRef<CreateEditPurchasingRequestComponent>,
    private purchasingService: PurchasingRequestsService,
    private vendorsService: VendorsSerivce,
    private appNotificationService: AppNotificationService,
    private translateService: TranslateService,
    @Inject(MAT_DIALOG_DATA) public data: any
  ) {}

  ngOnInit(): void {
    this.purchasingRequestId = this.data?.requestId;
    console.log(" this.purchasingRequestId ", this.purchasingRequestId );
    
    this.isEdit = this.data?.isEdit || false;
    this.getVendors();

    if (this.isEdit) {
      this.getPurchasingRequest();
    }
  }

  getVendors() {
    const params = { page: 1, limit: 1000 };
    this.subscriptions.push(
      this.vendorsService.getVendors(params).subscribe({
        next: (res: any) => (this.vendorsList = res.vendors),
        error: () =>
          this.appNotificationService.push(
            this.translateService.instant('tr_unexpected_error_message'),
            'error'
          ),
      })
    );
  }

  getPurchasingRequest() {
    this.purchasingService.getPurchasingRequest(this.purchasingRequestId).subscribe({
      next: (response: any) => {
        this.purchasingForm.form.patchValue(response);
        if (response.installments) this.installments = response.installments;
        this.selectedPaymentTerm = response.paymentStatus;
        this.selectedVendor = response.supplier;
      },
      error: () =>
        this.appNotificationService.push(
          this.translateService.instant('tr_unexpected_error_message'),
          'error'
        ),
    });
  }

  buildPayload() {
    const formValue = this.purchasingForm.value;
    const payload: any = {
      supplier: this.selectedVendor?._id,
      paymentStatus: this.selectedPaymentTerm,
      requestDate: formValue.requestDate,
      requestedBy: formValue.requestedBy,
      totalAmount: formValue.totalAmount,
      status: formValue.status,
      notes: formValue.notes || '',
    };

    if (this.selectedPaymentTerm === 'Installments') {
      payload.installments = this.installments.map(inst => ({
        dueDate: inst.dueDate,
        amount: inst.amount,
        paid: inst.paid || false,
      }));
    }

    return payload;
  }

  createPurchasingRequest() {
    if (!this.purchasingForm.valid) return;

    const payload = this.buildPayload();

    this.purchasingService.createPurchasingRequest(payload).subscribe({
      next: () => {
        this.appNotificationService.push('Purchasing request created successfully', 'success');
        this.closeModal(true);
      },
      error: (error) =>
        this.appNotificationService.push(
          error?.error?.message || this.translateService.instant('tr_unexpected_error_message'),
          'error'
        ),
    });
  }

  updatePurchasingRequest() {
    if (!this.purchasingForm.valid) return;

    const payload = this.buildPayload();

    this.purchasingService.updatePurchasingRequest(this.purchasingRequestId, payload).subscribe({
      next: () => {
        this.appNotificationService.push('Purchasing request updated successfully', 'success');
        this.closeModal(true);
      },
      error: (error) =>
        this.appNotificationService.push(
          error?.error?.message || this.translateService.instant('tr_unexpected_error_message'),
          'error'
        ),
    });
  }

  addInstallment() {
    this.installments.push({ dueDate: '', amount: '', paid: false });
  }

  removeInstallment(index: number) {
    this.installments.splice(index, 1);
  }

  submitForm() {
    this.isEdit ? this.updatePurchasingRequest() : this.createPurchasingRequest();
  }

  closeModal(isSubmit?: boolean) {
    this.dialogRef.close(isSubmit);
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }
}
