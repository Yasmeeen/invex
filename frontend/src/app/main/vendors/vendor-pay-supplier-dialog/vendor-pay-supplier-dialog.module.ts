import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule } from '@angular/material/dialog';
import { SharedModule } from '@shared/shared.module';
import { VendorPaySupplierDialogComponent } from './vendor-pay-supplier-dialog.component';

@NgModule({
  declarations: [VendorPaySupplierDialogComponent],
  imports: [CommonModule, SharedModule, MatDialogModule],
  exports: [VendorPaySupplierDialogComponent],
})
export class VendorPaySupplierDialogModule {}
