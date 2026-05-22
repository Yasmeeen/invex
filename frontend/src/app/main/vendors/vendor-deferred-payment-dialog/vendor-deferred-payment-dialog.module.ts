import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule } from '@angular/material/dialog';
import { SharedModule } from '@shared/shared.module';
import { VendorDeferredPaymentDialogComponent } from './vendor-deferred-payment-dialog.component';

@NgModule({
  declarations: [VendorDeferredPaymentDialogComponent],
  imports: [CommonModule, SharedModule, MatDialogModule],
  exports: [VendorDeferredPaymentDialogComponent],
})
export class VendorDeferredPaymentDialogModule {}
