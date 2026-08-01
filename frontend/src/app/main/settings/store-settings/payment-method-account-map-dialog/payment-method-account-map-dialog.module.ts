import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule } from '@angular/material/dialog';
import { SharedModule } from '@shared/shared.module';
import { PaymentMethodAccountMapDialogComponent } from './payment-method-account-map-dialog.component';

@NgModule({
  declarations: [PaymentMethodAccountMapDialogComponent],
  imports: [CommonModule, FormsModule, SharedModule, MatDialogModule],
  exports: [PaymentMethodAccountMapDialogComponent],
})
export class PaymentMethodAccountMapDialogModule {}
