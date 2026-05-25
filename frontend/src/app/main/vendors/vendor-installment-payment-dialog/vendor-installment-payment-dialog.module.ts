import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule } from '@angular/material/dialog';
import { SharedModule } from '@shared/shared.module';
import { VendorInstallmentPaymentDialogComponent } from './vendor-installment-payment-dialog.component';

@NgModule({
  declarations: [VendorInstallmentPaymentDialogComponent],
  imports: [CommonModule, SharedModule, MatDialogModule],
  exports: [VendorInstallmentPaymentDialogComponent],
})
export class VendorInstallmentPaymentDialogModule {}
