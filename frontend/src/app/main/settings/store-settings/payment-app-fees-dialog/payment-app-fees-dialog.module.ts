import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule } from '@angular/material/dialog';
import { SharedModule } from '@shared/shared.module';
import { TreasurySettleDialogModule } from '../../../treasury/treasury-settle-dialog/treasury-settle-dialog.module';
import { PaymentAppFeesDialogComponent } from './payment-app-fees-dialog.component';
import { PaymentMethodFormDialogComponent } from '../payment-method-form-dialog/payment-method-form-dialog.component';

@NgModule({
  declarations: [PaymentAppFeesDialogComponent, PaymentMethodFormDialogComponent],
  imports: [
    CommonModule,
    FormsModule,
    SharedModule,
    MatDialogModule,
    TreasurySettleDialogModule,
  ],
  exports: [PaymentAppFeesDialogComponent],
})
export class PaymentAppFeesDialogModule {}
